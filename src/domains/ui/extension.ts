import {
  BusChannel,
  type RunFinishedEvent,
  type RunStartedEvent,
  type WarningEvent,
  type WorkerHealthChangedEvent,
  type WorkerProgressEvent,
} from "../../core/bus-events";
import type { SafetyLevel } from "../../core/config";
import { DEFAULT_REASONING_PREFERENCE, DEFAULT_SAFETY, DEFAULT_THEME } from "../../core/defaults";
import { PanMessageType } from "../../core/message-types";
import {
  MODE_ORDER,
  type ModeDefinition,
  getCurrentMode,
  getModeDefinition,
  getToolsetForMode,
  setCurrentMode,
} from "../../core/modes";
import { sharedBus } from "../../core/shared-bus";
import { PANCODE_PRODUCT_NAME } from "../../core/shell-metadata";
import {
  type PanCodeReasoningPreference,
  cycleReasoningLevel,
  parseReasoningPreference,
  resolveThinkingLevelForPreference,
} from "../../core/thinking";
import { PiEvent } from "../../engine/events";
import { defineExtension } from "../../engine/extensions";
import { Container, Text, truncateToWidth, visibleWidth } from "../../engine/tui";
import type { Api, Model } from "../../engine/types";
import { getRunLedger } from "../dispatch";
import { getMetricsLedger } from "../observability";
import { compileOrchestratorPrompt, getLastOrchestratorCompilation } from "../prompts";
import { findModelProfile } from "../providers";
import { getBudgetTracker } from "../scheduling";
import {
  type UiCommandState,
  buildWelcomeScreen,
  createCommandHandlers,
  makeEmitPanel,
  modelRef,
  persistSettings,
  sendPanel,
} from "./commands";
import {
  addCategoryTokens,
  getCategoryBreakdown,
  getContextPercent,
  recordCategoryTokens,
  recordContextFromSdk,
  recordContextUsage,
} from "./context-tracker";
import type { TuiColorizer } from "./dashboard-theme";
import { renderDispatchBoard } from "./dispatch-board";
import type { AgentStat, DispatchCardData } from "./dispatch-board";
import { type FooterWorker, renderFooterLines } from "./footer-renderer";
import { PanCodeEditor } from "./pancode-editor";
import { extractResultSummary } from "./widget-utils";
import {
  getLiveWorkers,
  resetAll as resetLiveWorkers,
  trackWorkerEnd,
  trackWorkerStart,
  updateWorkerHealth,
  updateWorkerProgress,
} from "./worker-widgets";
import type { WorkerStatus } from "./worker-widgets";

function readReasoningPreference(): PanCodeReasoningPreference {
  return parseReasoningPreference(process.env.PANCODE_REASONING) ?? DEFAULT_REASONING_PREFERENCE;
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

/**
 * Compute per-agent performance statistics from the metrics ledger.
 * Returns an empty array if fewer than 3 total runs exist to avoid noise.
 */
function computeAgentStats(
  runs: ReadonlyArray<{
    agent: string;
    status: string;
    cost: number | null;
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
    avgCostPerRun: agentRuns.reduce((s, r) => s + (r.cost ?? 0), 0) / agentRuns.length,
    avgDurationMs: agentRuns.reduce((s, r) => s + r.durationMs, 0) / agentRuns.length,
  }));
}

