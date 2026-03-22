/**
 * Live dispatch board renderer.
 *
 * Pure functions that take state and return rendered string arrays.
 * No Pi SDK imports. No event subscriptions. Just rendering.
 *
 * Theme coloring is applied through the BoardColorizer interface,
 * which the widget constructs from Pi theme APIs and passes in.
 * This keeps the renderer free of engine dependencies.
 */

import { truncateToWidth, visibleWidth } from "../../engine/tui";
import { formatCost, formatDuration, formatTokenCount, padRight, truncate } from "./widget-utils";

// ---------------------------------------------------------------------------
// Interfaces
// ---------------------------------------------------------------------------

export interface DispatchCardData {
  agent: string;
  status: "pending" | "running" | "done" | "error" | "cancelled" | "timeout" | "interrupted";
  elapsedMs: number;
  model: string | null;
  taskPreview: string;
  resultPreview?: string; // First meaningful line of worker result (for completed runs)
  runId: string;
  batchId: string | null;
  cost?: number | null;
  inputTokens?: number | null;
  outputTokens?: number | null;
  turns?: number | null;
  runtime?: string; // Runtime ID for badge display (omit or "pi" for no badge)
}

export interface AgentStat {
  agent: string;
  runs: number;
  successRate: number; // 0-100
  avgCostPerRun: number;
  avgDurationMs: number;
}

export interface DispatchBoardState {
  active: DispatchCardData[];
  recent: DispatchCardData[]; // last 5 completed
  totalRuns: number;
  totalCost: number;
  budgetCeiling: number | null;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCacheReadTokens?: number;
  totalCacheWriteTokens?: number;
  agentStats?: AgentStat[];
}

// ---------------------------------------------------------------------------
// Board colorizer (theme abstraction)
// ---------------------------------------------------------------------------

export interface BoardColorizer {
  accent(text: string): string;
  bold(text: string): string;
  muted(text: string): string;
  dim(text: string): string;
  success(text: string): string;
  error(text: string): string;
  warning(text: string): string;
}

const PLAIN: BoardColorizer = {
  accent: (t) => t,
  bold: (t) => t,
  muted: (t) => t,
  dim: (t) => t,
  success: (t) => t,
  error: (t) => t,
  warning: (t) => t,
};

