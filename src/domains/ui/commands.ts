import { readFileSync } from "node:fs";
import { join } from "node:path";
import { getBootTimings } from "../../core/boot-timing";
import { DEFAULT_SAFETY } from "../../core/defaults";
import { PanMessageType } from "../../core/message-types";
import { MODE_DEFINITIONS, type ModeDefinition, getModeDefinition } from "../../core/modes";
import { loadPresets } from "../../core/presets";
import { writePanCodeSettings } from "../../core/settings-state";
import { PANCODE_PRODUCT_NAME, formatCategorizedHelp } from "../../core/shell-metadata";
import { type PanCodeReasoningPreference, THINKING_LEVELS, getModelReasoningControl } from "../../core/thinking";
import { getConfigDir } from "../../core/xdg";
import type { ExtensionContext } from "../../engine/extensions";
import { runtimeRegistry } from "../../engine/runtimes";
import type { ThemeColor } from "../../engine/tui";
import type { Api, Model } from "../../engine/types";
import { agentRegistry } from "../agents";
import { getRunLedger, inferRuntimeFromModel } from "../dispatch";
import { getMetricsLedger } from "../observability";
import { classifyModelTier, deriveProviderHint } from "../prompts/tiering";
import type { ModelTier } from "../prompts/types";
import { type MergedModelProfile, getModelProfileCache } from "../providers";
import { getBudgetTracker } from "../scheduling";
import { getContextPercent, getContextTokens, getContextWindow } from "./context-tracker";
import { renderDashboard } from "./dashboard-layout";
import { getRecentLogs } from "./dashboard-logs";
import { buildDashboardConfig, buildDashboardState } from "./dashboard-state";
import { PLAIN_COLORIZER } from "./dashboard-theme";
import { inlineHint, readOnlyBanner, settingHint } from "./hint-helpers";
import { type PanelRow, type PanelSection, type PanelSpec, blank, kv, sendPanelSpec, text } from "./panel-renderer";
import { getLiveWorkers } from "./worker-widgets";

// ---------------------------------------------------------------------------
// Shared state and callback interfaces
// ---------------------------------------------------------------------------

/** Mutable UI state shared between extension.ts and command handlers. */
export interface UiCommandState {
  currentModelLabel: string;
  currentReasoningPreference: PanCodeReasoningPreference;
  currentThemeName: string;
  themeFg: (color: ThemeColor, text: string) => string;
}

/** Pi-level callbacks that command handlers need but cannot import directly. */
export interface UiCommandCallbacks {
  emitPanel: (title: string, body: string) => void;
  getThinkingLevel: () => string;
  setModel: (model: Model<Api>) => Promise<boolean>;
  setActiveTools: (tools: string[]) => void;
  sendPiMessage: (msg: {
    customType: string;
    content: string;
    display: boolean;
    details: { title: string };
  }) => void;
  applyReasoningLevel: (
    level: PanCodeReasoningPreference,
    model: Pick<Model<Api>, "reasoning" | "compat"> | null | undefined,
    notify: (message: string, level: "info" | "warning" | "error") => void,
  ) => void;
  syncEditorDisplay: () => void;
  emitModeTransition: (mode: ModeDefinition) => void;
}

/** Handler function signature for slash commands. */
export type CommandHandler = (args: string, ctx: ExtensionContext) => Promise<void>;

/** All command handlers returned by createCommandHandlers. */
export interface CommandHandlers {
  handleThemeCommand: CommandHandler;
  handleModelsCommand: CommandHandler;
  handleReasoningCommand: CommandHandler;
  handlePreferencesCommand: CommandHandler;
  showDashboard: CommandHandler;
  handleModesCommand: CommandHandler;
  handleHelpCommand: CommandHandler;
  handlePresetCommand: CommandHandler;
  handlePerfCommand: CommandHandler;
  handleSafetyCommand: CommandHandler;
  handleExitCommand: CommandHandler;
  handleHotkeysCommand: CommandHandler;
}

// ---------------------------------------------------------------------------
// Shared utility exports (used by both commands.ts and extension.ts)
// ---------------------------------------------------------------------------

export function sendPanel(emitFn: (title: string, body: string) => void, title: string, lines: string[]): void {
  emitFn(title, lines.join("\n"));
}

export function makeEmitPanel(
  piSendMessage: (msg: { customType: string; content: string; display: boolean; details: { title: string } }) => void,
): (title: string, body: string) => void {
  return function emitPanel(title: string, body: string): void {
    piSendMessage({
      customType: PanMessageType.PANEL,
      content: body,
      display: true,
      details: { title },
    });
  };
}

export function persistSettings(
  patch: Parameters<typeof writePanCodeSettings>[0],
  notify: (message: string, level: "info" | "warning" | "error") => void,
): void {
  try {
    writePanCodeSettings(patch);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    notify(`Failed to save PanCode settings: ${message}`, "error");
  }
}

export function modelRef(model: Pick<Model<Api>, "provider" | "id">): string {
  return `${model.provider}/${model.id}`;
}

// ---------------------------------------------------------------------------
// Pure helpers (used by command handlers)
// ---------------------------------------------------------------------------

/**
 * Returns true if the model id looks like a chat/completion model rather than
 * an embedding model, reranker, or other non-conversational model.
 */
function isChatModel(modelId: string): boolean {
  const lower = modelId.toLowerCase();
  if (lower.includes("embedding") || lower.includes("reranker")) return false;
  if (/(?:^|[\/-])bge-/.test(lower)) return false;
  if (lower.includes("embed") && !lower.includes("instruct") && !lower.includes("chat")) return false;
  return true;
}

