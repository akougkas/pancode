/**
 * Dashboard widget renderers.
 *
 * Pure functions that take real runtime state and a colorizer, returning string[].
 * No Pi SDK imports. No side effects. No fabricated metrics.
 *
 * Each widget corresponds to a panel in the PanCode Unified Terminal UI.
 * The dashboard-layout module composes them into the final view.
 */

import { truncateToWidth, visibleWidth } from "../../engine/tui";
import {
  type AgentEntry,
  BLOCK,
  BOX,
  type DashboardState,
  type LogEntry,
  PANCODE_LOGO,
  type TaskEntry,
  type TuiColorizer,
} from "./dashboard-theme";
import { formatCost, formatTokenCount, padRight, truncate } from "./widget-utils";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Pad a string to exactly `targetWidth` visible columns.
 * ANSI escape codes are ignored during measurement.
 */
function padVisible(text: string, targetWidth: number): string {
  const w = visibleWidth(text);
  if (w > targetWidth) return truncateToWidth(text, targetWidth, "");
  if (w < targetWidth) return text + " ".repeat(targetWidth - w);
  return text;
}

/** Render a bordered panel top edge with an inline title. Truncates long titles at narrow widths. */
function boxTop(title: string, width: number, c: TuiColorizer): string {
  const maxTitleLen = Math.max(0, width - 5);
  const displayTitle = visibleWidth(title) > maxTitleLen ? truncateToWidth(title, maxTitleLen, "") : title;
  const titleLen = visibleWidth(displayTitle);
  const fillLen = Math.max(0, width - 4 - titleLen);
  return c.dim(BOX.tl + BOX.h) + c.accent(displayTitle) + c.dim(` ${BOX.h.repeat(fillLen)}${BOX.tr}`);
}

/** Render a bordered panel bottom edge. */
function boxBottom(width: number, c: TuiColorizer): string {
  return c.dim(BOX.bl + BOX.h.repeat(Math.max(0, width - 2)) + BOX.br);
}

/**
 * Render a content line inside a bordered panel.
 * Truncates content that exceeds the inner width; pads shorter content.
 */
function boxLine(content: string, width: number, c: TuiColorizer): string {
  const inner = Math.max(0, width - 4);
  const fitted = padVisible(content, inner);
  return `${c.dim(BOX.v)} ${fitted} ${c.dim(BOX.v)}`;
}

/** Render an empty line inside a bordered panel. */
function boxEmpty(width: number, c: TuiColorizer): string {
  return c.dim(BOX.v) + " ".repeat(Math.max(0, width - 2)) + c.dim(BOX.v);
}

/** Render a horizontal divider inside a bordered panel. */
function boxDivider(width: number, c: TuiColorizer): string {
  return c.dim(BOX.v) + c.dim(BOX.h.repeat(Math.max(0, width - 2))) + c.dim(BOX.v);
}

// ---------------------------------------------------------------------------
// Progress bar
// ---------------------------------------------------------------------------

/**
 * Render a block-character progress bar.
 * Example (width=20, 74%): ██████████████░░░░░░
 */
function renderProgressBar(value: number, max: number, width: number, c: TuiColorizer): string {
  const pct = max > 0 ? Math.min(1, value / max) : 0;
  const filled = Math.round(pct * width);
  const empty = width - filled;
  return c.barFill(BLOCK.full.repeat(filled)) + c.barEmpty(BLOCK.light.repeat(empty));
}

// ---------------------------------------------------------------------------
// Header bar
// ---------------------------------------------------------------------------

/**
 * Render the top status bar from real runtime data.
 *
 *   PANCODE v0.2.4 | build | qwen35-distilled-i1-q4_k_m                             12:34:56
 */
export function renderHeaderBar(state: DashboardState, width: number, c: TuiColorizer): string[] {
  const left = `${state.config.productName} v${state.config.version} ${c.dim("|")} ${c.accent(state.activeMode)} ${c.dim("|")} ${state.activeModel}`;
  const right = state.currentTime;

  const leftW = visibleWidth(left);
  const rightW = visibleWidth(right);
  const fillLen = Math.max(1, width - leftW - rightW);

  const headerLine = left + " ".repeat(fillLen) + c.bright(right);
  const border = c.dim(BOX.h.repeat(width));

  return [headerLine, border];
}