function colorizeStatusIcon(icon: string, status: string, c: BoardColorizer): string {
  switch (status) {
    case "running":
      return c.accent(icon);
    case "done":
      return c.success(icon);
    case "error":
      return c.error(icon);
    case "pending":
      return c.dim(icon);
    default:
      return c.dim(icon);
  }
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const STATUS_ICONS: Record<string, string> = {
  pending: "\u25CB",
  running: "\u25CF",
  done: "\u2713",
  error: "\u2717",
  cancelled: "\u2298",
  interrupted: "\u2298",
  timeout: "\u2298",
};

const MIN_CARD_WIDTH = 24;
const CARD_GAP = 2;
const CARD_HEIGHT = 6;
const INDENT = "  ";

// ---------------------------------------------------------------------------
// Box-drawing borders
// ---------------------------------------------------------------------------

/**
 * Render the top border of the board with an inline title.
 *
 *   ╭─ Dispatch ─────────────────────────────────╮
 */
function renderTopBorder(title: string, width: number, c: BoardColorizer): string {
  const usable = Math.max(0, width - INDENT.length);
  if (usable < 6) return `${INDENT}${c.dim("\u256D")}`;
  // Title text with surrounding dashes: ╭─ Title ─...─╮
  const titlePart = `\u2500 ${title} `;
  const fillLen = Math.max(0, usable - 2 - titlePart.length);
  return `${INDENT}${c.dim("\u256D")}${c.dim("\u2500")}${c.accent(title)}${c.dim(` ${"\u2500".repeat(fillLen)}`)}${c.dim("\u256E")}`;
}

/**
 * Render the bottom border of the board with an optional inline summary.
 *
 *   ╰───────────────────────────── 11 runs ──────╯
 */
function renderBottomBorder(summary: string, width: number, c: BoardColorizer): string {
  const usable = Math.max(0, width - INDENT.length);
  if (usable < 6) return `${INDENT}${c.dim("\u2570")}`;
  if (!summary) {
    return `${INDENT}${c.dim(`\u2570${"\u2500".repeat(usable - 2)}\u256F`)}`;
  }
  const summaryPart = ` ${summary} `;
  const totalFill = Math.max(0, usable - 2 - summaryPart.length);
  const leftFill = Math.max(0, totalFill - 6);
  const rightFill = Math.max(0, totalFill - leftFill);
  return `${INDENT}${c.dim(`\u2570${"\u2500".repeat(leftFill)}`)}${c.muted(summaryPart)}${c.dim(`${"\u2500".repeat(rightFill)}\u256F`)}`;
}

/**
 * Render a thin horizontal rule for separating sections within the board.
 *
 *   ─────────────────────────────────────────────
 */
function renderSeparator(width: number, c: BoardColorizer): string {
  const usable = Math.max(0, width - INDENT.length - 2);
  return `${INDENT} ${c.dim("\u2500".repeat(usable))}`;
}

// ---------------------------------------------------------------------------
// Grid layout
// ---------------------------------------------------------------------------

/**
 * Auto-calculate grid columns from terminal width and card count.
 */
function calculateGridColumns(cardCount: number, terminalWidth: number): number {
  const maxCols = Math.floor((terminalWidth + CARD_GAP) / (MIN_CARD_WIDTH + CARD_GAP));
  if (maxCols < 1) return 1;
  if (cardCount <= 3) return Math.min(cardCount, maxCols);
  if (cardCount <= 6) return Math.min(3, maxCols);
  return Math.min(4, maxCols);
}

// ---------------------------------------------------------------------------
// Card rendering
// ---------------------------------------------------------------------------

/**
 * Render a single worker card as a bordered box.
 * Returns 6 lines of fixed height.
 *
 * ```
 * ┌─────────────────────┐
 * │ dev                 │
 * │ ● running    23s    │
 * │ provider/model-id   │
 * │ 2.1k tok  T3  auth..│
 * └─────────────────────┘
 * ```
 */
export function renderDispatchCard(card: DispatchCardData, cardWidth: number, c: BoardColorizer = PLAIN): string[] {
  const inner = Math.max(1, cardWidth - 4);

  const statusIcon = STATUS_ICONS[card.status] ?? "\u25CB";
  const elapsed = formatDuration(card.elapsedMs);
  const statusText = card.status;
  const plainPrefix = `${statusIcon} ${statusText}`;
  const gap = Math.max(1, inner - plainPrefix.length - elapsed.length);
  // Pad the full plain line to inner width, then rebuild with colors.
  const plainStatusLine = padRight(`${plainPrefix}${" ".repeat(gap)}${elapsed}`, inner);
  // Compute any trailing padding from padRight (if line was shorter than inner).
  const trailingPad = plainStatusLine.length - `${plainPrefix}${" ".repeat(gap)}${elapsed}`.length;
  const statusLine =
    `${colorizeStatusIcon(statusIcon, card.status, c)} ${c.muted(statusText)}` +
    `${" ".repeat(gap)}${c.dim(elapsed)}${" ".repeat(Math.max(0, trailingPad))}`;

  // Pad plain text first, then apply color to the padded result.
  const modelLine = c.muted(padRight(card.model ? truncate(card.model, inner) : "", inner));

  // Show runtime badge next to agent name for non-Pi runtimes
  const runtimeBadge = card.runtime && card.runtime !== "pi" ? ` [${card.runtime.replace("cli:", "")}]` : "";
  const agentLabel = card.agent + runtimeBadge;
  const agentLine = c.bold(c.accent(padRight(truncate(agentLabel, inner), inner)));

  // Line 4: show live token stats when available, otherwise task preview.
  // Token/turn stats are dim supporting data; task text stays default.
  let taskLine: string;
  const totalTokens = (card.inputTokens ?? 0) + (card.outputTokens ?? 0);
  if (totalTokens > 0 && card.turns) {
    const tokStr = `${formatTokenCount(totalTokens)} tok`;
    const turnStr = `T${card.turns}`;
    const prefix = `${tokStr}  ${turnStr}  `;
    const remaining = Math.max(0, inner - prefix.length);
    // Color token/turn stats as dim, task text stays default.
    const taskPreviewPart = truncate(card.taskPreview, remaining);
    const paddedTaskPreview = padRight(taskPreviewPart, remaining);
    taskLine = c.dim(prefix) + paddedTaskPreview;
  } else {
    taskLine = padRight(truncate(card.taskPreview, inner), inner);
  }

  // Card borders use dim for structural elements.
  const hBar = c.dim("\u2500".repeat(cardWidth - 2));

  return [
    c.dim("\u250C") + hBar + c.dim("\u2510"),
    c.dim("\u2502 ") + agentLine + c.dim(" \u2502"),
    c.dim("\u2502 ") + statusLine + c.dim(" \u2502"),
    c.dim("\u2502 ") + modelLine + c.dim(" \u2502"),
    c.dim("\u2502 ") + taskLine + c.dim(" \u2502"),
    c.dim("\u2514") + hBar + c.dim("\u2518"),
  ];
}

/**
 * Render a grid of cards arranged in rows.
 * Fills incomplete rows with empty space (not blank cards).
 */
function renderCardGrid(cards: DispatchCardData[], width: number, c: BoardColorizer = PLAIN): string[] {
  if (cards.length === 0) return [];

  const usable = Math.max(MIN_CARD_WIDTH, width - INDENT.length);
  const cols = calculateGridColumns(cards.length, usable);
  const cardWidth = Math.max(MIN_CARD_WIDTH, Math.floor((usable - (cols - 1) * CARD_GAP) / cols));

  const rendered = cards.map((card) => renderDispatchCard(card, cardWidth, c));
  const lines: string[] = [];

  for (let rowStart = 0; rowStart < rendered.length; rowStart += cols) {
    const rowCards = rendered.slice(rowStart, rowStart + cols);
    for (let line = 0; line < CARD_HEIGHT; line++) {
      const parts = rowCards.map((card) => card[line]);
      lines.push(`${INDENT}${parts.join(" ".repeat(CARD_GAP))}`);
    }
  }

  return lines;
}

// ---------------------------------------------------------------------------
// Recent runs (compact, no cards)
// ---------------------------------------------------------------------------

/**
 * Render a compact single-line summary for a completed run.
 * Prefers resultPreview (worker output) over taskPreview (dispatch prompt).
 * Shows cost inline when available and nonzero.
 *
 *   ✓ scout   Found 8 test files      $0.02   3.2s
 */
function renderRecentRun(card: DispatchCardData, width: number, c: BoardColorizer = PLAIN): string {
  const icon = STATUS_ICONS[card.status] ?? "\u2298";
  const coloredIcon = colorizeStatusIcon(icon, card.status, c);
  const agent = c.accent(padRight(card.agent, 8));
  const elapsed = c.dim(formatDuration(card.elapsedMs).padStart(6));
  const costStr = card.cost != null && card.cost > 0 ? c.muted(formatCost(card.cost).padStart(8)) : "";
  const hasCost = card.cost != null && card.cost > 0;
  const fixedWidth = 20 + (hasCost ? 9 : 0);
  const maxTask = Math.max(10, width - fixedWidth);

  // Prefer result summary over dispatch prompt. Fall back to task for errored runs
  // or when no result is available.
  let displayText: string;
  if (card.status === "error") {
    displayText = c.error(padRight(truncate(card.resultPreview || card.taskPreview, maxTask), maxTask));
  } else if (card.resultPreview) {
    displayText = padRight(truncate(card.resultPreview, maxTask), maxTask);
  } else {
    displayText = c.dim(padRight(truncate(card.taskPreview, maxTask), maxTask));
  }

  return hasCost
    ? `${INDENT}${coloredIcon} ${agent} ${displayText} ${costStr} ${elapsed}`
    : `${INDENT}${coloredIcon} ${agent} ${displayText} ${elapsed}`;
}

// ---------------------------------------------------------------------------
// Agent stats (compact, inline)
// ---------------------------------------------------------------------------

/**
 * Render agent stats as compact inline entries.
 * Multiple agents fit on fewer lines when terminal width allows.
 *
 *   scout  7 runs  100%  avg 12.8s    dev  4 runs  100%  avg 1m12s
 */
function renderAgentStatsCompact(stats: AgentStat[], width: number, c: BoardColorizer = PLAIN): string[] {
  const entries: string[] = [];

  for (const stat of stats) {
    const agent = c.accent(stat.agent);
    const runs = c.muted(`${stat.runs} runs`);
    const rateFn = stat.successRate >= 80 ? c.success : stat.successRate >= 50 ? c.warning : c.error;
    const rate = rateFn(`${stat.successRate}%`);
    const cost = stat.avgCostPerRun > 0 ? c.dim(`  ${formatCost(stat.avgCostPerRun)}/run`) : "";
    const dur = c.dim(`  avg ${formatDuration(stat.avgDurationMs)}`);
    entries.push(`${agent}  ${runs}  ${rate}${cost}${dur}`);
  }

  // Try to fit all entries on one line separated by spaces
  const singleLine = `${INDENT}${entries.join("    ")}`;
  if (visibleWidth(singleLine) <= width) {
    return [singleLine];
  }

  // Fall back to one entry per line
  return entries.map((entry) => `${INDENT}${entry}`);
}

// ---------------------------------------------------------------------------
// Footer
// ---------------------------------------------------------------------------

/**
 * Render the in-board footer section (budget, runs, tokens).
 * Suppresses zero-cost budget to handle local models gracefully.
 */
export function renderDispatchFooter(state: DispatchBoardState, _width: number, c: BoardColorizer = PLAIN): string[] {
  const parts: string[] = [];

  // Budget: only show when cost is nonzero (API models)
  if (state.totalCost > 0) {
    const budget =
      state.budgetCeiling !== null
        ? `$${state.totalCost.toFixed(2)} / $${state.budgetCeiling.toFixed(2)}`
        : `$${state.totalCost.toFixed(2)}`;
    parts.push(`${c.muted("Budget:")} ${c.dim(budget)}`);
  }

  parts.push(`${c.muted("Runs:")} ${c.dim(String(state.totalRuns))}`);

  const hasTokens = state.totalInputTokens > 0 || state.totalOutputTokens > 0;
  if (hasTokens) {
    parts.push(
      `${c.muted("Tokens:")} ${c.dim(`${formatTokenCount(state.totalInputTokens)} in / ${formatTokenCount(state.totalOutputTokens)} out`)}`,
    );
  }

  // Cache hit ratio: cacheRead / (cacheRead + input) when both are nonzero.
  const cacheRead = state.totalCacheReadTokens ?? 0;
  const cacheInput = state.totalInputTokens;
  if (cacheRead > 0 && cacheInput > 0) {
    parts.push(`${c.muted("Cache:")} ${c.dim(`${Math.round((cacheRead / (cacheRead + cacheInput)) * 100)}%`)}`);
  }

  return [`${INDENT}${parts.join(c.dim("  |  "))}`];
}

/**
 * Single-line footer string for use with Pi TUI setFooter.
 * Shows model name, active worker count, run totals, budget, and context bar.
 * Suppresses zero-value data to keep the footer clean.
 */
export function renderDispatchFooterLine(
  modelLabel: string,
  activeCount: number,
  totalRuns: number,
  totalCost: number,
  budgetCeiling: number | null,
  contextPercent: number,
  width: number,
): string {
  const left = ` ${modelLabel}`;
  const mid = activeCount > 0 ? ` \u25CF ${activeCount} active` : " \u25CB idle";

  // Build right side conditionally: suppress zero-value noise
  const rightParts: string[] = [];
  if (totalRuns > 0) rightParts.push(`${totalRuns} runs`);
  if (totalCost > 0) {
    const budget =
      budgetCeiling !== null ? `$${totalCost.toFixed(2)}/$${budgetCeiling.toFixed(2)}` : `$${totalCost.toFixed(2)}`;
    rightParts.push(budget);
  }
  if (contextPercent > 0) {
    const ctxFilled = Math.round(contextPercent / 10);
    rightParts.push(`[${"#".repeat(ctxFilled)}${"-".repeat(10 - ctxFilled)}] ${Math.round(contextPercent)}%`);
  }

  const right = rightParts.length > 0 ? `${rightParts.join("  ")} ` : "";
  const padWidth = Math.max(1, width - visibleWidth(left + mid) - visibleWidth(right));
  return truncateToWidth(left + mid + " ".repeat(padWidth) + right, width);
}

// ---------------------------------------------------------------------------
// Full board
// ---------------------------------------------------------------------------

/**
 * Build the bottom border summary string from board state.
 * Only includes nonzero values.
 */
function buildBottomSummary(state: DispatchBoardState): string {
  const parts: string[] = [];
  if (state.totalRuns > 0) parts.push(`${state.totalRuns} runs`);
  if (state.totalCost > 0) {
    parts.push(
      state.budgetCeiling !== null
        ? `${formatCost(state.totalCost)} / ${formatCost(state.budgetCeiling)}`
        : formatCost(state.totalCost),
    );
  }
  const hasTokens = state.totalInputTokens > 0 || state.totalOutputTokens > 0;
  if (hasTokens) {
    parts.push(`${formatTokenCount(state.totalInputTokens + state.totalOutputTokens)} tok`);
  }
  return parts.join("  ");
}

/**
 * Render the full dispatch board with box-drawing borders and visual hierarchy.
 *
 * ╭─ Dispatch ────────────────────────────────────╮
 *
 *   ACTIVE
 *   ┌────────────┐  ┌────────────┐
 *   │ dev        │  │ scout      │
 *   │ ...        │  │ ...        │
 *   └────────────┘  └────────────┘
 *
 *   RECENT
 *   ✓ scout   Found 8 test files              3.2s
 *   ✓ dev     Implemented auth middleware    1m12s
 *
 *   ─────────────────────────────────────────────
 *   scout  7 runs  100%  avg 12.8s    dev  4 runs  100%  avg 1m12s
 *
 * ╰─────────────────────── 11 runs  $0.03 ───────╯
 */
export function renderDispatchBoard(state: DispatchBoardState, width: number, c: BoardColorizer = PLAIN): string[] {
  const lines: string[] = [];

  lines.push(renderTopBorder("Dispatch", width, c));

  if (state.active.length > 0) {
    lines.push("");
    lines.push(`${INDENT}${c.dim("ACTIVE")}`);
    lines.push(...renderCardGrid(state.active, width, c));
  }

  if (state.recent.length > 0) {
    lines.push("");
    lines.push(`${INDENT}${c.dim("RECENT")}`);
    for (const card of state.recent) {
      lines.push(renderRecentRun(card, width, c));
    }
  }

  // Agent stats with a thin separator (no section header)
  if (state.agentStats && state.agentStats.length > 0) {
    lines.push("");
    lines.push(renderSeparator(width, c));
    lines.push(...renderAgentStatsCompact(state.agentStats, width, c));
  }

  lines.push("");
  lines.push(renderBottomBorder(buildBottomSummary(state), width, c));

  return lines;
}
