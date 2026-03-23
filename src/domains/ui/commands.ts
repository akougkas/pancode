import { readFileSync } from "node:fs";
import { join } from "node:path";
import { getBootTimings } from "../../core/boot-timing";
import type { SafetyLevel } from "../../core/config";
import { isSafetyLevel } from "../../core/config-validator";
import { DEFAULT_SAFETY } from "../../core/defaults";
import { PanMessageType } from "../../core/message-types";
import {
  MODE_DEFINITIONS,
  type ModeDefinition,
  getModeDefinition,
  getToolsetForMode,
  setCurrentMode,
} from "../../core/modes";
import { loadPresets } from "../../core/presets";
import { writePanCodeSettings } from "../../core/settings-state";
import { PANCODE_PRODUCT_NAME, formatCategorizedHelp } from "../../core/shell-metadata";
import {
  type PanCodeReasoningPreference,
  THINKING_LEVELS,
  getModelReasoningControl,
  parseReasoningPreference,
} from "../../core/thinking";
import type { ExtensionContext } from "../../engine/extensions";
import { runtimeRegistry } from "../../engine/runtimes";
import type { ThemeColor } from "../../engine/tui";
import type { Api, Model } from "../../engine/types";
import { agentRegistry } from "../agents";
import { getRunLedger } from "../dispatch";
import { getMetricsLedger } from "../observability";
import { type MergedModelProfile, getModelProfileCache } from "../providers";
import { getBudgetTracker } from "../scheduling";

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
  return (title: string, body: string) => {
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

export function buildWelcomeScreen(modelLabel: string, modeName: string): string[] {
  const version = process.env.npm_package_version ?? readPackageVersion();
  const modelShort = modelLabel.includes("/") ? (modelLabel.split("/").pop() ?? modelLabel) : modelLabel;
  const profiles = getModelProfileCache();
  const agentCount = agentRegistry.getAll().length;
  const runtimeCount = runtimeRegistry.available().length;
  const nodeSummary = buildNodeSummary(profiles);

  const lines: string[] = [
    "  \u2554\u2550\u2557",
    `  \u2560\u2550\u255D a n C o d e  v${version}`,
    "  \u255A",
    `  ${modeName}  ${modelShort}`,
  ];

  const infoParts: string[] = [];
  if (agentCount > 0) infoParts.push(`${agentCount} agents`);
  if (runtimeCount > 0) infoParts.push(`${runtimeCount} runtimes`);
  const nodeCount = new Set(profiles.map((p) => p.providerId.split("-")[0] || p.providerId)).size;
  if (nodeCount > 0) infoParts.push(`${nodeCount} nodes`);
  if (infoParts.length > 0) lines.push(`  ${infoParts.join("  ")}`);
  if (nodeSummary.length > 0) lines.push(`  ${nodeSummary.join("  ")}`);

  lines.push("", "  shift+tab mode  /help commands");
  return lines;
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

function parseReasoningCommand(request: string): {
  preference: PanCodeReasoningPreference;
  note: string | null;
} | null {
  const normalized = request.trim().toLowerCase();
  const preference = parseReasoningPreference(normalized);
  if (!preference) return null;
  return { preference, note: null };
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
 */
function formatAvailableSummary(registryAvailable: ReadonlyArray<Model<Api>>): string[] {
  const chatModels = registryAvailable.filter((m) => isChatModel(m.id));
  if (chatModels.length === 0) return [];

  const providerSet = new Set<string>();
  for (const m of chatModels) providerSet.add(m.provider);
  const providerLabel = providerSet.size === 1 ? "1 provider" : `${providerSet.size} providers`;

  return ["", `Available: ${chatModels.length} models across ${providerLabel}. Use /models all to browse.`];
}

/**
 * Format a filtered list for a single provider.
 */
function formatProviderModelLines(
  currentRef: string,
  providerName: string,
  models: ReadonlyArray<Model<Api>>,
  profiles: MergedModelProfile[],
): string[] {
  const chatModels = models.filter((m) => isChatModel(m.id));
  const sorted = [...chatModels].sort((a, b) => a.id.localeCompare(b.id));
  const lines: string[] = [`${providerName} (${sorted.length} models):`];

  for (const model of sorted) {
    const ref = modelRef(model);
    const marker = ref === currentRef ? "*" : "-";
    const caps = formatRegistryModelCapabilities(model, profiles);
    lines.push(`  ${marker} ${model.id}${caps}`);
  }

  lines.push("", "Use /models <provider/model-id> to switch.");
  return lines;
}

/**
 * Format all available models grouped by provider (for /models all).
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
      lines.push(model.provider);
    }

    const ref = modelRef(model);
    const marker = ref === currentRef ? "*" : "-";
    const caps = formatRegistryModelCapabilities(model, profiles);
    lines.push(`  ${marker} ${model.id}${caps}`);
  }

  lines.push("", "Use /models <provider/model-id> to switch.");
  return lines;
}

function resolveModelSelection(
  request: string,
  models: ReadonlyArray<Model<Api>>,
): { model?: Model<Api>; error?: string } {
  const trimmed = request.trim();
  if (!trimmed) {
    return { error: "Missing model reference. Use provider/model-id." };
  }

  if (trimmed.includes("/")) {
    const exactMatch = models.find((model) => modelRef(model) === trimmed);
    return exactMatch ? { model: exactMatch } : { error: `Model not found: ${trimmed}` };
  }

  const matchingIds = models.filter((model) => model.id === trimmed);
  if (matchingIds.length === 1) return { model: matchingIds[0] };
  if (matchingIds.length > 1) {
    return { error: `Model id "${trimmed}" is ambiguous. Use provider/model-id.` };
  }

  return { error: `Model not found: ${trimmed}` };
}

// ---------------------------------------------------------------------------
// Command handler factory
// ---------------------------------------------------------------------------

export function createCommandHandlers(state: UiCommandState, cb: UiCommandCallbacks): CommandHandlers {
  const handleThemeCommand: CommandHandler = async (args, ctx) => {
    const request = args.trim();
    const themes = ctx.ui
      .getAllThemes()
      .map((themeInfo) => themeInfo.name)
      .sort();

    if (!request || request === "list") {
      const lines = themes.map((name) => `${name === ctx.ui.theme.name ? "*" : "-"} ${name}`);
      sendPanel(cb.emitPanel, `${PANCODE_PRODUCT_NAME} Themes`, lines);
      return;
    }

    const result = ctx.ui.setTheme(request);
    if (!result.success) {
      ctx.ui.notify(result.error ?? `Theme not found: ${request}`, "error");
      return;
    }

    state.currentThemeName = request;
    persistSettings({ theme: request }, (message, level) => ctx.ui.notify(message, level));
    ctx.ui.setStatus("theme", `Theme: ${request}`);
    ctx.ui.notify(`Theme set to ${request}`, "info");
    state.themeFg = (color, text) => ctx.ui.theme.fg(color, text);
    cb.syncEditorDisplay();
  };

  const handleModelsCommand: CommandHandler = async (args, ctx) => {
    const request = args.trim();
    const registry = getRegisteredModels(ctx);
    const profiles = getModelProfileCache();
    const currentRef = ctx.model ? modelRef(ctx.model) : "unresolved";

    if (!request || request === "list") {
      const lines: string[] = [
        `Current: ${currentRef}`,
        "",
        "Active (loaded on connected engines):",
        ...formatActiveModelLines(currentRef, profiles),
        ...formatAvailableSummary(registry.available),
      ];
      sendPanel(cb.emitPanel, `${PANCODE_PRODUCT_NAME} Models`, lines);
      return;
    }

    if (request === "all") {
      sendPanel(cb.emitPanel, `${PANCODE_PRODUCT_NAME} Models`, [
        `Current: ${currentRef}`,
        `Total available: ${registry.available.length} models`,
        "",
        ...formatAllAvailableLines(currentRef, registry.available, profiles),
      ]);
      return;
    }

    const providerModels = registry.available.filter((m) => m.provider === request);
    if (providerModels.length > 0) {
      sendPanel(cb.emitPanel, `${PANCODE_PRODUCT_NAME} Models`, [
        `Current: ${currentRef}`,
        "",
        ...formatProviderModelLines(currentRef, request, providerModels, profiles),
      ]);
      return;
    }

    const selection = resolveModelSelection(request, registry.available);
    if (!selection.model) {
      ctx.ui.notify(selection.error ?? `Model not found: ${request}`, "error");
      return;
    }

    const changed = await cb.setModel(selection.model);
    if (!changed) {
      ctx.ui.notify(
        `Could not switch to ${modelRef(selection.model)}. Provider credentials may be unavailable.`,
        "error",
      );
      return;
    }

    state.currentModelLabel = modelRef(selection.model);
    ctx.ui.setStatus("model", `Model: ${state.currentModelLabel}`);
    ctx.ui.notify(`Model set to ${state.currentModelLabel}`, "info");
  };

  const handleReasoningCommand: CommandHandler = async (args, ctx) => {
    const request = args.trim();
    if (!request) {
      sendPanel(cb.emitPanel, `${PANCODE_PRODUCT_NAME} Reasoning`, [
        `Preference: ${state.currentReasoningPreference}`,
        `Applied engine setting: ${cb.getThinkingLevel()}`,
        `Model: ${ctx.model ? modelRef(ctx.model) : "unresolved"}`,
        `Capability: ${describeReasoningCapability(ctx.model)}`,
        "PanCode values: off, minimal, low, medium, high, xhigh (or legacy: on)",
      ]);
      return;
    }

    const parsed = parseReasoningCommand(request);
    if (!parsed) {
      ctx.ui.notify(`Invalid reasoning value: ${request}. Use off, minimal, low, medium, high, or xhigh.`, "error");
      return;
    }

    cb.applyReasoningLevel(parsed.preference, ctx.model, (m, l) => ctx.ui.notify(m, l));

    const capability = describeReasoningCapability(ctx.model);
    const effective = cb.getThinkingLevel();
    ctx.ui.setStatus("thinking", `Reasoning: ${state.currentReasoningPreference}`);
    if (capability === "unsupported" && state.currentReasoningPreference !== "off") {
      ctx.ui.notify("Reasoning preference saved. The current model leaves the engine setting at off.", "warning");
      return;
    }

    ctx.ui.notify(
      `Reasoning: ${state.currentReasoningPreference} | engine: ${effective} | capability: ${capability}`,
      "info",
    );
  };

  const handlePreferencesCommand: CommandHandler = async (args, ctx) => {
    const request = args.trim();
    if (!request || request === "list") {
      const enabledDomains = process.env.PANCODE_ENABLED_DOMAINS ?? "all";
      const intelligenceEnabled = process.env.PANCODE_INTELLIGENCE !== "false";
      const budgetCeiling = process.env.PANCODE_BUDGET_CEILING ?? "10.0";
      const modeInfo = getModeDefinition();

      sendPanel(cb.emitPanel, `${PANCODE_PRODUCT_NAME} Settings`, [
        "Configuration:",
        `  Safety mode:           ${process.env.PANCODE_SAFETY ?? DEFAULT_SAFETY}`,
        `  Orchestrator model:    ${ctx.model ? modelRef(ctx.model) : "unresolved"}`,
        `  Worker model:          ${process.env.PANCODE_WORKER_MODEL ?? "(inherit from routing)"}`,
        `  Reasoning:             ${state.currentReasoningPreference}`,
        `  Theme:                 ${ctx.ui.theme.name ?? state.currentThemeName}`,
        `  Budget ceiling:        $${budgetCeiling}`,
        `  Active domains:        ${enabledDomains}`,
        `  Intelligence:          ${intelligenceEnabled ? "enabled" : "disabled"}`,
        `  Mode:                  ${modeInfo.name}`,
        "",
        "Subcommands:",
        "  /settings safety <suggest|auto-edit|full-auto>",
        "  /settings model <provider/model-id>",
        "  /settings worker-model <provider/model-id>",
        "  /settings reasoning <off|on>",
        "  /settings theme <name>",
        "  /settings budget <amount>",
        "  /settings intelligence <on|off>",
      ]);
      return;
    }

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
        if (!value || !isSafetyLevel(value)) {
          ctx.ui.notify("Invalid safety level. Use: suggest, auto-edit, full-auto", "error");
          return;
        }
        process.env.PANCODE_SAFETY = value;
        persistSettings({ safetyMode: value }, (message, level) => ctx.ui.notify(message, level));
        ctx.ui.notify(`Safety mode set to ${value}`, "info");
        return;
      }
      case "worker-model": {
        if (!value) {
          ctx.ui.notify("Usage: /settings worker-model <provider/model-id>", "error");
          return;
        }
        process.env.PANCODE_WORKER_MODEL = value;
        persistSettings({ workerModel: value }, (message, level) => ctx.ui.notify(message, level));
        ctx.ui.notify(`Worker model set to ${value}`, "info");
        return;
      }
      case "budget": {
        const newCeiling = Number.parseFloat(value);
        if (!Number.isFinite(newCeiling) || newCeiling <= 0) {
          ctx.ui.notify("Invalid budget amount. Use: /settings budget <positive number>", "error");
          return;
        }
        process.env.PANCODE_BUDGET_CEILING = String(newCeiling);
        persistSettings({ budgetCeiling: newCeiling }, (message, level) => ctx.ui.notify(message, level));
        ctx.ui.notify(`Budget ceiling set to $${newCeiling.toFixed(2)}`, "info");
        return;
      }
      case "intelligence": {
        const enabled = value === "on" || value === "true" || value === "enabled";
        const disabled = value === "off" || value === "false" || value === "disabled";
        if (!enabled && !disabled) {
          ctx.ui.notify("Usage: /settings intelligence <on|off>", "error");
          return;
        }
        process.env.PANCODE_INTELLIGENCE = enabled ? "true" : "false";
        persistSettings({ intelligence: enabled }, (message, level) => ctx.ui.notify(message, level));
        ctx.ui.notify(`Intelligence ${enabled ? "enabled" : "disabled"}`, "info");
        return;
      }
      default:
        ctx.ui.notify(`Unknown settings subcommand: ${subcommand}. Use /settings for available options.`, "error");
    }
  };

  const showDashboard: CommandHandler = async (_args, ctx) => {
    const modelLabel = ctx.model ? modelRef(ctx.model) : "unresolved";
    const dashMode = getModeDefinition();
    const lines = [...buildWelcomeScreen(modelLabel, dashMode.name)];

    const ledger = getRunLedger();
    const metrics = getMetricsLedger();
    const budget = getBudgetTracker();
    const summary = metrics?.getSummary();
    const allRuns = ledger?.getAll() ?? [];
    const activeCount = allRuns.filter((r) => r.status === "running").length;

    if (allRuns.length > 0) {
      const parts: string[] = [`${allRuns.length} dispatches`];
      if (activeCount > 0) parts.push(`${activeCount} active`);
      if (summary && summary.totalCost != null && summary.totalCost > 0) {
        parts.push(`$${summary.totalCost.toFixed(4)} spent`);
      }
      if (budget) {
        const budgetState = budget.getState();
        if (budgetState.totalCost > 0) parts.push(`$${budgetState.ceiling.toFixed(2)} ceiling`);
      }
      lines.push("", `Session: ${parts.join("  ")}`);
    }

    sendPanel(cb.emitPanel, `${PANCODE_PRODUCT_NAME} Dashboard`, lines);
  };

  const handleModesCommand: CommandHandler = async (args, ctx) => {
    const request = args.trim().toLowerCase();
    if (!request) {
      const current = getModeDefinition();
      const lines: string[] = [`Current: ${current.name}`, ""];
      for (const def of MODE_DEFINITIONS) {
        const marker = def.id === current.id ? "*" : "-";
        const dispatch = def.dispatchEnabled ? "dispatch" : "no dispatch";
        const mutations = def.mutationsAllowed ? "mutations" : "readonly";
        lines.push(`  ${marker} ${def.name.padEnd(8)} ${def.description} (${dispatch}, ${mutations})`);
      }
      lines.push("", "Use /modes <name> to switch, or Shift+Tab to cycle.");
      sendPanel(cb.emitPanel, `${PANCODE_PRODUCT_NAME} Modes`, lines);
      return;
    }

    const target = MODE_DEFINITIONS.find((d) => d.id === request || d.name.toLowerCase() === request);
    if (!target) {
      ctx.ui.notify(`Unknown mode: ${request}. Available: capture, plan, build, ask, review`, "error");
      return;
    }

    setCurrentMode(target.id);
    cb.setActiveTools(getToolsetForMode(target.id));
    cb.applyReasoningLevel(target.reasoningLevel, ctx.model, (m, l) => ctx.ui.notify(m, l));
    ctx.ui.setStatus("mode", `[${target.name}]`);
    cb.emitModeTransition(target);
    cb.syncEditorDisplay();
  };

  const handleHelpCommand: CommandHandler = async (_args, _ctx) => {
    sendPanel(cb.emitPanel, `${PANCODE_PRODUCT_NAME} Commands`, formatCategorizedHelp());
  };

  const handlePresetCommand: CommandHandler = async (args, ctx) => {
    const pancodeHome = process.env.PANCODE_HOME;
    if (!pancodeHome) {
      ctx.ui.notify("PANCODE_HOME is not set.", "error");
      return;
    }
    const presets = loadPresets(pancodeHome);
    const request = args.trim();

    if (!request || request === "list") {
      const current = process.env.PANCODE_PRESET ?? "(none)";
      const lines: string[] = [`Active preset: ${current}`, ""];
      for (const [name, preset] of presets) {
        const marker = name === current ? "*" : "-";
        lines.push(`  ${marker} ${name.padEnd(14)} ${preset.description}`);
        lines.push(
          `    model: ${preset.model}  worker: ${preset.workerModel ?? "(same)"}  scout: ${preset.scoutModel ?? preset.model}  reasoning: ${preset.reasoning}  safety: ${preset.safety}`,
        );
      }
      lines.push("", "Use /preset <name> to apply. Edit ~/.pancode/panpresets.yaml to customize.");
      sendPanel(cb.emitPanel, `${PANCODE_PRODUCT_NAME} Presets`, lines);
      return;
    }

    const preset = presets.get(request);
    if (!preset) {
      ctx.ui.notify(`Unknown preset: ${request}. Use /preset to see available presets.`, "error");
      return;
    }

    process.env.PANCODE_PRESET = request;
    if (preset.workerModel) {
      process.env.PANCODE_WORKER_MODEL = preset.workerModel;
    } else {
      process.env.PANCODE_WORKER_MODEL = undefined;
    }
    if (preset.scoutModel) {
      process.env.PANCODE_SCOUT_MODEL = preset.scoutModel;
    } else {
      process.env.PANCODE_SCOUT_MODEL = undefined;
    }
    process.env.PANCODE_SAFETY = preset.safety;
    cb.applyReasoningLevel(preset.reasoning, ctx.model, (m, l) => ctx.ui.notify(m, l));

    const slashIdx = preset.model.indexOf("/");
    if (slashIdx > 0) {
      await handleModelsCommand(preset.model, ctx);
    }

    cb.syncEditorDisplay();

    const workerLabel = preset.workerModel ?? "(orchestrator model)";
    const scoutLabel = preset.scoutModel ?? "(orchestrator model)";
    cb.sendPiMessage({
      customType: PanMessageType.MODE_TRANSITION,
      content: `[PRESET SWITCH] Now using ${request}. Orchestrator: ${preset.model}. Workers: ${workerLabel}. Scouts: ${scoutLabel}. Conversation preserved.`,
      display: true,
      details: { title: `Preset: ${request}` },
    });
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

  const handleSafetyCommand: CommandHandler = async (args, ctx) => {
    const request = args.trim().toLowerCase();
    const currentSafety = (process.env.PANCODE_SAFETY ?? DEFAULT_SAFETY) as SafetyLevel;

    if (!request) {
      sendPanel(cb.emitPanel, `${PANCODE_PRODUCT_NAME} Safety`, [
        `Current: ${currentSafety}`,
        "",
        "Levels:",
        `  ${currentSafety === "suggest" ? "*" : "-"} suggest      Read-only. All mutations require confirmation.`,
        `  ${currentSafety === "auto-edit" ? "*" : "-"} auto-edit    File edits allowed. Destructive actions blocked.`,
        `  ${currentSafety === "full-auto" ? "*" : "-"} full-auto    All actions allowed. No guardrails.`,
        "",
        "Use /safety <level> to switch. Changes take effect immediately.",
        "Keyboard: ctrl+y to cycle.",
      ]);
      return;
    }

    if (!isSafetyLevel(request)) {
      ctx.ui.notify("Invalid safety level. Use: suggest, auto-edit, full-auto", "error");
      return;
    }

    process.env.PANCODE_SAFETY = request;
    persistSettings({ safetyMode: request }, (message, level) => ctx.ui.notify(message, level));
    ctx.ui.setStatus("safety", `Safety: ${request}`);
    ctx.ui.notify(`Safety level set to ${request} (effective immediately)`, "info");
    cb.syncEditorDisplay();
  };

  const handleExitCommand: CommandHandler = async (_args, ctx) => {
    ctx.shutdown();
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
  };
}