export const extension = defineExtension((pi) => {
  const state: UiCommandState = {
    currentModelLabel: "no model",
    currentReasoningPreference: readReasoningPreference(),
    currentThemeName: process.env.PANCODE_THEME?.trim() || DEFAULT_THEME,
    themeFg: (_c, t) => t,
  };
  let welcomeShown = false;
  let pancodeEditor: PanCodeEditor | null = null;

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

  function emitModeTransition(mode: ModeDefinition): void {
    const dispatch = mode.dispatchEnabled ? "Dispatch enabled." : "Dispatch disabled.";
    const mutations = mode.mutationsAllowed ? "File mutations allowed." : "Read-only.";
    pi.sendMessage({
      customType: PanMessageType.MODE_TRANSITION,
      content: `[MODE SWITCH] Now in ${mode.name} mode. ${mode.description} ${dispatch} ${mutations} Previous mode instructions are superseded.`,
      display: true,
      details: { title: `Mode: ${mode.name}` },
    });
  }

  /**
   * Apply a reasoning level: update preference, env, engine, and persist.
   * Called on mode switch, manual /reasoning, and keyboard cycling.
   */
  function applyReasoningLevel(
    level: PanCodeReasoningPreference,
    model: Pick<Model<Api>, "reasoning" | "compat"> | null | undefined,
    notify: (message: string, level: "info" | "warning" | "error") => void,
  ): void {
    state.currentReasoningPreference = level;
    process.env.PANCODE_REASONING = level;
    const effective = resolveThinkingLevelForPreference(model, level);
    process.env.PANCODE_EFFECTIVE_THINKING = effective;
    pi.setThinkingLevel(effective);
    persistSettings({ reasoningPreference: level }, notify);
  }

  function syncEditorDisplay(): void {
    if (!pancodeEditor) return;
    const mode = getModeDefinition();
    const safety = process.env.PANCODE_SAFETY ?? DEFAULT_SAFETY;
    const color = modeThemeColor(mode);
    pancodeEditor.setModeDisplay(mode.name, (s) => state.themeFg(color, s));
    pancodeEditor.setSafetyDisplay(safety);
    pancodeEditor.setModelDisplay(state.currentModelLabel);
    pancodeEditor.setReasoningDisplay(pi.getThinkingLevel() || "off");
  }

  const emitPanel = makeEmitPanel((msg) => pi.sendMessage(msg));

  const handlers = createCommandHandlers(state, {
    emitPanel,
    getThinkingLevel: () => pi.getThinkingLevel(),
    setModel: (model) => pi.setModel(model),
    setActiveTools: (tools) => pi.setActiveTools(tools),
    sendPiMessage: (msg) => pi.sendMessage(msg),
    applyReasoningLevel,
    syncEditorDisplay,
    emitModeTransition,
  });

  pi.registerMessageRenderer(PanMessageType.PANEL, (message, _options, theme) => {
    const title =
      typeof message.details === "object" && message.details && "title" in message.details
        ? String((message.details as { title?: unknown }).title ?? PANCODE_PRODUCT_NAME)
        : PANCODE_PRODUCT_NAME;
    const body = typeof message.content === "string" ? message.content : String(message.content ?? "");

    return {
      invalidate() {},
      render(width: number): string[] {
        const result: string[] = [];
        const titleVW = visibleWidth(title);
        const topFillLen = Math.max(0, width - 5 - titleVW);

        result.push(
          `${theme.fg("dim", "\u256D\u2500")} ${theme.bold(theme.fg("accent", title))} ${theme.fg("dim", `${"\u2500".repeat(topFillLen)}\u256E`)}`,
        );

        for (const line of body.split("\n")) {
          result.push(`  ${truncateToWidth(line, Math.max(1, width - 2))}`);
        }

        result.push(theme.fg("dim", `\u2570${"\u2500".repeat(Math.max(0, width - 2))}\u256F`));
        return result;
      },
    };
  });

  pi.registerMessageRenderer(PanMessageType.MODE_TRANSITION, (message, _options, theme) => {
    const body = typeof message.content === "string" ? message.content : String(message.content ?? "");
    return new Text(theme.fg("warning", `▸ ${body}`), 0, 0);
  });

  pi.on(PiEvent.SESSION_START, (_event, ctx) => {
    // Suppress tmux extended-keys warnings that pollute stderr.
    const origStderrWrite = process.stderr.write.bind(process.stderr);
    process.stderr.write = ((chunk: string | Uint8Array, ...args: unknown[]) => {
      if (typeof chunk === "string" && chunk.includes("extended-keys")) return true;
      return (origStderrWrite as Function).call(process.stderr, chunk, ...args);
    }) as typeof process.stderr.write;

    state.currentModelLabel = ctx.model ? modelRef(ctx.model) : "no model";
    state.currentThemeName = ctx.ui.theme.name ?? state.currentThemeName;
    state.currentReasoningPreference = readReasoningPreference();

    // Surface cross-domain warnings from dispatch and other subsystems in the shell.
    sharedBus.on(BusChannel.WARNING, (payload) => {
      const event = payload as WarningEvent;
      ctx.ui.notify(`[${event.source}] ${event.message}`, "warning");
    });
    const effectiveThinkingLevel = resolveThinkingLevelForPreference(ctx.model, state.currentReasoningPreference);
    process.env.PANCODE_EFFECTIVE_THINKING = effectiveThinkingLevel;
    pi.setThinkingLevel(effectiveThinkingLevel);

    // Detect git branch early so both header and footer can reference it.
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

    ctx.ui.setTitle(PANCODE_PRODUCT_NAME);
    ctx.ui.setHeader((_tui, theme) => ({
      invalidate() {},
      render(width) {
        const sep = theme.fg("dim", " \u2502 ");
        const modeInfo = getModeDefinition();
        const mc = modeThemeColor(modeInfo);
        const modelShort = state.currentModelLabel.includes("/")
          ? (state.currentModelLabel.split("/").pop() ?? state.currentModelLabel)
          : state.currentModelLabel;
        const safety = process.env.PANCODE_SAFETY ?? DEFAULT_SAFETY;
        const reasoning = pi.getThinkingLevel() || "off";
        const branchStr = cachedGitBranch ? `${sep}\u16B4 ${cachedGitBranch}` : "";
        const parts = [
          theme.fg("accent", "\u258C P\u2590"),
          theme.fg(mc, modeInfo.name),
          modelShort,
          ...(branchStr ? [branchStr] : []),
          theme.fg("dim", safety),
          theme.fg("dim", `reasoning:${reasoning}`),
        ];
        // Join non-branch parts with separator; branch already has its own sep prefix
        const header = parts.reduce((acc, part, i) => {
          if (i === 0) return part;
          // branchStr already includes its own sep
          if (branchStr && part === branchStr) return acc + part;
          return acc + sep + part;
        }, "");
        return [truncateToWidth(header, width)];
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
            healthState: w.healthState,
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
              cost: r.usage.cost,
            }));

          const budget = getBudgetTracker();
          const metrics = getMetricsLedger();
          const summary = metrics?.getSummary();

          // Compute per-agent stats and cache totals from the metrics ledger.
          const metricsRuns = summary?.runs ?? [];
          const agentStats = computeAgentStats(metricsRuns);
          let totalCacheRead: number | null = null;
          let totalCacheWrite: number | null = null;
          for (const m of metricsRuns) {
            if (m.cacheReadTokens != null) totalCacheRead = (totalCacheRead ?? 0) + m.cacheReadTokens;
            if (m.cacheWriteTokens != null) totalCacheWrite = (totalCacheWrite ?? 0) + m.cacheWriteTokens;
          }

          // Construct a theme-backed colorizer so the pure renderer can
          // apply colors without importing Pi SDK APIs directly.
          const colorizer: TuiColorizer = {
            accent: (t) => theme.fg("accent", t),
            bold: (t) => theme.bold(t),
            muted: (t) => theme.fg("muted", t),
            dim: (t) => theme.fg("dim", t),
            success: (t) => theme.fg("success", t),
            error: (t) => theme.fg("error", t),
            warning: (t) => theme.fg("warning", t),
            primary: (t) => theme.fg("accent", t),
            bright: (t) => theme.bold(t),
            barFill: (t) => theme.fg("success", t),
            barEmpty: (t) => theme.fg("dim", t),
            mode: (t) => theme.fg("accent", t),
          };

          const lines = renderDispatchBoard(
            {
              active,
              recent,
              totalRuns: allRuns.length,
              totalCost: budget ? budget.getState().totalCost : null,
              budgetCeiling: budget ? budget.getState().ceiling : null,
              totalInputTokens: summary?.totalInputTokens ?? null,
              totalOutputTokens: summary?.totalOutputTokens ?? null,
              totalCacheReadTokens: totalCacheRead,
              totalCacheWriteTokens: totalCacheWrite,
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

    // Dynamic multi-line footer: mode header, active dispatches, session economics, context bar.
    // Grows during active dispatches and shrinks back when idle.
    ctx.ui.setFooter((_tui, theme, _footerData) => ({
      invalidate() {},
      render(width) {
        const modeInfo = getModeDefinition();
        const mc = modeThemeColor(modeInfo);

        const liveWorkers = getLiveWorkers();
        const budget = getBudgetTracker();
        const budgetState = budget?.getState();
        const metrics = getMetricsLedger();
        const summary = metrics?.getSummary();

        const workers: FooterWorker[] = liveWorkers.map((w) => ({
          agent: w.agent,
          runtime: w.runtime,
          model: w.model,
          elapsedMs: Date.now() - w.startedAt,
          tokens: w.inputTokens + w.outputTokens,
          status: w.status,
        }));

        const totalTokens = (summary?.totalInputTokens ?? 0) + (summary?.totalOutputTokens ?? 0);

        const colorizer: TuiColorizer = {
          accent: (t) => theme.fg("accent", t),
          bold: (t) => theme.bold(t),
          muted: (t) => theme.fg("muted", t),
          dim: (t) => theme.fg("dim", t),
          success: (t) => theme.fg("success", t),
          error: (t) => theme.fg("error", t),
          warning: (t) => theme.fg("warning", t),
          primary: (t) => theme.fg("accent", t),
          bright: (t) => theme.bold(t),
          barFill: (t) => theme.fg("success", t),
          barEmpty: (t) => theme.fg("dim", t),
          mode: (t) => theme.fg(mc, t),
        };

        return renderFooterLines(
          {
            modeName: modeInfo.name,
            safety: process.env.PANCODE_SAFETY ?? DEFAULT_SAFETY,
            modelLabel: state.currentModelLabel,
            reasoning: pi.getThinkingLevel() || "off",
            dispatchCount: summary?.totalRuns ?? 0,
            totalCost: budgetState?.totalCost ?? 0,
            totalTokens,
            budgetRemaining: budget ? budget.remaining() : null,
            workers,
            contextPercent: Math.round(getContextPercent()),
            categories: getCategoryBreakdown(),
          },
          width,
          colorizer,
        );
      },
    }));

    // Track orchestrator context window usage from Pi SDK's getContextUsage().
    // Each "message_end" event triggers a read of the SDK's context estimate.
    // The SDK internally tracks cumulative token usage and model context window.
    // Falls back to raw message usage if getContextUsage() is unavailable.
    // Also accumulates panos (orchestrator) output tokens for context category tracking.
    pi.on(PiEvent.MESSAGE_END, (event, msgCtx) => {
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

      // Track orchestrator output tokens for the context bar's "panos" category.
      const msg = event.message;
      if (msg && "usage" in msg && msg.role === "assistant") {
        const usage = msg.usage as { output?: number };
        if (typeof usage.output === "number" && usage.output > 0) {
          addCategoryTokens("panos", usage.output);
        }
      }
    });

    // Subscribe to dispatch events for live worker tracking.
    sharedBus.on(BusChannel.RUN_STARTED, (payload) => {
      const event = payload as RunStartedEvent;
      trackWorkerStart(event.runId, event.agent, event.task, event.model, event.runtime);
    });

    sharedBus.on(BusChannel.WORKER_PROGRESS, (payload) => {
      const event = payload as WorkerProgressEvent;
      updateWorkerProgress(
        event.runId,
        event.inputTokens,
        event.outputTokens,
        event.turns,
        event.currentTool,
        event.currentToolArgs,
        event.recentTools,
        event.toolCount,
      );
    });

    sharedBus.on(BusChannel.RUN_FINISHED, (payload) => {
      const event = payload as RunFinishedEvent;
      trackWorkerEnd(event.runId, event.status as WorkerStatus);

      // Track dispatch result tokens for context bar category.
      // Worker output tokens represent what gets returned to the orchestrator context.
      if (event.usage.outputTokens != null && event.usage.outputTokens > 0) {
        addCategoryTokens("dispatch", event.usage.outputTokens);
      }
    });

    sharedBus.on(BusChannel.WORKER_HEALTH_CHANGED, (payload) => {
      const event = payload as WorkerHealthChangedEvent;
      updateWorkerHealth(event.runId, event.currentState);
    });

    // Track system prompt token estimate from orchestrator prompt compilation.
    // Updated in BEFORE_AGENT_START after compileOrchestratorPrompt runs.

    // Set initial mode status and gate tools to match the active mode.
    const initMode = getModeDefinition();
    ctx.ui.setStatus("mode", `[${initMode.name}]`);
    pi.setActiveTools(getToolsetForMode(initMode.id));

    // Register PanCode editor. Extends Pi SDK's default editor with mode/safety
    // labels on the border lines. After Pi SDK copies action handlers to our editor,
    // remove cycleThinkingLevel so shift+tab is exclusively for PanCode mode cycling.
    state.themeFg = (color, text) => ctx.ui.theme.fg(color, text);
    ctx.ui.setEditorComponent((tui, editorTheme, keybindings) => {
      pancodeEditor = new PanCodeEditor(tui, editorTheme, keybindings);
      // Left/right padding creates space for the prompt symbol.
      // PanCodeEditor.render() replaces the first padding space on the
      // first content line with the colored prompt character.
      pancodeEditor.setPaddingX(2);
      return pancodeEditor;
    });
    if (pancodeEditor) {
      // Replace Pi SDK's shift+tab (cycleThinkingLevel) with PanCode mode cycling.
      // The actionHandlers map is keyed by AppAction strings. We replace the handler
      // rather than delete it, so shift+tab still routes through the keybinding system.
      const editorHandlers = pancodeEditor.actionHandlers as Map<string, () => void>;
      editorHandlers.set("cycleThinkingLevel", () => {
        const def = cycleModeTo();
        applyReasoningLevel(def.reasoningLevel, ctx.model, (m, l) => ctx.ui.notify(m, l));
        ctx.ui.setStatus("mode", `[${def.name}]`);
        emitModeTransition(def);
        syncEditorDisplay();
      });
    }
    syncEditorDisplay();

    if (!welcomeShown) {
      welcomeShown = true;
      sendPanel(emitPanel, `${PANCODE_PRODUCT_NAME}`, buildWelcomeScreen(state.currentModelLabel, initMode.name));
    }
  });

  pi.on(PiEvent.MODEL_SELECT, (event, ctx) => {
    state.currentModelLabel = modelRef(event.model);
    // Re-resolve reasoning for the new model's capabilities.
    const effective = resolveThinkingLevelForPreference(event.model, state.currentReasoningPreference);
    process.env.PANCODE_EFFECTIVE_THINKING = effective;
    pi.setThinkingLevel(effective);
    ctx.ui.setStatus("thinking", `Reasoning: ${state.currentReasoningPreference}`);
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

  // ctrl+t: cycle reasoning level (off, low, medium, high, xhigh).
  // For toggle-only models (Qwen via local engines), cycles between off and medium.
  pi.registerShortcut("ctrl+t", {
    description: "Cycle reasoning level (off, low, medium, high, xhigh)",
    handler: async (ctx) => {
      const next = cycleReasoningLevel(state.currentReasoningPreference, ctx.model);
      applyReasoningLevel(next, ctx.model, (message, level) => ctx.ui.notify(message, level));
      ctx.ui.setStatus("thinking", `Reasoning: ${next}`);
      ctx.ui.notify(`Reasoning: ${next}`, "info");
      syncEditorDisplay();
    },
  });

  // === Orchestrator identity and mode behavior via PanPrompt engine ===
  // Compiles the orchestrator system prompt from typed fragments based on
  // current mode and model tier. Performs Pi SDK prompt surgery (identity
  // replacement, Pi docs removal) and injects dispatch strategy, safety
  // awareness, tool guidance, and output contracts.
  pi.on(PiEvent.BEFORE_AGENT_START, async (event, ctx) => {
    const mode = getModeDefinition();
    const model = ctx.model;
    const profile = model ? (findModelProfile(model.provider, model.id) ?? null) : null;
    const compiled = compileOrchestratorPrompt(event.systemPrompt, mode, profile);

    // Record system prompt token estimate for context bar category tracking.
    const lastCompilation = getLastOrchestratorCompilation();
    if (lastCompilation) {
      recordCategoryTokens("system", lastCompilation.estimatedTokens);
    }

    return { systemPrompt: compiled };
  });

  // Filter UI-only panel messages from LLM context.
  // pancode-panel messages (dashboard, /models, /help output) are visual UI
  // for the user. Including them confuses local models: the dashboard text
  // "Build <model-id>..." gets interpreted as a build instruction.
  pi.on(PiEvent.CONTEXT, async (event) => {
    type MsgWithCustomType = (typeof event.messages)[number] & { customType?: string };

    return {
      messages: event.messages.filter((m) => {
        const ct = (m as MsgWithCustomType).customType;
        if (ct === PanMessageType.PANEL) return false;
        return true;
      }),
    };
  });

  // === Slash command registrations ===
  // All handler logic lives in commands.ts; extension.ts only registers and delegates.

  pi.registerCommand("dashboard", {
    description: "Open the PanCode dashboard",
    handler: handlers.showDashboard,
  });

  pi.registerCommand("status", {
    description: "Show the PanCode session summary",
    handler: handlers.showDashboard,
  });

  pi.registerCommand("theme", {
    description: "Inspect or change the active PanCode theme",
    handler: handlers.handleThemeCommand,
  });

  pi.registerCommand("models", {
    description: "List PanCode-visible models or switch by exact reference",
    handler: handlers.handleModelsCommand,
  });

  pi.registerCommand("preferences", {
    description: "Show or change PanCode preferences",
    handler: handlers.handlePreferencesCommand,
  });

  pi.registerCommand("settings", {
    description: "Show or change PanCode configuration",
    handler: handlers.handlePreferencesCommand,
  });

  pi.registerCommand("reasoning", {
    description: "Inspect or change the PanCode reasoning preference",
    handler: handlers.handleReasoningCommand,
  });

  pi.registerCommand("thinking", {
    description: "Backward-compatible alias for /reasoning",
    handler: handlers.handleReasoningCommand,
  });

  pi.registerCommand("modes", {
    description: "Switch orchestrator mode (capture, plan, build, ask, review)",
    handler: handlers.handleModesCommand,
  });

  pi.registerCommand("help", {
    description: "Show PanCode commands",
    handler: handlers.handleHelpCommand,
  });

  pi.registerCommand("preset", {
    description: "List or apply a boot preset from ~/.pancode/panpresets.yaml",
    handler: handlers.handlePresetCommand,
  });

  pi.registerCommand("perf", {
    description: "Show boot phase timing breakdown",
    handler: handlers.handlePerfCommand,
  });

  pi.registerCommand("safety", {
    description: "Show or switch safety level live",
    handler: handlers.handleSafetyCommand,
  });

  pi.registerCommand("exit", {
    description: "Exit PanCode",
    handler: handlers.handleExitCommand,
  });
});
