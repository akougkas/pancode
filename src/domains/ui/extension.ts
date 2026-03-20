import type { SafetyLevel } from "../../core/config";
import { isSafetyLevel } from "../../core/config-validator";
import { DEFAULT_REASONING_PREFERENCE, DEFAULT_SAFETY, DEFAULT_THEME } from "../../core/defaults";
import {
  MODE_DEFINITIONS,
  MODE_ORDER,
  type ModeDefinition,
  type OrchestratorMode,
  getCurrentMode,
  getModeDefinition,
  getToolsetForMode,
  setCurrentMode,
} from "../../core/modes";
import { updatePanCodeSettings } from "../../core/settings-state";
import { sharedBus } from "../../core/shared-bus";
import { PANCODE_PRODUCT_NAME, formatCategorizedHelp } from "../../core/shell-metadata";
import {
  type PanCodeReasoningPreference,
  THINKING_LEVELS,
  getModelReasoningControl,
  parseReasoningPreference,
  parseThinkingLevel,
  resolveThinkingLevelForPreference,
} from "../../core/thinking";
import { type ExtensionContext, defineExtension } from "../../engine/extensions";
import { Container, Text, type ThemeColor, truncateToWidth, visibleWidth } from "../../engine/tui";
import type { Api, Model } from "../../engine/types";
import { getRunLedger, taskList } from "../dispatch";
import { getMetricsLedger } from "../observability";
import { type MergedModelProfile, getModelProfileCache } from "../providers";
import { getBudgetTracker } from "../scheduling";
import { getContextPercent, recordContextFromSdk, recordContextUsage } from "./context-tracker";
import { renderDispatchBoard } from "./dispatch-board";
import type { AgentStat, BoardColorizer, DispatchCardData } from "./dispatch-board";
import { PanCodeEditor } from "./pancode-editor";
import { synthesizeOrchestratorPrompt } from "./system-prompt";
import { extractResultSummary } from "./widget-utils";
import {
  getLiveWorkers,
  resetAll as resetLiveWorkers,
  trackWorkerEnd,
  trackWorkerStart,
  updateWorkerProgress,
} from "./worker-widgets";
import type { WorkerStatus } from "./worker-widgets";

function composeSingleLine(left: string, right: string, width: number): string {
  const safeWidth = Math.max(0, width);
  const leftWidth = visibleWidth(left);
  const rightWidth = visibleWidth(right);

  if (leftWidth + rightWidth + 1 <= safeWidth) {
    return `${left}${" ".repeat(safeWidth - leftWidth - rightWidth)}${right}`;
  }

  return truncateToWidth(`${left} ${right}`.trim(), safeWidth);
}

function sendPanel(sendMessage: (title: string, body: string) => void, title: string, lines: string[]): void {
  sendMessage(title, lines.join("\n"));
}

function buildDashboardLines(input: {
  modelLabel: string;
  reasoningPreference: PanCodeReasoningPreference;
  reasoningCapability: string;
  effectiveThinkingLevel: string;
  themeName: string;
  workingDirectory: string;
  tools: string[];
  modeName?: string;
  modeDescription?: string;
}): string[] {
  const mode = input.modeName ?? "Build";
  return [
    `${mode}  ${input.modelLabel}  ${input.workingDirectory}`,
    "",
    "  /help  /models  /mode  /settings  /reasoning",
  ];
}

