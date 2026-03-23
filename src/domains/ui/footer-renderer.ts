/**
 * Multi-line footer renderer for the PanCode TUI.
 *
 * Pure functions that compose footer lines from state data and a colorizer.
 * No Pi SDK imports. Color is applied through the FooterColorizer interface,
 * constructed by the calling code from Pi theme APIs.
 *
 * Footer layout:
 *   Idle (3 lines): mode header, session summary, context bar
 *   Active (4-6 lines): mode header, active dispatches, session summary, context bar
 *   Narrow (<60 cols): single line with mode badge and context percentage
 */

import { truncateToWidth, visibleWidth } from "../../engine/tui";
import type { CategoryBreakdown, ContextCategory } from "./context-tracker";
import { formatCost, formatDuration, formatTokenCount } from "./widget-utils";

// ---------------------------------------------------------------------------
// Interfaces
// ---------------------------------------------------------------------------

/** Theme-backed color functions for footer rendering. */
export interface FooterColorizer {
  /** Mode-specific highlight color (varies by active mode). */
  mode(text: string): string;
  accent(text: string): string;
  bold(text: string): string;
  muted(text: string): string;
  dim(text: string): string;
  success(text: string): string;
  error(text: string): string;
  warning(text: string): string;
}

/** Live worker snapshot for footer display. */
export interface FooterWorker {
  agent: string;
  runtime?: string;
  model: string | null;
  elapsedMs: number;
  tokens: number;
  status: string;
}