// ---------------------------------------------------------------------------
// Footer bar
// ---------------------------------------------------------------------------

/**
 * Render the bottom status bar with real system status and shortcuts.
 *
 *   STATUS: OPERATIONAL | ctx [████░░░░] 34% | $0.12 | 5 runs    [O] [W] [M] [H]
 */
export function renderFooterBar(state: DashboardState, width: number, c: TuiColorizer): string[] {
  // Context gauge
  const ctxBar = renderProgressBar(state.contextPercent, 100, 8, c);
  const ctxLabel = `Ctx ${ctxBar} ${state.contextPercent}%`;

  // Status
  const statusLabel =
    state.systemStatus === "OPERATIONAL"
      ? c.bright(state.systemStatus)
      : state.systemStatus === "ERROR"
        ? c.error(state.systemStatus)
        : c.warning(state.systemStatus);

  // Build left parts
  const leftParts = [`Status: ${statusLabel}`, ctxLabel];
  if (state.totalCost > 0) {
    leftParts.push(formatCost(state.totalCost));
  }
  if (state.totalRuns > 0) {
    leftParts.push(`${state.totalRuns} runs`);
  }
  const left = leftParts.join(c.dim("  |  "));

  const shortcuts = [
    `${c.bright("[O]")} ORCH`,
    `${c.bright("[W]")} WORKER`,
    `${c.bright("[M]")} MODELS`,
    `${c.bright("[H]")} ELP`,
  ].join("  ");

  const leftW = visibleWidth(left);
  const rightW = visibleWidth(shortcuts);
  const fillLen = Math.max(1, width - leftW - rightW);

  const border = c.dim(BOX.h.repeat(width));
  const footerLine = truncateToWidth(left + " ".repeat(fillLen) + shortcuts, width);

  return [border, footerLine];
}

// ---------------------------------------------------------------------------
// Menu panel (left sidebar)
// ---------------------------------------------------------------------------

export function renderMenuPanel(state: DashboardState, panelWidth: number, c: TuiColorizer): string[] {
  const lines: string[] = [];

  lines.push(boxTop("MENU", panelWidth, c));
  lines.push(boxLine(c.bright(state.username), panelWidth, c));
  lines.push(boxLine(c.dim(state.hostname), panelWidth, c));
  lines.push(boxEmpty(panelWidth, c));

  const menuItems = [
    { key: "D", label: "ashboard" },
    { key: "E", label: "ditor" },
    { key: "A", label: "gents" },
    { key: "L", label: "ogs" },
  ];
  for (const item of menuItems) {
    lines.push(boxLine(`[${c.bright(item.key)}]${item.label}`, panelWidth, c));
  }

  lines.push(boxEmpty(panelWidth, c));
  lines.push(boxLine(`[${c.bright("S")}]ettings`, panelWidth, c));
  lines.push(boxLine(`[${c.bright("Q")}]uit`, panelWidth, c));
  lines.push(boxBottom(panelWidth, c));

  return lines;
}

// ---------------------------------------------------------------------------
// Agent registry panel
// ---------------------------------------------------------------------------

export function renderAgentRegistry(
  agents: AgentEntry[],
  panelWidth: number,
  maxHeight: number,
  c: TuiColorizer,
): string[] {
  const inner = panelWidth - 4;
  const lines: string[] = [];

  lines.push(boxTop("AGENT_REGISTRY", panelWidth, c));

  // Column headers (plain text, then dim)
  const statusCol = 7;
  const nameCol = Math.max(1, inner - statusCol);
  const headerPlain = padRight("NAME", nameCol) + padRight("STATE", statusCol);
  lines.push(boxLine(c.dim(headerPlain), panelWidth, c));

  // Agent rows
  if (agents.length === 0) {
    lines.push(boxLine(c.dim("Run /help to see available commands"), panelWidth, c));
  } else {
    const maxRows = Math.max(0, maxHeight - 3);
    const visible = agents.slice(0, maxRows);
    for (const agent of visible) {
      const rowPlain = padRight(truncate(agent.name, nameCol - 1), nameCol) + padRight(agent.status, statusCol);
      const colored =
        agent.status === "ACTIVE"
          ? c.bright(rowPlain)
          : agent.status === "ERROR"
            ? c.error(rowPlain)
            : agent.status === "BUSY"
              ? c.warning(rowPlain)
              : c.dim(rowPlain);
      lines.push(boxLine(colored, panelWidth, c));
    }
  }

  lines.push(boxBottom(panelWidth, c));
  return lines;
}