/**
 * Build per-node model summary from profile cache.
 * Groups chat models by providerId prefix (the part before the dash,
 * e.g., "mini" from "mini-llamacpp") and counts loaded chat models.
 */
function buildNodeSummary(profiles: MergedModelProfile[]): string[] {
  const chatProfiles = profiles.filter((p) => isChatModel(p.modelId));
  const byNode = new Map<string, number>();
  for (const p of chatProfiles) {
    const node = p.providerId.split("-")[0] || p.providerId;
    byNode.set(node, (byNode.get(node) ?? 0) + 1);
  }
  return [...byNode.entries()].map(([node, count]) => `${node}:${count} model${count !== 1 ? "s" : ""}`);
}

let _cachedVersion: string | null = null;
function readPackageVersion(): string {
  if (_cachedVersion) return _cachedVersion;
  try {
    const root = process.env.PANCODE_PACKAGE_ROOT ?? process.cwd();
    const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as { version?: unknown };
    _cachedVersion = typeof pkg.version === "string" ? pkg.version : "dev";
  } catch {
    _cachedVersion = "dev";
  }
  return _cachedVersion;
}

/**
 * Build the compact boot banner displayed on session start.
 *
 * Uses PanelSpec for consistent bordered rendering. Shows version, active mode,
 * model name, system counts, and optional boot timing. Fits within 80 columns.
 */
export function buildWelcomeScreen(modelLabel: string, modeName: string): PanelSpec {
  const version = process.env.npm_package_version ?? readPackageVersion();
  const modelShort = modelLabel.includes("/") ? (modelLabel.split("/").pop() ?? modelLabel) : modelLabel;
  const modelDisplay = modelShort.length > 30 ? `${modelShort.slice(0, 27)}...` : modelShort;
  const profiles = getModelProfileCache();
  const agentCount = agentRegistry.getAll().length;
  const runtimeCount = runtimeRegistry.available().length;
  const nodeCount = new Set(profiles.map((p) => p.providerId.split("-")[0] || p.providerId)).size;

  const systemSection: PanelSection = {
    rows: [kv("Version", `v${version}`), kv("Mode", modeName), kv("Model", modelDisplay)],
  };

  const countParts: string[] = [];
  if (agentCount > 0) countParts.push(agentCount === 1 ? "1 agent" : `${agentCount} agents`);
  if (runtimeCount > 0) countParts.push(runtimeCount === 1 ? "1 runtime" : `${runtimeCount} runtimes`);
  if (nodeCount > 0) countParts.push(nodeCount === 1 ? "1 node" : `${nodeCount} nodes`);

  const healthSection: PanelSection = {
    rows: countParts.length > 0 ? [text(countParts.join("  "))] : [text("No agents registered")],
  };

  const sections: PanelSection[] = [systemSection, healthSection];

  const timings = getBootTimings();
  if (timings) {
    const bootLabel = `${timings.totalMs.toFixed(0)}ms ${timings.mode} boot`;
    const budgetNote = timings.budgetExceeded ? " (over budget)" : "";
    sections.push({ rows: [text(`${bootLabel}${budgetNote}`)] });
  }

  sections.push({ rows: [text("shift+tab mode  /help commands")] });

  return { title: PANCODE_PRODUCT_NAME, sections };
}

function describeReasoningCapability(
  model:
    | {
        reasoning?: boolean;
        compat?: {
          supportsReasoningEffort?: boolean;
          thinkingFormat?: "openai" | "zai" | "qwen" | "qwen-chat-template";
        };
      }
    | null
    | undefined,
): string {
  const control = getModelReasoningControl(model);
  if (control === "none") return "unsupported";
  if (control === "levels") return `levels (${THINKING_LEVELS.join(", ")})`;

  switch (model?.compat?.thinkingFormat) {
    case "qwen":
      return "toggle (enable_thinking)";
    case "qwen-chat-template":
      return "toggle (chat_template_kwargs.enable_thinking)";
    case "zai":
      return "toggle (provider enable_thinking)";
    default:
      return "toggle";
  }
}

/** Providers whose models are accessed via cloud APIs rather than local engines. */
const CLOUD_PROVIDERS = new Set(["anthropic", "openai-codex"]);

function isCloudModel(model: Model<Api>): boolean {
  return CLOUD_PROVIDERS.has(model.provider);
}

function runtimeSourceTag(model: Model<Api>): string {
  if (model.provider === "anthropic") return "[Claude Code]";
  if (model.provider === "openai-codex") return "[Codex CLI]";
  return "";
}

/** Build PanelRow items summarizing worker runtime and available runtimes. */
function formatRuntimeInfoRows(): PanelRow[] {
  const workerModel = process.env.PANCODE_WORKER_MODEL?.trim() || null;
  const currentRuntime = inferRuntimeFromModel(workerModel) ?? "pi";
  const available = runtimeRegistry.available();

  const runtimeList =
    available
      .map((r) => {
        const version = r.getVersion();
        const versionSuffix = version ? ` (${version})` : "";
        return `${r.id}${versionSuffix}`;
      })
      .join(", ") || "pi only";

  return [
    kv("Worker runtime:", `${currentRuntime}  ${inlineHint("use claude code for workers")}`),
    kv("Available:", runtimeList),
  ];
}