/** All data needed to render the footer. Assembled by extension.ts on each repaint. */
export interface FooterData {
  modeName: string;
  safety: string;
  modelLabel: string;
  reasoning: string;
  dispatchCount: number;
  totalCost: number;
  totalTokens: number;
  budgetRemaining: number | null;
  workers: FooterWorker[];
  contextPercent: number;
  categories: CategoryBreakdown[];
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DASH = "\u2500";
const BAR_WIDTH = 20;
const BLOCK_CHAR = "\u2588";
const EMPTY_CHAR = "\u2591";

const CATEGORY_LABELS: Record<ContextCategory, string> = {
  system: "sys",
  tools: "tools",
  scout: "scout",
  dispatch: "dispatch",
  panos: "panos",
  user: "user",
};

// ---------------------------------------------------------------------------
// Category color mapping
// ---------------------------------------------------------------------------

function categoryColor(c: FooterColorizer, cat: ContextCategory, text: string): string {
  switch (cat) {
    case "system":
      return c.accent(text);
    case "tools":
      return c.muted(text);
    case "scout":
      return c.success(text);
    case "dispatch":
      return c.warning(text);
    case "panos":
      return c.dim(text);
    case "user":
      return c.bold(text);
  }
}

// ---------------------------------------------------------------------------
// Mode header line
// ---------------------------------------------------------------------------

/**
 * Render the mode/safety/model/reasoning header as a horizontal rule.
 *
 *   --- Build -- auto-edit -- qwen3.5-35b -- reasoning:medium -----
 */
function renderModeLine(data: FooterData, width: number, c: FooterColorizer): string {
  const sep = ` ${DASH}${DASH} `;

  // Shorten model label to just the model name after the last /
  const modelShort = data.modelLabel.includes("/")
    ? (data.modelLabel.split("/").pop() ?? data.modelLabel)
    : data.modelLabel;

  // Plain text for width calculation
  const plainParts = [data.modeName, data.safety, modelShort, `reasoning:${data.reasoning}`];
  const plainInner = plainParts.join(sep);
  const leadDashes = 3;
  // 2 spaces around the inner text, plus lead dashes
  const trailDashes = Math.max(0, width - visibleWidth(plainInner) - leadDashes - 2);

  // Colored text
  const coloredParts = [
    c.mode(data.modeName),
    c.muted(data.safety),
    c.muted(modelShort),
    c.dim(`reasoning:${data.reasoning}`),
  ];
  const coloredInner = coloredParts.join(c.dim(sep));

  return truncateToWidth(
    c.dim(`${DASH.repeat(leadDashes)} `) + coloredInner + c.dim(` ${DASH.repeat(trailDashes)}`),
    width,
  );
}

// ---------------------------------------------------------------------------
// Active dispatch lines
// ---------------------------------------------------------------------------

/**
 * Format a compact worker summary for the footer.
 *
 *   dev -> dynamo/qwen3.5-35b (23s, 1.2k tok)
 */
function formatWorkerSummary(w: FooterWorker): string {
  const modelName = w.model ? (w.model.includes("/") ? (w.model.split("/").pop() ?? w.model) : w.model) : "local";
  const runtimePrefix = w.runtime && w.runtime !== "pi" ? `${w.runtime}:` : "";
  const elapsed = formatDuration(w.elapsedMs);
  const tokens = w.tokens > 0 ? `, ${formatTokenCount(w.tokens)} tok` : "";
  return `${w.agent} \u2192 ${runtimePrefix}${modelName} (${elapsed}${tokens})`;
}

/**
 * Render active and queued worker lines. Returns empty array when idle.
 *
 *   [bullet] 2 active  dev -> dynamo/qwen3.5-35b (23s, 1.2k tok)
 *                       reviewer -> cli:claude-code (8s, 0.4k tok)
 *   [bullet] 1 queued   documenter
 */
function renderActiveDispatches(workers: FooterWorker[], width: number, c: FooterColorizer): string[] {
  const running = workers.filter((w) => w.status === "running");
  const queued = workers.filter((w) => w.status === "pending");

  if (running.length === 0 && queued.length === 0) return [];

  const lines: string[] = [];

  if (running.length > 0) {
    const label = `  \u25CF ${running.length} active  `;
    const labelWidth = label.length;
    const indent = " ".repeat(labelWidth);

    lines.push(truncateToWidth(c.accent(label) + c.muted(formatWorkerSummary(running[0])), width));

    for (let i = 1; i < running.length; i++) {
      lines.push(truncateToWidth(indent + c.muted(formatWorkerSummary(running[i])), width));
    }
  }

  if (queued.length > 0) {
    const names = queued.map((w) => w.agent).join(", ");
    lines.push(truncateToWidth(c.dim(`  \u25CB ${queued.length} queued  ${names}`), width));
  }

  return lines;
}

// ---------------------------------------------------------------------------
// Session summary line
// ---------------------------------------------------------------------------

/**
 * Render session economics: dispatch count, cost, tokens, budget.
 *
 *   Session: 14 dispatches . $0.48 . 52k tokens | Budget: $9.52 remaining
 */
function renderSessionLine(data: FooterData, width: number, c: FooterColorizer): string {
  const parts: string[] = [];

  parts.push(`${data.dispatchCount} dispatches`);

  if (data.totalCost > 0) {
    parts.push(formatCost(data.totalCost));
  }

  if (data.totalTokens > 0) {
    parts.push(`${formatTokenCount(data.totalTokens)} tokens`);
  }

  let line = `  Session: ${parts.join(" \u00B7 ")}`;

  if (data.budgetRemaining !== null && data.budgetRemaining > 0) {
    line += ` \u2502 Budget: ${formatCost(data.budgetRemaining)} remaining`;
  }

  return truncateToWidth(c.muted(line), width);
}

// ---------------------------------------------------------------------------
// Context bar with category segments
// ---------------------------------------------------------------------------

/**
 * Distribute filled bar characters across categories proportionally.
 * Each active category gets at least 1 character if space permits.
 */
function distributeBarSegments(
  categories: CategoryBreakdown[],
  totalFilled: number,
): Array<{ category: ContextCategory; chars: number }> {
  if (totalFilled <= 0 || categories.length === 0) return [];

  const withTokens = categories.filter((cat) => cat.tokens > 0);
  if (withTokens.length === 0) return [{ category: "user", chars: totalFilled }];

  const totalTokens = withTokens.reduce((sum, cat) => sum + cat.tokens, 0);
  if (totalTokens <= 0) return [{ category: "user", chars: totalFilled }];

  const segments: Array<{ category: ContextCategory; chars: number }> = [];
  let allocated = 0;

  for (const cat of withTokens) {
    const rawChars = (cat.tokens / totalTokens) * totalFilled;
    const chars = Math.min(totalFilled - allocated, Math.max(1, Math.round(rawChars)));
    if (chars > 0 && allocated + chars <= totalFilled) {
      segments.push({ category: cat.category, chars });
      allocated += chars;
    }
  }

  // Distribute any remainder to the last segment.
  if (allocated < totalFilled && segments.length > 0) {
    segments[segments.length - 1].chars += totalFilled - allocated;
  }

  return segments;
}

/**
 * Render the color-coded context bar with category legend.
 *
 *   Context: [||||||||............] 42%  sys|tools|dispatch|panos|user|free
 */
function renderContextBar(data: FooterData, width: number, c: FooterColorizer): string {
  const pct = data.contextPercent;
  const filled = Math.round((pct / 100) * BAR_WIDTH);

  // Build colored bar segments.
  const segments = distributeBarSegments(data.categories, filled);
  let bar = "";
  for (const seg of segments) {
    bar += categoryColor(c, seg.category, BLOCK_CHAR.repeat(seg.chars));
  }
  bar += c.dim(EMPTY_CHAR.repeat(Math.max(0, BAR_WIDTH - filled)));

  // Legend: only show categories with nonzero tokens.
  const activeCats = data.categories.filter((b) => b.tokens > 0).map((b) => b.category);
  const legendParts = activeCats.map((cat) => categoryColor(c, cat, CATEGORY_LABELS[cat]));
  legendParts.push(c.dim("free"));
  const legend = legendParts.join(c.dim("\u2502"));

  const line = `  Context: [${bar}] ${pct}%  ${legend}`;
  return truncateToWidth(line, width);
}

// ---------------------------------------------------------------------------
// Main render function
// ---------------------------------------------------------------------------

/**
 * Render all footer lines. Returns 1 line for narrow terminals,
 * 3 lines when idle, and 4-6 lines during active dispatches.
 */
export function renderFooterLines(data: FooterData, width: number, c: FooterColorizer): string[] {
  // Narrow fallback: single line with mode and context percentage
  if (width < 60) {
    const activeCount = data.workers.filter((w) => w.status === "running").length;
    const activity = activeCount > 0 ? c.accent(` \u25CF ${activeCount}`) : c.dim(" \u25CB idle");
    return [truncateToWidth(c.mode(`[${data.modeName}]`) + activity + c.dim(` ${data.contextPercent}%`), width)];
  }

  const lines: string[] = [];

  // Line 1: Mode/safety/model/reasoning header
  lines.push(renderModeLine(data, width, c));

  // Active dispatch lines (dynamic, only present during dispatches)
  lines.push(...renderActiveDispatches(data.workers, width, c));

  // Session summary line
  lines.push(renderSessionLine(data, width, c));

  // Context bar with category segments
  lines.push(renderContextBar(data, width, c));

  return lines;
}