function readReasoningPreference(): PanCodeReasoningPreference {
  return parseReasoningPreference(process.env.PANCODE_REASONING) ?? DEFAULT_REASONING_PREFERENCE;
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

function persistSettings(
  patch: Parameters<typeof updatePanCodeSettings>[0],
  notify: (message: string, level: "info" | "warning" | "error") => void,
): void {
  try {
    updatePanCodeSettings(patch);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    notify(`Failed to save PanCode settings: ${message}`, "error");
  }
}

function parseReasoningCommand(request: string): {
  preference: PanCodeReasoningPreference;
  note: string | null;
} | null {
  const normalized = request.trim().toLowerCase();
  const preference = parseReasoningPreference(normalized);
  if (preference) {
    return { preference, note: null };
  }

  const legacyThinkingLevel = parseThinkingLevel(normalized);
  if (!legacyThinkingLevel) return null;

  return {
    preference: legacyThinkingLevel === "off" ? "off" : "on",
    note:
      legacyThinkingLevel === "off"
        ? null
        : `PanCode stores reasoning as off/on; mapped "${legacyThinkingLevel}" to "on".`,
  };
}

function modelRef(model: Pick<Model<Api>, "provider" | "id">): string {
  return `${model.provider}/${model.id}`;
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

/**
 * Returns true if the model id looks like a chat/completion model rather than
 * an embedding model, reranker, or other non-conversational model.
 */
function isChatModel(modelId: string): boolean {
  const lower = modelId.toLowerCase();
  // Explicit embedding or reranker keywords
  if (lower.includes("embedding") || lower.includes("reranker")) return false;
  // BGE family (rerankers/embeddings)
  if (/(?:^|[\/-])bge-/.test(lower)) return false;
  // "embed" without "instruct" or "chat" qualifier (e.g., nomic-embed-text)
  if (lower.includes("embed") && !lower.includes("instruct") && !lower.includes("chat")) return false;
  return true;
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

/**
 * Compute per-agent performance statistics from the metrics ledger.
 * Returns an empty array if fewer than 3 total runs exist to avoid noise.
 */
function computeAgentStats(
  runs: ReadonlyArray<{
    agent: string;
    status: string;
    cost: number;
    durationMs: number;
  }>,
): AgentStat[] {
  if (runs.length < 3) return [];

  const byAgent = new Map<string, (typeof runs)[number][]>();
  for (const run of runs) {
    const group = byAgent.get(run.agent) ?? [];
    group.push(run);
    byAgent.set(run.agent, group);
  }

  return [...byAgent.entries()].map(([agent, agentRuns]) => ({
    agent,
    runs: agentRuns.length,
    successRate: Math.round((agentRuns.filter((r) => r.status === "done").length / agentRuns.length) * 100),
    avgCostPerRun: agentRuns.reduce((s, r) => s + r.cost, 0) / agentRuns.length,
    avgDurationMs: agentRuns.reduce((s, r) => s + r.durationMs, 0) / agentRuns.length,
  }));
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

/** Map orchestrator modes to named theme colors for visual differentiation in the TUI. */
function modeThemeColor(mode: ModeDefinition): "accent" | "success" | "warning" | "error" | "muted" {
  switch (mode.id) {
    case "capture":
      return "accent";
    case "plan":
      return "muted";
    case "build":
      return "success";
    case "ask":
      return "warning";
    case "review":
      return "error";
  }
}

export const extension = defineExtension((pi) => {
  let currentModelLabel = "no model";
  let currentThemeName = process.env.PANCODE_THEME?.trim() || DEFAULT_THEME;
  let currentReasoningPreference = readReasoningPreference();
  let welcomeShown = false;
  let pancodeEditor: PanCodeEditor | null = null;
  let themeFg: (color: ThemeColor, text: string) => string = (_c, t) => t;

  const SAFETY_CYCLE: SafetyLevel[] = ["suggest", "auto-edit", "full-auto"];

  function cycleSafety(): SafetyLevel {
    const current = (process.env.PANCODE_SAFETY ?? DEFAULT_SAFETY) as SafetyLevel;
    const idx = SAFETY_CYCLE.indexOf(current);
    return SAFETY_CYCLE[(idx + 1) % SAFETY_CYCLE.length];
  }

  function cycleModeTo(): ModeDefinition {
    const current = getCurrentMode();
    const idx = MODE_ORDER.indexOf(current);
    const next = MODE_ORDER[(idx + 1) % MODE_ORDER.length];
    setCurrentMode(next);
    pi.setActiveTools(getToolsetForMode(next));
    return getModeDefinition(next);
  }

  function syncEditorDisplay(): void {
    if (!pancodeEditor) return;
    const mode = getModeDefinition();
    const safety = process.env.PANCODE_SAFETY ?? DEFAULT_SAFETY;
    const color = modeThemeColor(mode);
    pancodeEditor.setModeDisplay(mode.name, (s) => themeFg(color, s));
    pancodeEditor.setSafetyDisplay(safety);
    pancodeEditor.setModelDisplay(currentModelLabel);
    pancodeEditor.setReasoningDisplay(pi.getThinkingLevel() || "off");
  }

  const emitPanel = (title: string, body: string) => {
    pi.sendMessage({
      customType: "pancode-panel",
      content: body,
      display: true,
      details: { title },
    });
  };

  pi.registerMessageRenderer("pancode-panel", (message, _options, theme) => {
    const title =
      typeof message.details === "object" && message.details && "title" in message.details
        ? String((message.details as { title?: unknown }).title ?? PANCODE_PRODUCT_NAME)
        : PANCODE_PRODUCT_NAME;
    const body = typeof message.content === "string" ? message.content : String(message.content ?? "");
    const text = `${theme.bold(theme.fg("accent", title))}\n${body}`;
    return new Text(text, 1, 0);
  });

  const handleThemeCommand = async (args: string, ctx: ExtensionContext) => {
    const request = args.trim();
    const themes = ctx.ui
      .getAllThemes()
      .map((themeInfo) => themeInfo.name)
      .sort();

    if (!request || request === "list") {
      const lines = themes.map((name) => `${name === ctx.ui.theme.name ? "*" : "-"} ${name}`);
      sendPanel(emitPanel, `${PANCODE_PRODUCT_NAME} Themes`, lines);
      return;
    }

    const result = ctx.ui.setTheme(request);
    if (!result.success) {
      ctx.ui.notify(result.error ?? `Theme not found: ${request}`, "error");
      return;
    }

    currentThemeName = request;
    persistSettings({ theme: request }, (message, level) => ctx.ui.notify(message, level));
    ctx.ui.setStatus("theme", `Theme: ${request}`);
    ctx.ui.notify(`Theme set to ${request}`, "info");
    themeFg = (color, text) => ctx.ui.theme.fg(color, text);
    syncEditorDisplay();
  };

  const handleModelsCommand = async (args: string, ctx: ExtensionContext) => {
    const request = args.trim();
    const registry = getRegisteredModels(ctx);
    const profiles = getModelProfileCache();
    const currentRef = ctx.model ? modelRef(ctx.model) : "unresolved";

    // /models or /models list: overview with Active + Available sections
    if (!request || request === "list") {
      const lines: string[] = [
        `Current: ${currentRef}`,
        "",
        "Active (loaded on connected engines):",
        ...formatActiveModelLines(currentRef, profiles),
        ...formatAvailableSummary(registry.available),
      ];
      sendPanel(emitPanel, `${PANCODE_PRODUCT_NAME} Models`, lines);
      return;
    }

    // /models all: full list of every available chat model grouped by provider
    if (request === "all") {
      sendPanel(emitPanel, `${PANCODE_PRODUCT_NAME} Models`, [
        `Current: ${currentRef}`,
        `Total available: ${registry.available.length} (including embeddings)`,
        "",
        ...formatAllAvailableLines(currentRef, registry.available, profiles),
      ]);
      return;
    }

    // /models <provider>: filter to a single provider if the request matches one
    const providerModels = registry.available.filter((m) => m.provider === request);
    if (providerModels.length > 0) {
      sendPanel(emitPanel, `${PANCODE_PRODUCT_NAME} Models`, [
        `Current: ${currentRef}`,
        "",
        ...formatProviderModelLines(currentRef, request, providerModels, profiles),
      ]);
      return;
    }

    // Otherwise: treat as a model switch request (provider/model-id or bare model-id)
    const selection = resolveModelSelection(request, registry.available);
    if (!selection.model) {
      ctx.ui.notify(selection.error ?? `Model not found: ${request}`, "error");
      return;
    }

    const changed = await pi.setModel(selection.model);
    if (!changed) {
      ctx.ui.notify(
        `Could not switch to ${modelRef(selection.model)}. Provider credentials may be unavailable.`,
        "error",
      );
      return;
    }

    currentModelLabel = modelRef(selection.model);
    ctx.ui.setStatus("model", `Model: ${currentModelLabel}`);
    ctx.ui.notify(`Model set to ${currentModelLabel}`, "info");
  };

  const handleReasoningCommand = async (args: string, ctx: ExtensionContext) => {
    const request = args.trim();
    if (!request) {
      sendPanel(emitPanel, `${PANCODE_PRODUCT_NAME} Reasoning`, [
        `Preference: ${currentReasoningPreference}`,
        `Applied engine setting: ${pi.getThinkingLevel()}`,
        `Model: ${ctx.model ? modelRef(ctx.model) : "unresolved"}`,
        `Capability: ${describeReasoningCapability(ctx.model)}`,
        "PanCode values: off, on",
      ]);
      return;
    }

    const parsed = parseReasoningCommand(request);
    if (!parsed) {
      ctx.ui.notify(`Invalid reasoning value: ${request}. Use "off" or "on".`, "error");
      return;
    }

    currentReasoningPreference = parsed.preference;
    process.env.PANCODE_REASONING = currentReasoningPreference;
    const effectiveThinkingLevel = resolveThinkingLevelForPreference(ctx.model, currentReasoningPreference);
    process.env.PANCODE_EFFECTIVE_THINKING = effectiveThinkingLevel;
    pi.setThinkingLevel(effectiveThinkingLevel);
    persistSettings({ reasoningPreference: currentReasoningPreference }, (message, level) =>
      ctx.ui.notify(message, level),
    );

    if (parsed.note) {
      ctx.ui.notify(parsed.note, "warning");
    }

    const capability = describeReasoningCapability(ctx.model);
    ctx.ui.setStatus("thinking", `Reasoning: ${currentReasoningPreference} (${effectiveThinkingLevel})`);
    if (capability === "unsupported" && currentReasoningPreference === "on") {
      ctx.ui.notify("Reasoning preference saved. The current model leaves the engine setting at off.", "warning");
      return;
    }

    ctx.ui.notify(
      `Reasoning preference: ${currentReasoningPreference} | capability: ${capability} | applied: ${effectiveThinkingLevel}`,
      "info",
    );
  };

  const handlePreferencesCommand = async (args: string, ctx: ExtensionContext) => {
    const request = args.trim();
    if (!request || request === "list") {
      const enabledDomains = process.env.PANCODE_ENABLED_DOMAINS ?? "all";
      const intelligenceEnabled = process.env.PANCODE_INTELLIGENCE !== "false";
      const budgetCeiling = process.env.PANCODE_BUDGET_CEILING ?? "10.0";
      const modeInfo = getModeDefinition();

      sendPanel(emitPanel, `${PANCODE_PRODUCT_NAME} Settings`, [
        "Configuration:",
        `  Safety mode:           ${process.env.PANCODE_SAFETY ?? DEFAULT_SAFETY}`,
        `  Orchestrator model:    ${ctx.model ? modelRef(ctx.model) : "unresolved"}`,
        `  Worker model:          ${process.env.PANCODE_WORKER_MODEL ?? "(inherit from routing)"}`,
        `  Reasoning:             ${currentReasoningPreference}`,
        `  Theme:                 ${ctx.ui.theme.name ?? currentThemeName}`,
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

  const showDashboard = async (_args: string, ctx: ExtensionContext) => {
    const modelLabel = ctx.model ? modelRef(ctx.model) : "unresolved";
    const dashMode = getModeDefinition();
    const lines = [
      ...buildDashboardLines({
        modelLabel,
        reasoningPreference: currentReasoningPreference,
        reasoningCapability: describeReasoningCapability(ctx.model),
        effectiveThinkingLevel: pi.getThinkingLevel(),
        themeName: ctx.ui.theme.name ?? currentThemeName,
        workingDirectory: ctx.cwd,
        tools: pi.getActiveTools(),
        modeName: dashMode.name,
        modeDescription: dashMode.description,
      }),
    ];

    // Compact session summary: runs, cost (if nonzero), active count
    const ledger = getRunLedger();
    const metrics = getMetricsLedger();
    const budget = getBudgetTracker();
    const summary = metrics?.getSummary();
    const allRuns = ledger?.getAll() ?? [];
    const activeCount = allRuns.filter((r) => r.status === "running").length;

    if (allRuns.length > 0) {
      const parts: string[] = [`${allRuns.length} dispatches`];
      if (activeCount > 0) parts.push(`${activeCount} active`);
      if (summary && summary.totalCost > 0) parts.push(`$${summary.totalCost.toFixed(4)} spent`);
      if (budget) {
        const state = budget.getState();
        if (state.totalCost > 0) parts.push(`$${state.ceiling.toFixed(2)} ceiling`);
      }
      lines.push("", `Session: ${parts.join("  ")}`);
    }

    sendPanel(emitPanel, `${PANCODE_PRODUCT_NAME} Dashboard`, lines);
  };

  pi.on("session_start", (_event, ctx) => {
    currentModelLabel = ctx.model ? modelRef(ctx.model) : "no model";
    currentThemeName = ctx.ui.theme.name ?? currentThemeName;
    currentReasoningPreference = readReasoningPreference();

    // Surface cross-domain warnings from dispatch and other subsystems in the shell.
    sharedBus.on("pancode:warning", (payload) => {
      const event = payload as { source: string; message: string };
      ctx.ui.notify(`[${event.source}] ${event.message}`, "warning");
    });
    const effectiveThinkingLevel = resolveThinkingLevelForPreference(ctx.model, currentReasoningPreference);
    process.env.PANCODE_EFFECTIVE_THINKING = effectiveThinkingLevel;
    pi.setThinkingLevel(effectiveThinkingLevel);

    ctx.ui.setTitle(PANCODE_PRODUCT_NAME);
    ctx.ui.setHeader((_tui, theme) => ({
      invalidate() {},
      render(width) {
        const left = `${theme.fg("accent", PANCODE_PRODUCT_NAME)} ${theme.fg("muted", process.env.PANCODE_PROFILE ?? "standard")}`;
        const modeInfo = getModeDefinition();
        const right = `${theme.fg("dim", process.env.PANCODE_SAFETY ?? DEFAULT_SAFETY)}  ${theme.fg(modeThemeColor(modeInfo), modeInfo.name)}`;
        return [composeSingleLine(left, right, width)];
      },
    }));

    // Dispatch board widget: shows active worker cards and recent run history.
    // Uses Container-based rendering so invalidate() propagates to Pi TUI and
    // triggers repaints. A 1-second interval timer drives smooth elapsed time
    // updates on active worker cards. Timer starts when workers are running
    // and stops when all are idle.
    ctx.ui.setWidget("pancode-dispatch-board", (_tui, theme) => {
      const container = new Container();
      const content = new Text("", 0, 0);
      container.addChild(content);
      let refreshTimer: ReturnType<typeof setInterval> | null = null;

      function startTimer() {
        if (!refreshTimer) {
          refreshTimer = setInterval(() => container.invalidate(), 1000);
        }
      }

      function stopTimer() {
        if (refreshTimer) {
          clearInterval(refreshTimer);
          refreshTimer = null;
        }
      }

      return {
        dispose() {
          stopTimer();
          resetLiveWorkers();
        },
        invalidate() {
          container.invalidate();
        },
        render(width: number): string[] {
          const ledger = getRunLedger();
          if (!ledger) return [];

          const allRuns = ledger.getAll();
          const liveWorkers = getLiveWorkers();
          if (liveWorkers.length === 0 && allRuns.length === 0) return [];

          const active: DispatchCardData[] = liveWorkers.map((w) => ({
            agent: w.agent,
            status: w.status,
            elapsedMs: Date.now() - w.startedAt,
            model: w.model,
            taskPreview: w.task,
            runId: w.runId,
            batchId: null,
            inputTokens: w.inputTokens > 0 ? w.inputTokens : undefined,
            outputTokens: w.outputTokens > 0 ? w.outputTokens : undefined,
            turns: w.turns > 0 ? w.turns : undefined,
            runtime: w.runtime,
          }));

          const recent: DispatchCardData[] = allRuns
            .filter((r) => r.status !== "running" && r.status !== "pending")
            .slice(-5)
            .map((r) => ({
              agent: r.agent,
              status: r.status,
              elapsedMs: r.completedAt ? new Date(r.completedAt).getTime() - new Date(r.startedAt).getTime() : 0,
              model: r.model,
              taskPreview: r.task,
              resultPreview: r.result ? extractResultSummary(r.result) : undefined,
              runId: r.id,
              batchId: r.batchId,
              cost: r.usage.cost > 0 ? r.usage.cost : undefined,
            }));

          const budget = getBudgetTracker();
          const metrics = getMetricsLedger();
          const summary = metrics?.getSummary();

          // Compute per-agent stats and cache totals from the metrics ledger.
          const metricsRuns = summary?.runs ?? [];
          const agentStats = computeAgentStats(metricsRuns);
          let totalCacheRead = 0;
          let totalCacheWrite = 0;
          for (const m of metricsRuns) {
            totalCacheRead += m.cacheReadTokens;
            totalCacheWrite += m.cacheWriteTokens;
          }

          // Construct a theme-backed colorizer so the pure renderer can
          // apply colors without importing Pi SDK APIs directly.
          const colorizer: BoardColorizer = {
            accent: (t) => theme.fg("accent", t),
            bold: (t) => theme.bold(t),
            muted: (t) => theme.fg("muted", t),
            dim: (t) => theme.fg("dim", t),
            success: (t) => theme.fg("success", t),
            error: (t) => theme.fg("error", t),
            warning: (t) => theme.fg("warning", t),
          };

          const lines = renderDispatchBoard(
            {
              active,
              recent,
              totalRuns: allRuns.length,
              totalCost: budget ? budget.getState().totalCost : 0,
              budgetCeiling: budget ? budget.getState().ceiling : null,
              totalInputTokens: summary?.totalInputTokens ?? 0,
              totalOutputTokens: summary?.totalOutputTokens ?? 0,
              totalCacheReadTokens: totalCacheRead > 0 ? totalCacheRead : undefined,
              totalCacheWriteTokens: totalCacheWrite > 0 ? totalCacheWrite : undefined,
              agentStats: agentStats.length > 0 ? agentStats : undefined,
            },
            width,
            colorizer,
          );

          content.setText(lines.join("\n"));

          // Manage refresh timer: run when workers are active, stop when idle.
          const hasRunning = liveWorkers.some((w) => w.status === "running");
          if (hasRunning) {
            startTimer();
          } else {
            stopTimer();
          }

          return container.render(width);
        },
      };
    });

    // Three-section footer: path/git | context/memory | dispatch/tasks
    // Uses Unicode symbols for density. Mode color accents key indicators.
    let cachedGitBranch = "";
    try {
      const { execSync } = require("node:child_process");
      cachedGitBranch = execSync("git rev-parse --abbrev-ref HEAD 2>/dev/null", {
        cwd: ctx.cwd,
        encoding: "utf-8",
        timeout: 1000,
      }).trim();
    } catch {
      cachedGitBranch = "";
    }
    const shortCwd = ctx.cwd.replace(process.env.HOME ?? "", "~");

    ctx.ui.setFooter((_tui, theme, _footerData) => ({
      invalidate() {},
      render(width) {
        const modeInfo = getModeDefinition();
        const mc = modeThemeColor(modeInfo);
        const sep = theme.fg("dim", " \u2502 ");
        const sepW = 3;

        // === LEFT: path + git branch ===
        const branchIcon = cachedGitBranch ? theme.fg("muted", `\u16B4 ${cachedGitBranch}`) : "";
        const branchW = cachedGitBranch ? cachedGitBranch.length + 2 : 0;
        const pathBudget = Math.max(8, Math.floor(width * 0.3) - branchW - sepW);
        const pathStr = theme.fg("dim", truncateToWidth(shortCwd, pathBudget, "\u2026"));
        const leftParts = [pathStr];
        if (branchIcon) leftParts.push(branchIcon);
        const left = leftParts.join(theme.fg("dim", " "));

        // === MIDDLE: context gauge + token stats ===
        const contextPercent = getContextPercent();
        const pct = Math.round(contextPercent);
        // Quarter-block gauge: \u2591 light, \u2593 dark
        const gaugeLen = 8;
        const filled = Math.round((pct / 100) * gaugeLen);
        const gauge = theme.fg(mc, "\u2593".repeat(filled)) + theme.fg("dim", "\u2591".repeat(gaugeLen - filled));
        const ctxLabel = pct > 0 ? theme.fg("muted", ` ${pct}%`) : theme.fg("dim", " 0%");
        const mid = gauge + ctxLabel;

        // === RIGHT: activity + runs + tasks + cost ===
        const liveWorkers = getLiveWorkers();
        const activeCount = liveWorkers.filter((w) => w.status === "running").length;
        const ledger = getRunLedger();
        const budget = getBudgetTracker();
        const totalRuns = ledger?.getAll().length ?? 0;
        const totalCost = budget?.getState().totalCost ?? 0;
        const allTasks = taskList();
        const doneTasks = allTasks.filter((t) => t.status === "done").length;

        const rightParts: string[] = [];
        // Activity: filled circle when active, empty when idle
        if (activeCount > 0) {
          rightParts.push(theme.fg(mc, `\u25CF ${activeCount}`));
        } else {
          rightParts.push(theme.fg("dim", "\u25CB"));
        }
        if (totalRuns > 0) rightParts.push(theme.fg("muted", `${totalRuns}r`));
        if (allTasks.length > 0) rightParts.push(theme.fg("muted", `t:${doneTasks}/${allTasks.length}`));
        if (totalCost > 0) rightParts.push(theme.fg("muted", `$${totalCost.toFixed(2)}`));
        const right = rightParts.join(theme.fg("dim", " "));

        // Compose: left | middle | right
        const leftW = visibleWidth(left);
        const midW = visibleWidth(mid);
        const rightW = visibleWidth(right);
        const totalContentW = leftW + midW + rightW + sepW * 2;

        if (totalContentW + 2 <= width) {
          // Full three-section layout
          const slack = width - totalContentW;
          const padL = " ".repeat(Math.floor(slack / 2));
          const padR = " ".repeat(slack - Math.floor(slack / 2));
          return [truncateToWidth(left + sep + padL + mid + padR + sep + right, width)];
        }
        // Narrow fallback: just mode + activity
        const narrow =
          theme.fg(mc, `[${modeInfo.name}]`) +
          (activeCount > 0 ? theme.fg(mc, ` \u25CF ${activeCount}`) : theme.fg("dim", " \u25CB idle"));
        return [truncateToWidth(narrow, width)];
      },
    }));

    // Track orchestrator context window usage from Pi SDK's getContextUsage().
    // Each "message_end" event triggers a read of the SDK's context estimate.
    // The SDK internally tracks cumulative token usage and model context window.
    // Falls back to raw message usage if getContextUsage() is unavailable.
    pi.on("message_end", (event, msgCtx) => {
      const sdkUsage = msgCtx.getContextUsage();
      if (sdkUsage) {
        recordContextFromSdk(sdkUsage);
      } else {
        // Fallback: use raw message usage data
        const msg = event.message;
        if (msg && "usage" in msg && msg.role === "assistant" && msgCtx.model?.contextWindow) {
          recordContextUsage(msg.usage.input ?? 0, msgCtx.model.contextWindow);
        }
      }
    });

    // Subscribe to dispatch events for live worker tracking.
    sharedBus.on("pancode:run-started", (payload) => {
      const event = payload as { runId: string; agent: string; task: string; model: string | null; runtime?: string };
      trackWorkerStart(event.runId, event.agent, event.task, event.model, event.runtime);
    });

    sharedBus.on("pancode:worker-progress", (payload) => {
      const event = payload as { runId: string; inputTokens: number; outputTokens: number; turns: number };
      updateWorkerProgress(event.runId, event.inputTokens, event.outputTokens, event.turns);
    });

    sharedBus.on("pancode:run-finished", (payload) => {
      const event = payload as { runId: string; status: WorkerStatus };
      trackWorkerEnd(event.runId, event.status);
    });

    // Set initial mode status and gate tools to match the active mode.
    const initMode = getModeDefinition();
    ctx.ui.setStatus("mode", `[${initMode.name}]`);
    pi.setActiveTools(getToolsetForMode(initMode.id));

    // Register PanCode editor. Extends Pi SDK's default editor with mode/safety
    // labels on the border lines. After Pi SDK copies action handlers to our editor,
    // remove cycleThinkingLevel so shift+tab is exclusively for PanCode mode cycling.
    themeFg = (color, text) => ctx.ui.theme.fg(color, text);
    ctx.ui.setEditorComponent((tui, editorTheme, keybindings) => {
      pancodeEditor = new PanCodeEditor(tui, editorTheme, keybindings);
      return pancodeEditor;
    });
    if (pancodeEditor) {
      // Replace Pi SDK's shift+tab (cycleThinkingLevel) with PanCode mode cycling.
      // The actionHandlers map is keyed by AppAction strings. We replace the handler
      // rather than delete it, so shift+tab still routes through the keybinding system.
      const handlers = pancodeEditor.actionHandlers as Map<string, () => void>;
      handlers.set("cycleThinkingLevel", () => {
        const def = cycleModeTo();
        ctx.ui.setStatus("mode", `[${def.name}]`);
        ctx.ui.notify(`Mode: ${def.name} -- ${def.description}`, "info");
        syncEditorDisplay();
      });
    }
    syncEditorDisplay();

    if (!welcomeShown) {
      welcomeShown = true;
      sendPanel(
        emitPanel,
        `${PANCODE_PRODUCT_NAME} Dashboard`,
        buildDashboardLines({
          modelLabel: currentModelLabel,
          reasoningPreference: currentReasoningPreference,
          reasoningCapability: describeReasoningCapability(ctx.model),
          effectiveThinkingLevel,
          themeName: currentThemeName,
          workingDirectory: ctx.cwd,
          tools: pi.getActiveTools(),
          modeName: initMode.name,
          modeDescription: initMode.description,
        }),
      );
    }
  });

  pi.on("model_select", (event, ctx) => {
    currentModelLabel = modelRef(event.model);
    const effectiveThinkingLevel = resolveThinkingLevelForPreference(event.model, currentReasoningPreference);
    process.env.PANCODE_EFFECTIVE_THINKING = effectiveThinkingLevel;
    pi.setThinkingLevel(effectiveThinkingLevel);
    ctx.ui.setStatus("thinking", `Reasoning: ${currentReasoningPreference} (${pi.getThinkingLevel()})`);
    persistSettings(
      {
        preferredProvider: event.model.provider,
        preferredModel: event.model.id,
      },
      (message, level) => ctx.ui.notify(message, level),
    );
    syncEditorDisplay();
  });

  // === PanCode keyboard shortcuts ===
  // shift+tab: mode cycling is handled via editor actionHandlers replacement
  // in session_start above (replaces Pi SDK's cycleThinkingLevel handler).

  // ctrl+y: cycle safety level (suggest, auto-edit, full-auto).
  pi.registerShortcut("ctrl+y", {
    description: "Cycle safety level (suggest, auto-edit, full-auto)",
    handler: async (ctx) => {
      const next = cycleSafety();
      process.env.PANCODE_SAFETY = next;
      persistSettings({ safetyMode: next }, (message, level) => ctx.ui.notify(message, level));
      ctx.ui.notify(`Safety: ${next}`, "info");
      syncEditorDisplay();
    },
  });

  // === Orchestrator identity and mode behavior via system prompt synthesis ===
  // Replaces the Pi SDK's default identity with PanCode's orchestrator identity,
  // injects the current mode's behavioral instructions, removes Pi documentation
  // references, and adds tool output deduplication guidance.
  pi.on("before_agent_start", async (event) => {
    const mode = getModeDefinition();
    const synthesized = synthesizeOrchestratorPrompt(event.systemPrompt, mode);
    return { systemPrompt: synthesized };
  });

  // Filter UI-only panel messages from LLM context.
  // pancode-panel messages (dashboard, /models, /help output) are visual UI
  // for the user. Including them confuses local models: the dashboard text
  // "Build mini-llamacpp/Qwen35..." gets interpreted as a build instruction.
  pi.on("context", async (event) => {
    type MsgWithCustomType = (typeof event.messages)[number] & { customType?: string };

    return {
      messages: event.messages.filter((m) => {
        const ct = (m as MsgWithCustomType).customType;
        if (ct === "pancode-panel") return false;
        return true;
      }),
    };
  });

  pi.registerCommand("dashboard", {
    description: "Open the PanCode dashboard",
    handler: showDashboard,
  });

  pi.registerCommand("status", {
    description: "Show the PanCode session summary",
    handler: showDashboard,
  });

  pi.registerCommand("theme", {
    description: "Inspect or change the active PanCode theme",
    handler: handleThemeCommand,
  });

  pi.registerCommand("models", {
    description: "List PanCode-visible models or switch by exact reference",
    handler: handleModelsCommand,
  });

  pi.registerCommand("preferences", {
    description: "Show or change PanCode preferences",
    handler: handlePreferencesCommand,
  });

  pi.registerCommand("settings", {
    description: "Show or change PanCode configuration",
    handler: handlePreferencesCommand,
  });

  pi.registerCommand("reasoning", {
    description: "Inspect or change the PanCode reasoning preference",
    handler: handleReasoningCommand,
  });

  pi.registerCommand("thinking", {
    description: "Backward-compatible alias for /reasoning",
    handler: handleReasoningCommand,
  });

  pi.registerCommand("mode", {
    description: "Switch orchestrator mode (capture, plan, build, ask, review)",
    async handler(args, ctx) {
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
        lines.push("", "Use /mode <name> to switch, or Shift+Tab to cycle.");
        sendPanel(emitPanel, `${PANCODE_PRODUCT_NAME} Modes`, lines);
        return;
      }

      const target = MODE_DEFINITIONS.find((d) => d.id === request || d.name.toLowerCase() === request);
      if (!target) {
        ctx.ui.notify(`Unknown mode: ${request}. Available: capture, plan, build, ask, review`, "error");
        return;
      }

      setCurrentMode(target.id);
      pi.setActiveTools(getToolsetForMode(target.id));
      ctx.ui.setStatus("mode", `[${target.name}]`);
      ctx.ui.notify(`Mode: ${target.name} -- ${target.description}`, "info");
      syncEditorDisplay();
    },
  });

  pi.registerCommand("help", {
    description: "Show PanCode commands",
    async handler(_args, _ctx) {
      sendPanel(emitPanel, `${PANCODE_PRODUCT_NAME} Commands`, formatCategorizedHelp());
    },
  });

  pi.registerCommand("exit", {
    description: "Exit PanCode",
    async handler(_args, ctx) {
      ctx.shutdown();
    },
  });
});