// ---------------------------------------------------------------------------
// Dashboard banner (ASCII logo + real system status)
// ---------------------------------------------------------------------------

export function renderDashboardBanner(state: DashboardState, width: number, c: TuiColorizer): string[] {
  const lines: string[] = [];

  lines.push(boxTop("PANCODE_DASHBOARD", width, c));

  // ASCII logo
  for (const logoLine of PANCODE_LOGO) {
    lines.push(boxLine(c.primary(logoLine), width, c));
  }

  lines.push(boxEmpty(width, c));

  // Real system status
  const statusColor =
    state.systemStatus === "OPERATIONAL"
      ? c.success("OPERATIONAL")
      : state.systemStatus === "ERROR"
        ? c.error("ERROR")
        : c.warning("BUSY");
  lines.push(
    boxLine(`[ ${state.config.productName} v${state.config.version} ${c.dim("|")} ${statusColor} ]`, width, c),
  );

  lines.push(boxEmpty(width, c));

  // Sub-panels: CONTEXT WINDOW and ACTIVE WORKERS side by side.
  // Right panel absorbs any remainder from integer division for consistent alignment.
  const innerWidth = width - 4;
  const subGap = 2;
  const leftSubWidth = Math.floor((innerWidth - subGap) / 2);
  const rightSubWidth = innerWidth - leftSubWidth - subGap;

  const ctxPanel = renderContextPanel(state, leftSubWidth, c);
  const workerPanel = renderWorkerPanel(state, rightSubWidth, c);

  const maxSubLines = Math.max(ctxPanel.length, workerPanel.length);
  for (let i = 0; i < maxSubLines; i++) {
    const leftPart = i < ctxPanel.length ? ctxPanel[i] : "";
    const rightPart = i < workerPanel.length ? workerPanel[i] : "";
    const leftPadded = padVisible(leftPart, leftSubWidth);
    const rightPadded = padVisible(rightPart, rightSubWidth);
    lines.push(boxLine(`${leftPadded}${" ".repeat(subGap)}${rightPadded}`, width, c));
  }

  lines.push(boxBottom(width, c));
  return lines;
}

/** Context window usage sub-panel (real data from context-tracker). */
function renderContextPanel(state: DashboardState, width: number, c: TuiColorizer): string[] {
  const inner = width - 4;
  const lines: string[] = [];

  lines.push(boxTop("CONTEXT_WINDOW", width, c));

  const pct = Math.round(state.contextPercent);
  const tokUsed = formatTokenCount(state.contextTokens);
  const tokLabel =
    state.contextWindow > 0 ? `${tokUsed} / ${formatTokenCount(state.contextWindow)} [${pct}%]` : `${tokUsed} tokens`;
  lines.push(boxLine(tokLabel, width, c));

  const barWidth = Math.max(8, inner);
  const bar = renderProgressBar(state.contextPercent, 100, barWidth, c);
  lines.push(boxLine(bar, width, c));

  lines.push(boxEmpty(width, c));
  lines.push(boxBottom(width, c));
  return lines;
}

/** Active workers sub-panel (real data from worker-widgets). */
function renderWorkerPanel(state: DashboardState, width: number, c: TuiColorizer): string[] {
  const lines: string[] = [];

  lines.push(boxTop("ACTIVE_WORKERS", width, c));

  const activeLabel = state.activeWorkerCount > 0 ? c.accent(`${state.activeWorkerCount} running`) : c.dim("idle");
  lines.push(boxLine(`${activeLabel} / ${state.totalWorkerCount} total`, width, c));

  // Throughput from real session metrics
  const throughput = `${c.dim("\u2191")}${formatTokenCount(state.totalInputTokens)} ${c.dim("\u2193")}${formatTokenCount(state.totalOutputTokens)}`;
  lines.push(boxLine(throughput, width, c));

  lines.push(boxEmpty(width, c));
  lines.push(boxBottom(width, c));
  return lines;
}

// ---------------------------------------------------------------------------
// Metric cards (all backed by real data)
// ---------------------------------------------------------------------------