function getRegisteredModels(ctx: ExtensionContext): {
  all: Array<Model<Api>>;
  available: Array<Model<Api>>;
  availableRefs: Set<string>;
} {
  ctx.modelRegistry.refresh();

  const sortModels = (models: Array<Model<Api>>) =>
    [...models].sort((left, right) => {
      const providerDiff = left.provider.localeCompare(right.provider);
      if (providerDiff !== 0) return providerDiff;
      return left.id.localeCompare(right.id);
    });

  const all = sortModels(ctx.modelRegistry.getAll());
  const available = sortModels(ctx.modelRegistry.getAvailable());

  return {
    all,
    available,
    availableRefs: new Set(available.map((model) => modelRef(model))),
  };
}

function formatContextWindow(tokens: number | null): string | null {
  if (tokens === null) return null;
  if (tokens >= 1_000) return `${Math.round(tokens / 1_000)}K ctx`;
  return `${tokens} ctx`;
}

function formatProfileCapabilities(profile: MergedModelProfile): string {
  const parts: string[] = [];
  if (profile.capabilities.reasoning) parts.push("reasoning");
  const ctx = formatContextWindow(profile.capabilities.contextWindow);
  if (ctx) parts.push(ctx);
  return parts.length > 0 ? ` (${parts.join(", ")})` : "";
}

function formatRegistryModelCapabilities(model: Model<Api>, profiles: MergedModelProfile[]): string {
  const profile = profiles.find((p) => p.providerId === model.provider && p.modelId === model.id);
  if (profile) return formatProfileCapabilities(profile);
  const parts: string[] = [];
  if (model.reasoning) parts.push("reasoning");
  const ctx = formatContextWindow(model.contextWindow ?? null);
  if (ctx) parts.push(ctx);
  return parts.length > 0 ? ` (${parts.join(", ")})` : "";
}

/**
 * Build the "Active" section showing models confirmed loaded on connected engines.
 * Discovery only returns models that are loaded: LM Studio (listLoaded), llama.cpp
 * (/v1/models), Ollama (list). These are all ready to use with zero load latency.
 */
function formatActiveModelLines(currentRef: string, profiles: MergedModelProfile[]): string[] {
  const chatProfiles = profiles.filter((p) => isChatModel(p.modelId));
  if (chatProfiles.length === 0) return ["  (no active engines detected)"];

  const byProvider = new Map<string, MergedModelProfile[]>();
  for (const p of chatProfiles) {
    const group = byProvider.get(p.providerId) ?? [];
    group.push(p);
    byProvider.set(p.providerId, group);
  }

  const lines: string[] = [];
  for (const [providerId, group] of byProvider) {
    lines.push(`  ${providerId}`);
    for (const profile of group) {
      const ref = `${profile.providerId}/${profile.modelId}`;
      const marker = ref === currentRef ? "*" : "-";
      const caps = formatProfileCapabilities(profile);
      lines.push(`    ${marker} ${profile.modelId}${caps}`);
    }
  }

  return lines;
}

/**
 * One-line summary of all available chat models across all authenticated providers.
 * Always shown in the default /models view so the user knows what else exists.
 * Separates local engine models from cloud provider models in the count.
 */
function formatAvailableSummary(registryAvailable: ReadonlyArray<Model<Api>>): string {
  const chatModels = registryAvailable.filter((m) => isChatModel(m.id));
  if (chatModels.length === 0) return "";

  const localModels = chatModels.filter((m) => !isCloudModel(m));
  const cloudModels = chatModels.filter((m) => isCloudModel(m));
  const providerSet = new Set(chatModels.map((m) => m.provider));
  const providerLabel = providerSet.size === 1 ? "1 provider" : `${providerSet.size} providers`;

  const parts = [`${chatModels.length} models across ${providerLabel}`];
  if (localModels.length > 0 && cloudModels.length > 0) {
    parts.push(`(${localModels.length} local, ${cloudModels.length} cloud)`);
  }
  return `Available: ${parts.join(" ")}. Use /models all to browse.`;
}

// ---------------------------------------------------------------------------
// Tier-grouped model display helpers
// ---------------------------------------------------------------------------

/** Format cost per million tokens as "$input/$output" or "free". */
function formatCost(model: Model<Api>): string {
  if (model.cost.input === 0 && model.cost.output === 0) return "free";
  const fmtNum = (n: number): string => (n === Math.floor(n) ? `$${n}` : `$${n}`);
  return `${fmtNum(model.cost.input)}/${fmtNum(model.cost.output)}`;
}

/** Format context window as human-readable shorthand (1M, 272k, 4k). */
function formatContextShort(ctx: number | null | undefined): string {
  if (!ctx) return "? ctx";
  if (ctx >= 1_000_000) return `${(ctx / 1_000_000).toFixed(0)}M ctx`;
  return `${Math.round(ctx / 1000)}k ctx`;
}

/** Tier display labels in presentation order. */
const TIER_LABELS: Record<ModelTier, string> = {
  frontier: "Frontier:",
  mid: "Mid-tier:",
  small: "Small/Scout:",
};

/** Presentation order for tiers. */
const TIER_ORDER: ModelTier[] = ["frontier", "mid", "small"];

/**
 * Classify a registry model into a tier. Uses the profile cache for richer
 * capabilities when available, falls back to the registry model fields.
 */
function classifyRegistryModel(model: Model<Api>, profiles: MergedModelProfile[]): ModelTier {
  const profile = profiles.find((p) => p.providerId === model.provider && p.modelId === model.id);
  if (profile) {
    return classifyModelTier(profile.capabilities, deriveProviderHint(model.provider), profile.family);
  }
  return classifyModelTier(
    { contextWindow: model.contextWindow ?? null, reasoning: model.reasoning ?? null },
    deriveProviderHint(model.provider),
  );
}