export function renderMetricCards(state: DashboardState, width: number, c: TuiColorizer, columns = 4): string[] {
  const gapWidth = 2;
  const cardWidth = Math.max(16, Math.floor((width - (columns - 1) * gapWidth) / columns));
  const inner = cardWidth - 4;
  const gap = " ".repeat(gapWidth);

  // Card 1: Infrastructure (real node/agent/runtime counts)
  const nodeLabel = state.nodes.length > 0 ? state.nodes.map((n) => `${n.name}:${n.modelCount}`).join(" ") : "no nodes";

  // Model registry content depends on boot phase and discovery results.
  const modelLines: string[] =
    state.totalModels === 0
      ? state.bootComplete
        ? ["No models found", c.dim("Check provider config")]
        : [c.dim("Discovering models..."), ""]
      : [`Total: ${state.totalModels}`, truncate(nodeLabel, inner)];
  const modelFooter =
    state.totalModels === 0
      ? state.bootComplete
        ? "run /models"
        : "please wait"
      : `${state.activeModel.split("/").pop() ?? state.activeModel}`;

  const cards = [
    renderMetricCard(
      "INFRASTRUCTURE",
      [
        `${state.nodes.length === 1 ? "1 node" : `${state.nodes.length} nodes`}`,
        `${state.agentCount === 1 ? "1 agent" : `${state.agentCount} agents`}`,
      ],
      `${state.runtimeCount} ${state.runtimeCount === 1 ? "runtime" : "runtimes"}`,
      cardWidth,
      inner,
      c,
    ),
    renderMetricCard("MODEL_REGISTRY", modelLines, modelFooter, cardWidth, inner, c),
    renderMetricCard(
      "SESSION",
      [`Runs: ${state.totalRuns}`, state.totalCost > 0 ? `Cost: ${formatCost(state.totalCost)}` : "Cost: local"],
      `${formatTokenCount(state.totalInputTokens + state.totalOutputTokens)} tok`,
      cardWidth,
      inner,
      c,
    ),
    renderMetricCard(
      "MODE",
      [`Active: ${state.activeMode}`, `Safety: ${state.safetyLevel}`],
      `${state.reasoningLevel}`,
      cardWidth,
      inner,
      c,
    ),
  ];

  const result: string[] = [];
  for (let row = 0; row < cards.length; row += columns) {
    const rowCards = cards.slice(row, row + columns);
    const maxLines = Math.max(...rowCards.map((card) => card.length));
    for (let i = 0; i < maxLines; i++) {
      const parts = rowCards.map((card) => {
        if (i < card.length) return padVisible(card[i], cardWidth);
        return " ".repeat(cardWidth);
      });
      result.push(parts.join(gap));
    }
  }

  return result;
}

function renderMetricCard(
  title: string,
  contentLines: string[],
  bottomRight: string,
  width: number,
  inner: number,
  c: TuiColorizer,
): string[] {
  const lines: string[] = [];
  lines.push(boxTop(title, width, c));

  for (const cl of contentLines) {
    lines.push(boxLine(cl, width, c));
  }

  lines.push(boxLine(bottomRight.padStart(inner), width, c));
  lines.push(boxBottom(width, c));
  return lines;
}

// ---------------------------------------------------------------------------
// Codex input panel (shows real active model and context)
// ---------------------------------------------------------------------------

export function renderCodexInput(state: DashboardState, width: number, c: TuiColorizer): string[] {
  const lines: string[] = [];
  const inner = width - 4;

  lines.push(boxTop("DIRECTIVE", width, c));

  const noModel = !state.activeModel || state.activeModel === "no model";

  if (noModel) {
    // Empty state: no model selected
    lines.push(boxLine(c.dim("No model selected. Use /models to choose."), width, c));
    lines.push(boxDivider(width, c));
    lines.push(boxLine(c.dim(padRight(`Mode: ${state.activeMode}`, inner)), width, c));
    lines.push(boxLine(c.dim(padRight(`Safety: ${state.safetyLevel}`, inner)), width, c));
  } else {
    // Query prompt
    const queryLine = padRight("Q: Awaiting system directive...", inner);
    lines.push(boxLine(c.bright(queryLine), width, c));

    lines.push(boxDivider(width, c));

    // Real model info
    const modelPart = `Model: ${state.activeModel}`;
    const modePart = `Mode: ${state.activeMode}`;
    const safetyPart = `Safety: ${state.safetyLevel}`;
    const totalLen = modelPart.length + modePart.length + safetyPart.length;
    const infoGap = Math.max(2, Math.floor((inner - totalLen) / 2));
    const infoLine = padRight(
      `${modelPart}${" ".repeat(infoGap)}${modePart}${" ".repeat(infoGap)}${safetyPart}`,
      inner,
    );
    lines.push(boxLine(infoLine, width, c));

    // Real session telemetry
    const ctxPct = `Ctx: ${Math.round(state.contextPercent)}%`;
    const tokStr = `Tok: ${formatTokenCount(state.totalInputTokens + state.totalOutputTokens)}`;
    const costStr = state.totalCost > 0 ? `Cost: ${formatCost(state.totalCost)}` : "Cost: local";
    const telemetryPlain = `${ctxPct} | ${tokStr} | ${costStr}`;
    lines.push(boxLine(c.dim(padRight(truncate(telemetryPlain, inner), inner)), width, c));
  }

  lines.push(boxBottom(width, c));
  return lines;
}

// ---------------------------------------------------------------------------
// Dispatch review table (from real runs)
// ---------------------------------------------------------------------------

export function renderDispatchTable(tasks: TaskEntry[], width: number, maxRows: number, c: TuiColorizer): string[] {
  const inner = width - 4;
  const lines: string[] = [];

  lines.push(boxTop("DISPATCH_BOARD", width, c));

  // Adaptive column widths: tokens fixed, remainder split across id/agent/status.
  // Total must never exceed inner.
  const colTokens = 7;
  const avail = inner - colTokens;
  const colId = Math.min(10, Math.max(6, Math.floor(avail * 0.27)));
  const colAgent = Math.min(10, Math.max(6, Math.floor(avail * 0.27)));
  const colStatus = Math.max(4, avail - colId - colAgent);

  const headerPlain =
    padRight("RUN_ID", colId) +
    padRight("AGENT", colAgent) +
    padRight("STATUS", colStatus) +
    "TOKENS".padStart(colTokens);
  lines.push(boxLine(c.dim(headerPlain), width, c));
  lines.push(boxLine(c.dim(BOX.h.repeat(inner)), width, c));

  const visible = tasks.slice(0, maxRows);
  for (const task of visible) {
    const plainRow =
      padRight(truncate(task.id, colId - 1), colId) +
      padRight(truncate(task.agent, colAgent - 1), colAgent) +
      padRight(truncate(task.status, colStatus - 1), colStatus) +
      formatTokenCount(task.tokens).padStart(colTokens);

    const statusUpper = task.status.toUpperCase();
    let coloredRow: string;
    if (statusUpper === "DONE" || statusUpper === "COMPLETE") {
      coloredRow = c.success(plainRow);
    } else if (statusUpper === "ERROR" || statusUpper === "TIMEOUT") {
      coloredRow = c.error(plainRow);
    } else if (statusUpper === "IDLE" || statusUpper === "CANCELLED") {
      coloredRow = c.dim(plainRow);
    } else {
      coloredRow = plainRow;
    }

    lines.push(boxLine(coloredRow, width, c));
  }

  if (tasks.length === 0) {
    lines.push(boxLine(c.dim("Dispatches appear here during builds"), width, c));
  }

  lines.push(boxBottom(width, c));
  return lines;
}

// ---------------------------------------------------------------------------
// Log viewer (from real orchestration events)
// ---------------------------------------------------------------------------

export function renderLogViewer(logs: LogEntry[], width: number, maxRows: number, c: TuiColorizer): string[] {
  const inner = width - 4;
  const lines: string[] = [];

  lines.push(boxTop("ORCHESTRATION_LOGS", width, c));

  if (logs.length === 0) {
    lines.push(boxLine(c.dim("Events will appear as PanCode operates"), width, c));
  } else {
    const visible = logs.slice(-maxRows);
    for (const log of visible) {
      const timestamp = c.dim(`[${log.time}]`);
      const maxMsgLen = Math.max(10, inner - log.time.length - 3);
      const msg = log.highlight ? c.bright(truncate(log.message, maxMsgLen)) : truncate(log.message, maxMsgLen);
      lines.push(boxLine(`${timestamp} ${msg}`, width, c));
    }
  }

  lines.push(boxBottom(width, c));
  return lines;
}

// ---------------------------------------------------------------------------
// Agent registry inline (compact layout)
// ---------------------------------------------------------------------------