/**
 * Build the tier-grouped default /models display.
 * Groups all available chat models by tier, sorted by cost (expensive first)
 * then alphabetically by provider/id. Returns PanelSection[] ready for rendering.
 */
function buildTierGroupedSections(
  currentRef: string,
  models: ReadonlyArray<Model<Api>>,
  profiles: MergedModelProfile[],
): PanelSection[] {
  const chatModels = models.filter((m) => isChatModel(m.id));
  const buckets = new Map<ModelTier, Array<Model<Api>>>();
  for (const tier of TIER_ORDER) buckets.set(tier, []);

  for (const m of chatModels) {
    const tier = classifyRegistryModel(m, profiles);
    const bucket = buckets.get(tier);
    if (bucket) bucket.push(m);
  }

  // Sort within each tier: expensive first (by output cost), then provider/id
  for (const [, bucket] of buckets) {
    bucket.sort((a, b) => {
      const costDiff = b.cost.output - a.cost.output;
      if (costDiff !== 0) return costDiff;
      const provDiff = a.provider.localeCompare(b.provider);
      if (provDiff !== 0) return provDiff;
      return a.id.localeCompare(b.id);
    });
  }

  // Compute column widths for alignment
  let maxRefLen = 0;
  let maxCtxLen = 0;
  for (const m of chatModels) {
    const ref = modelRef(m);
    if (ref.length > maxRefLen) maxRefLen = ref.length;
    const ctx = formatContextShort(m.contextWindow ?? null);
    if (ctx.length > maxCtxLen) maxCtxLen = ctx.length;
  }

  const sections: PanelSection[] = [];
  for (const tier of TIER_ORDER) {
    const bucket = buckets.get(tier);
    if (!bucket || bucket.length === 0) continue;

    const rows: PanelRow[] = bucket.map((m) => {
      const ref = modelRef(m);
      const marker = ref === currentRef ? "*" : " ";
      const ctx = formatContextShort(m.contextWindow ?? null);
      const cost = formatCost(m);
      const padRef = ref.padEnd(maxRefLen + 2);
      const padCtx = ctx.padEnd(maxCtxLen + 2);
      return text(`  ${marker} ${padRef}${padCtx}${cost}`);
    });

    sections.push({ heading: TIER_LABELS[tier], rows });
  }

  return sections;
}

/**
 * Format a filtered list for a single provider.
 * Includes a runtime source tag for cloud provider models.
 */
function formatProviderModelLines(
  currentRef: string,
  providerName: string,
  models: ReadonlyArray<Model<Api>>,
  profiles: MergedModelProfile[],
): string[] {
  const chatModels = models.filter((m) => isChatModel(m.id));
  const sorted = [...chatModels].sort((a, b) => a.id.localeCompare(b.id));
  const cloudTag =
    providerName === "anthropic" ? "Claude Code CLI" : providerName === "openai-codex" ? "Codex CLI" : "cloud";
  const tag = CLOUD_PROVIDERS.has(providerName) ? ` (cloud, via ${cloudTag})` : "";
  const lines: string[] = [`${providerName}${tag} (${sorted.length} models):`];

  for (const model of sorted) {
    const ref = modelRef(model);
    const marker = ref === currentRef ? "*" : "-";
    const caps = formatRegistryModelCapabilities(model, profiles);
    lines.push(`  ${marker} ${model.id}${caps}`);
  }

  lines.push("", `Ask Panos: "use <model-name>" to switch models.`);
  return lines;
}

/**
 * Format all available models grouped by provider (for /models all).
 * Includes a runtime source tag for cloud models to distinguish access method.
 */
function formatAllAvailableLines(
  currentRef: string,
  models: ReadonlyArray<Model<Api>>,
  profiles: MergedModelProfile[],
): string[] {
  if (models.length === 0) return ["No available models found."];

  const sorted = [...models].sort((a, b) => {
    const providerDiff = a.provider.localeCompare(b.provider);
    if (providerDiff !== 0) return providerDiff;
    return a.id.localeCompare(b.id);
  });

  const lines: string[] = [];
  let activeProvider: string | null = null;

  for (const model of sorted) {
    if (model.provider !== activeProvider) {
      activeProvider = model.provider;
      if (lines.length > 0) lines.push("");
      const tag = isCloudModel(model) ? "  (cloud)" : "";
      lines.push(`${model.provider}${tag}`);
    }

    const ref = modelRef(model);
    const marker = ref === currentRef ? "*" : "-";
    const caps = formatRegistryModelCapabilities(model, profiles);
    const source = runtimeSourceTag(model);
    const sourceSuffix = source ? `  ${source}` : "";
    lines.push(`  ${marker} ${model.id}${caps}${sourceSuffix}`);
  }

  lines.push("", `Ask Panos: "use <model-name>" to switch models.`);
  return lines;
}

// ---------------------------------------------------------------------------
// Hint constants (reused across command panels)
// ---------------------------------------------------------------------------

const MODEL_HINT_EXAMPLES = ["use qwen model", "switch to nemotron"] as const;
const MODEL_HINT_SHORTCUTS = ["shift+tab:mode", "alt+a:admin"] as const;

// ---------------------------------------------------------------------------
// Command handler factory
// ---------------------------------------------------------------------------

export function createCommandHandlers(state: UiCommandState, cb: UiCommandCallbacks): CommandHandlers {
  const handleThemeCommand: CommandHandler = async (args, ctx) => {
    const request = args.trim().toLowerCase();
    const themes = ctx.ui
      .getAllThemes()
      .map((themeInfo) => themeInfo.name)
      .sort();

    // Apply theme if a valid name was provided
    if (request && request !== "list" && themes.includes(request)) {
      process.env.PANCODE_THEME = request;
      state.currentThemeName = request;
      persistSettings({ theme: request }, (msg, lvl) => ctx.ui.notify(msg, lvl));
      ctx.ui.notify(`Theme set to "${request}".`, "info");
      return;
    }

    const currentTheme = ctx.ui.theme.name ?? state.currentThemeName;
    const themeRows: PanelRow[] = themes.map((name) => text(`${name === currentTheme ? "*" : "-"} ${name}`));

    const sections: PanelSection[] = [
      { rows: [kv("Current:", `${currentTheme}  ${inlineHint("switch to dark theme")}`)] },
      { heading: "Available:", rows: themeRows },
    ];

    if (request && request !== "list") {
      sections.push({
        rows: [text(`Unknown theme "${request}". Use one of the names listed above.`)],
      });
    }

    sections.push({
      rows: [text(settingHint(["use dark theme", "/theme dark"], ["shift+tab:mode", "alt+a:admin"]))],
    });

    sendPanelSpec(cb.emitPanel, { title: `${PANCODE_PRODUCT_NAME} Themes`, sections });
  };

  const handleModelsCommand: CommandHandler = async (args, ctx) => {
    const request = args.trim();
    const registry = getRegisteredModels(ctx);
    const profiles = getModelProfileCache();
    const currentRef = ctx.model ? modelRef(ctx.model) : "unresolved";

    const modelHintRow = { rows: [text(settingHint(MODEL_HINT_EXAMPLES, MODEL_HINT_SHORTCUTS))] };
    const title = `${PANCODE_PRODUCT_NAME} Models`;

    if (!request || request === "list") {
      const chatCount = registry.available.filter((m) => isChatModel(m.id)).length;
      const providerCount = new Set(registry.available.map((m) => m.provider)).size;

      const sections: PanelSection[] = [
        { rows: [kv("Current:", currentRef)] },
        ...buildTierGroupedSections(currentRef, registry.available, profiles),
        { rows: [text(`${chatCount} models across ${providerCount} providers`)] },
        { rows: [text(`Say "use claude sonnet" or "switch to gpt-5.4" to change models.`)] },
        modelHintRow,
      ];
      sendPanelSpec(cb.emitPanel, { title, sections });
      return;
    }

    if (request === "all") {
      sendPanelSpec(cb.emitPanel, {
        title,
        sections: [
          { rows: [text(readOnlyBanner())] },
          {
            rows: [
              kv("Current:", `${currentRef}  ${inlineHint("use qwen model")}`),
              kv("Total available:", `${registry.available.filter((m) => isChatModel(m.id)).length} models`),
            ],
          },
          { rows: formatAllAvailableLines(currentRef, registry.available, profiles).map((line) => text(line)) },
          modelHintRow,
        ],
      });
      return;
    }

    const providerModels = registry.available.filter((m) => m.provider === request);
    if (providerModels.length > 0) {
      sendPanelSpec(cb.emitPanel, {
        title,
        sections: [
          { rows: [text(readOnlyBanner())] },
          { rows: [kv("Current:", `${currentRef}  ${inlineHint("use qwen model")}`)] },
          { rows: formatProviderModelLines(currentRef, request, providerModels, profiles).map((line) => text(line)) },
          modelHintRow,
        ],
      });
      return;
    }

    // Model ref was provided that would have been a switch. Show info panel with hint.
    sendPanelSpec(cb.emitPanel, {
      title,
      sections: [
        { rows: [text(readOnlyBanner())] },
        { rows: [kv("Current:", `${currentRef}  ${inlineHint(`use ${request}`)}`)] },
        {
          heading: "Active (loaded on connected engines):",
          rows: formatActiveModelLines(currentRef, profiles).map((line) => text(line)),
        },
        { rows: [text(`To switch to "${request}", ask Panos: "use ${request}"`)] },
        modelHintRow,
      ],
    });
  };

  const handleReasoningCommand: CommandHandler = async (args, ctx) => {
    const request = args.trim();

    const sections: PanelSection[] = [
      { rows: [text(readOnlyBanner())] },
      {
        rows: [
          kv("Preference:", `${state.currentReasoningPreference}  ${inlineHint("set reasoning to high")}`),
          kv("Engine setting:", cb.getThinkingLevel()),
          kv("Model:", ctx.model ? modelRef(ctx.model) : "unresolved"),
          kv("Capability:", describeReasoningCapability(ctx.model)),
          blank(),
          text("Values: off, minimal, low, medium, high, xhigh (or legacy: on)"),
        ],
      },
    ];

    if (request) {
      sections.push({
        rows: [text(`To apply "${request}", ask Panos: "set reasoning to ${request}"`)],
      });
    }

    sections.push({
      rows: [text(settingHint(["set reasoning to high", "turn off reasoning"], ["shift+tab:mode", "alt+a:admin"]))],
    });

    sendPanelSpec(cb.emitPanel, { title: `${PANCODE_PRODUCT_NAME} Reasoning`, sections });
  };

  const handlePreferencesCommand: CommandHandler = async (args, ctx) => {
    const request = args.trim();
    const enabledDomains = process.env.PANCODE_ENABLED_DOMAINS ?? "all";
    const intelligenceEnabled =
      process.env.PANCODE_INTELLIGENCE === "true" || process.env.PANCODE_INTELLIGENCE === "enabled";
    const budgetCeilingNum = Number.parseFloat(process.env.PANCODE_BUDGET_CEILING ?? "10.0") || 10.0;
    const budgetCeiling = budgetCeilingNum.toFixed(2);
    const modeInfo = getModeDefinition();
    const currentSafety = process.env.PANCODE_SAFETY ?? DEFAULT_SAFETY;

    if (!request || request === "list") {
      sendPanelSpec(cb.emitPanel, {
        title: `${PANCODE_PRODUCT_NAME} Settings`,
        sections: [
          { rows: [text(readOnlyBanner())] },
          {
            heading: "Configuration:",
            indent: 2,
            rows: [
              kv("Safety mode:", `${currentSafety}  ${inlineHint("change safety to suggest")}`),
              kv(
                "Orchestrator model:",
                `${ctx.model ? modelRef(ctx.model) : "unresolved"}  ${inlineHint("use qwen model")}`,
              ),
              kv(
                "Worker model:",
                `${process.env.PANCODE_WORKER_MODEL ?? "(inherit from routing)"}  ${inlineHint("set worker model to nemotron")}`,
              ),
              kv("Reasoning:", `${state.currentReasoningPreference}  ${inlineHint("set reasoning to high")}`),
              kv("Theme:", `${ctx.ui.theme.name ?? state.currentThemeName}  ${inlineHint("switch to dark theme")}`),
              kv("Budget ceiling:", `$${budgetCeiling}  ${inlineHint("set budget to $20")}`),
              kv("Active domains:", enabledDomains),
              kv(
                "Intelligence:",
                `${intelligenceEnabled ? "enabled" : "disabled"}  ${inlineHint("turn off intelligence")}`,
              ),
              kv("Mode:", `${modeInfo.name}  ${inlineHint("switch to plan mode")}`),
            ],
          },
          {
            heading: "Runtimes:",
            indent: 2,
            rows: formatRuntimeInfoRows(),
          },
          {
            rows: [
              text("All configuration changes happen through conversation with Panos."),
              text(
                settingHint(
                  ["set budget to $20", "switch to plan mode", "use qwen model"],
                  ["ctrl+y:safety", "shift+tab:mode", "alt+a:admin"],
                ),
              ),
            ],
          },
        ],
      });
      return;
    }

    // Subcommands now display current value with a hint instead of mutating.
    const [subcommand, ...rest] = request.split(/\s+/);
    const value = rest.join(" ").trim();

    switch (subcommand) {
      case "theme":
        await handleThemeCommand(value, ctx);
        return;
      case "reasoning":
        await handleReasoningCommand(value, ctx);
        return;
      case "model":
        await handleModelsCommand(value, ctx);
        return;
      case "safety": {
        const sections: PanelSection[] = [
          { rows: [text(readOnlyBanner())] },
          {
            rows: [kv("Current safety:", `${currentSafety}  ${inlineHint("change safety to suggest")}`)],
          },
        ];
        if (value) {
          sections.push({ rows: [text(`To apply "${value}", ask Panos: "change safety to ${value}"`)] });
        }
        sections.push({
          rows: [text(settingHint(["change safety to suggest", "set safety to full-auto"], ["ctrl+y:safety"]))],
        });
        sendPanelSpec(cb.emitPanel, { title: `${PANCODE_PRODUCT_NAME} Safety`, sections });
        return;
      }
      case "worker-model": {
        const currentWorker = process.env.PANCODE_WORKER_MODEL ?? "(inherit from routing)";
        const sections: PanelSection[] = [
          { rows: [text(readOnlyBanner())] },
          {
            rows: [kv("Worker model:", `${currentWorker}  ${inlineHint("set worker model to nemotron")}`)],
          },
        ];
        if (value) {
          sections.push({ rows: [text(`To apply "${value}", ask Panos: "set worker model to ${value}"`)] });
        }
        sections.push({
          rows: [text(settingHint(["set worker model to nemotron"], ["shift+tab:mode"]))],
        });
        sendPanelSpec(cb.emitPanel, { title: `${PANCODE_PRODUCT_NAME} Worker Model`, sections });
        return;
      }
      case "budget": {
        const sections: PanelSection[] = [
          { rows: [text(readOnlyBanner())] },
          {
            rows: [kv("Budget ceiling:", `$${budgetCeiling}  ${inlineHint("set budget to $20")}`)],
          },
        ];
        if (value) {
          sections.push({ rows: [text(`To apply "$${value}", ask Panos: "set budget to $${value}"`)] });
        }
        sections.push({
          rows: [text(settingHint(["set budget to $20", "increase budget to $50"], ["alt+a:admin"]))],
        });
        sendPanelSpec(cb.emitPanel, { title: `${PANCODE_PRODUCT_NAME} Budget`, sections });
        return;
      }
      case "intelligence": {
        const sections: PanelSection[] = [
          { rows: [text(readOnlyBanner())] },
          {
            rows: [
              kv(
                "Intelligence:",
                `${intelligenceEnabled ? "enabled" : "disabled"}  ${inlineHint("turn off intelligence")}`,
              ),
            ],
          },
        ];
        if (value) {
          const label = value === "on" || value === "true" || value === "enabled" ? "enable" : "disable";
          sections.push({ rows: [text(`To ${label} intelligence, ask Panos: "${label} intelligence"`)] });
        }
        sections.push({
          rows: [text(settingHint(["enable intelligence", "turn off intelligence"], ["alt+a:admin"]))],
        });
        sendPanelSpec(cb.emitPanel, { title: `${PANCODE_PRODUCT_NAME} Intelligence`, sections });
        return;
      }
      default:
        ctx.ui.notify(`Unknown settings subcommand: ${subcommand}. Use /settings for available options.`, "error");
    }
  };

  const showDashboard: CommandHandler = async (_args, ctx) => {
    const liveWorkers = getLiveWorkers();
    const ledger = getRunLedger();
    const allRuns = ledger?.getAll() ?? [];
    const metrics = getMetricsLedger();
    const summary = metrics?.getSummary();
    const budget = getBudgetTracker();
    const budgetState = budget?.getState();

    const dashState = buildDashboardState({
      config: buildDashboardConfig(),
      liveWorkers,
      allRuns,
      agentSpecs: agentRegistry.getAll(),
      modelProfiles: getModelProfileCache(),
      contextPercent: Math.round(getContextPercent()),
      contextTokens: getContextTokens(),
      contextWindow: getContextWindow(),
      totalCost: budgetState?.totalCost ?? 0,
      budgetCeiling: budgetState?.ceiling ?? null,
      totalRuns: allRuns.length,
      totalInputTokens: summary?.totalInputTokens ?? 0,
      totalOutputTokens: summary?.totalOutputTokens ?? 0,
      currentModelLabel: ctx.model ? modelRef(ctx.model) : "unresolved",
      reasoningLevel: cb.getThinkingLevel() || "off",
      runtimeCount: runtimeRegistry.available().length,
      recentLogs: getRecentLogs(12),
    });

    const termWidth = process.stdout.columns ?? 120;
    const termHeight = process.stdout.rows ?? 40;
    const lines = renderDashboard(dashState, termWidth, termHeight, PLAIN_COLORIZER);
    // Strip trailing blank lines from fitToHeight padding (only useful in live view).
    while (lines.length > 0 && lines[lines.length - 1].trim() === "") {
      lines.pop();
    }

    sendPanel(cb.emitPanel, `${PANCODE_PRODUCT_NAME} Dashboard`, lines);
  };

  const handleModesCommand: CommandHandler = async (args, _ctx) => {
    const request = args.trim().toLowerCase();
    const current = getModeDefinition();
    const modeRows: PanelRow[] = [];
    for (const def of MODE_DEFINITIONS) {
      const marker = def.id === current.id ? "*" : "-";
      const dispatch = def.dispatchEnabled ? "dispatch" : "no dispatch";
      const mutations = def.mutationsAllowed ? "mutations" : "readonly";
      modeRows.push(text(`${marker} ${def.name.padEnd(8)} ${def.description} (${dispatch}, ${mutations})`));
    }

    const sections: PanelSection[] = [
      { rows: [text(readOnlyBanner())] },
      { rows: [kv("Current:", `${current.name}  ${inlineHint("switch to plan mode")}`)] },
      { indent: 2, rows: modeRows },
    ];

    if (request) {
      const target = MODE_DEFINITIONS.find((d) => d.id === request || d.name.toLowerCase() === request);
      if (target) {
        sections.push({
          rows: [text(`To switch to ${target.name}, ask Panos: "switch to ${target.name.toLowerCase()} mode"`)],
        });
      } else {
        sections.push({
          rows: [text(`Unknown mode: ${request}. Available: admin, plan, build, review`)],
        });
      }
    }

    sections.push({
      rows: [text(settingHint(["switch to plan mode", "enter review mode"], ["shift+tab:mode", "alt+a:admin"]))],
    });

    sendPanelSpec(cb.emitPanel, { title: `${PANCODE_PRODUCT_NAME} Modes`, sections });
  };

  const handleHelpCommand: CommandHandler = async (_args, _ctx) => {
    const helpLines = formatCategorizedHelp();
    helpLines.push("", "All configuration changes happen through conversation with Panos.");
    sendPanelSpec(cb.emitPanel, {
      title: `${PANCODE_PRODUCT_NAME} Commands`,
      sections: [{ rows: helpLines.map((line) => text(line)) }],
    });
  };

  const handlePresetCommand: CommandHandler = async (args, ctx) => {
    const configDir = getConfigDir();
    const presets = loadPresets(configDir);
    const request = args.trim();

    const current = process.env.PANCODE_PRESET ?? "(none)";
    const presetLines: string[] = [];
    for (const [name, preset] of presets) {
      const marker = name === current ? "*" : "-";
      presetLines.push(`  ${marker} ${name.padEnd(14)} ${preset.description}`);
      presetLines.push(
        `    model: ${preset.model ?? "(not set)"}  worker: ${preset.workerModel ?? "(same)"}  scout: ${preset.scoutModel ?? preset.model ?? "(not set)"}  reasoning: ${preset.reasoning}  safety: ${preset.safety}`,
      );
    }

    const sections: PanelSection[] = [
      { rows: [text(readOnlyBanner())] },
      { rows: [kv("Active preset:", `${current}  ${inlineHint("apply local preset")}`)] },
      { rows: presetLines.map((line) => text(line)) },
    ];

    if (request && request !== "list") {
      const preset = presets.get(request);
      if (preset) {
        sections.push({
          rows: [text(`To apply "${request}", ask Panos: "apply ${request} preset"`)],
        });
      } else {
        sections.push({
          rows: [text(`Unknown preset: ${request}. See available presets above.`)],
        });
      }
    }

    sections.push({
      rows: [text(settingHint(["apply local preset", "use cloud preset"], ["shift+tab:mode", "alt+a:admin"]))],
    });

    sendPanelSpec(cb.emitPanel, { title: `${PANCODE_PRODUCT_NAME} Presets`, sections });
  };

  const handlePerfCommand: CommandHandler = async (_args, _ctx) => {
    const timings = getBootTimings();
    if (!timings) {
      sendPanel(cb.emitPanel, `${PANCODE_PRODUCT_NAME} Performance`, ["No boot timing data available."]);
      return;
    }

    const lines: string[] = [`Boot mode: ${timings.mode}`, ""];
    const maxLabel = Math.max(...timings.phases.map((p) => p.label.length));
    let slowestIdx = 0;
    for (let i = 1; i < timings.phases.length; i++) {
      if (timings.phases[i].durationMs > timings.phases[slowestIdx].durationMs) {
        slowestIdx = i;
      }
    }

    for (let i = 0; i < timings.phases.length; i++) {
      const phase = timings.phases[i];
      const labelPad = phase.label.padEnd(maxLabel);
      const ms = phase.durationMs.toFixed(0).padStart(6);
      const marker = i === slowestIdx ? "  << slowest" : "";
      lines.push(`  ${labelPad}: ${ms}ms${marker}`);
    }

    const budgetStatus = timings.budgetExceeded ? "EXCEEDED" : "OK";
    lines.push("");
    lines.push(
      `  ${"TOTAL".padEnd(maxLabel)}: ${timings.totalMs.toFixed(0).padStart(6)}ms  (budget: ${timings.budgetMs}ms ${budgetStatus})`,
    );
    sendPanel(cb.emitPanel, `${PANCODE_PRODUCT_NAME} Performance`, lines);
  };

  const handleSafetyCommand: CommandHandler = async (args, _ctx) => {
    const request = args.trim().toLowerCase();
    const currentSafety = process.env.PANCODE_SAFETY ?? DEFAULT_SAFETY;

    const sections: PanelSection[] = [
      { rows: [text(readOnlyBanner())] },
      { rows: [kv("Current:", `${currentSafety}  ${inlineHint("change safety to suggest")}`)] },
      {
        heading: "Levels:",
        rows: [
          text(
            `  ${currentSafety === "suggest" ? "*" : "-"} suggest      Read-only. All mutations require confirmation.`,
          ),
          text(
            `  ${currentSafety === "auto-edit" ? "*" : "-"} auto-edit    File edits allowed. Destructive actions blocked.`,
          ),
          text(`  ${currentSafety === "full-auto" ? "*" : "-"} full-auto    All actions allowed. No guardrails.`),
        ],
      },
    ];

    if (request) {
      sections.push({
        rows: [text(`To apply "${request}", ask Panos: "change safety to ${request}"`)],
      });
    }

    sections.push({
      rows: [text(settingHint(["change safety to suggest", "set safety to full-auto"], ["ctrl+y:safety"]))],
    });

    sendPanelSpec(cb.emitPanel, { title: `${PANCODE_PRODUCT_NAME} Safety`, sections });
  };

  const handleExitCommand: CommandHandler = async (_args, ctx) => {
    ctx.shutdown();
  };

  const handleHotkeysCommand: CommandHandler = async (_args, _ctx) => {
    const sections: PanelSection[] = [
      {
        heading: "PanCode Shortcuts",
        rows: [
          kv(
            "shift+tab",
            "Cycle mode (Plan > Build > Review). Auto-sets reasoning per mode unless explicitly overridden.",
          ),
          kv("alt+a", "Toggle Admin (God) mode"),
          kv("ctrl+y", "Cycle safety level (suggest > auto-edit > full-auto). Replaces Emacs yank (kill-ring paste)."),
        ],
      },
      {
        heading: "Navigation and Input",
        rows: [
          kv("ctrl+c", "Interrupt current generation"),
          kv("ctrl+d", "Exit PanCode"),
          kv("escape", "Cancel current input or dismiss"),
          kv("shift+enter", "Insert new line without submitting"),
          kv("alt+enter", "Submit follow-up message"),
          kv("ctrl+v", "Paste image from clipboard"),
        ],
      },
      {
        heading: "Model and Thinking",
        rows: [
          kv("ctrl+p", "Cycle model forward"),
          kv("shift+ctrl+p", "Cycle model backward"),
          kv("ctrl+l", "Select model (interactive)"),
          kv("ctrl+t", "Toggle thinking display"),
          kv("ctrl+o", "Expand tool details"),
        ],
      },
      {
        heading: "Editor",
        rows: [
          kv("ctrl+g", "Open external editor"),
          kv("ctrl+k", "Delete to end of line"),
          kv("alt+up", "Dequeue last message"),
          kv("ctrl+z", "Suspend to shell (fg to resume)"),
        ],
      },
    ];
    sendPanelSpec(cb.emitPanel, { title: `${PANCODE_PRODUCT_NAME} Keyboard Shortcuts`, sections });
  };

  return {
    handleThemeCommand,
    handleModelsCommand,
    handleReasoningCommand,
    handlePreferencesCommand,
    showDashboard,
    handleModesCommand,
    handleHelpCommand,
    handlePresetCommand,
    handlePerfCommand,
    handleSafetyCommand,
    handleExitCommand,
    handleHotkeysCommand,
  };
}