/**
 * Render agents as colored inline badges in a single bordered panel.
 * Used in compact mode where the sidebar is omitted and agents display
 * horizontally above the dispatch table.
 */
export function renderAgentRegistryInline(agents: AgentEntry[], width: number, c: TuiColorizer): string[] {
  const inner = width - 4;
  const lines: string[] = [];

  lines.push(boxTop("AGENTS", width, c));

  if (agents.length === 0) {
    lines.push(boxLine(c.dim("Run /help to see available commands"), width, c));
  } else {
    const colorBadge = (a: AgentEntry): string => {
      const text = `${a.name}:${a.status}`;
      if (a.status === "ACTIVE") return c.bright(text);
      if (a.status === "ERROR") return c.error(text);
      if (a.status === "BUSY") return c.warning(text);
      return c.dim(text);
    };

    let current = "";
    for (const agent of agents) {
      const badge = colorBadge(agent);
      const sep = visibleWidth(current) > 0 ? "  " : "";
      const candidate = current + sep + badge;
      if (visibleWidth(candidate) > inner && visibleWidth(current) > 0) {
        lines.push(boxLine(current, width, c));
        current = badge;
      } else {
        current = candidate;
      }
    }
    if (visibleWidth(current) > 0) {
      lines.push(boxLine(current, width, c));
    }
  }

  lines.push(boxBottom(width, c));
  return lines;
}

// ---------------------------------------------------------------------------
// Expanded metrics panel (wide layout secondary column)
// ---------------------------------------------------------------------------

/**
 * Render a detailed telemetry panel for the wide layout secondary column.
 * Shows context window gauge, worker status, and session metrics in a
 * single bordered panel alongside the dashboard banner.
 */
export function renderExpandedMetricsPanel(state: DashboardState, width: number, c: TuiColorizer): string[] {
  const inner = width - 4;
  const lines: string[] = [];

  lines.push(boxTop("TELEMETRY", width, c));

  // Context window section
  lines.push(boxLine(c.dim("Context Window"), width, c));
  const pct = Math.round(state.contextPercent);
  const tokUsed = formatTokenCount(state.contextTokens);
  const ctxLabel =
    state.contextWindow > 0 ? `${tokUsed} / ${formatTokenCount(state.contextWindow)} [${pct}%]` : `${tokUsed} tokens`;
  lines.push(boxLine(ctxLabel, width, c));
  const barWidth = Math.max(8, inner);
  lines.push(boxLine(renderProgressBar(state.contextPercent, 100, barWidth, c), width, c));
  lines.push(boxEmpty(width, c));

  // Worker status section
  lines.push(boxLine(c.dim("Workers"), width, c));
  const activeLabel = state.activeWorkerCount > 0 ? c.accent(`${state.activeWorkerCount} running`) : c.dim("idle");
  lines.push(boxLine(`${activeLabel} / ${state.totalWorkerCount} total`, width, c));
  const throughput =
    `${c.dim("\u2191")}${formatTokenCount(state.totalInputTokens)} ` +
    `${c.dim("\u2193")}${formatTokenCount(state.totalOutputTokens)}`;
  lines.push(boxLine(throughput, width, c));
  lines.push(boxEmpty(width, c));

  // Session section
  lines.push(boxLine(c.dim("Session"), width, c));
  lines.push(boxLine(`Runs: ${state.totalRuns}`, width, c));
  const costStr = state.totalCost > 0 ? formatCost(state.totalCost) : "local";
  lines.push(boxLine(`Cost: ${costStr}`, width, c));
  const totalTok = formatTokenCount(state.totalInputTokens + state.totalOutputTokens);
  lines.push(boxLine(`Tokens: ${totalTok}`, width, c));

  // Budget gauge if a ceiling is configured
  if (state.budgetCeiling !== null && state.budgetCeiling > 0) {
    lines.push(boxEmpty(width, c));
    lines.push(boxLine(c.dim("Budget"), width, c));
    lines.push(boxLine(`${formatCost(state.totalCost)} / ${formatCost(state.budgetCeiling)}`, width, c));
    const budgetBarWidth = Math.max(8, inner);
    lines.push(boxLine(renderProgressBar(state.totalCost, state.budgetCeiling, budgetBarWidth, c), width, c));
  }

  lines.push(boxBottom(width, c));
  return lines;
}
