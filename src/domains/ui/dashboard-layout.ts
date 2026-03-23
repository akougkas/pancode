/**
 * Dashboard layout compositor.
 *
 * Assembles the individual dashboard widgets into the unified
 * PanCode Terminal UI layout. Pure function; no Pi SDK imports.
 *
 * Three responsive layout modes based on terminal width:
 *
 *   compact  (<100 cols): no sidebar, stacked panels, 2x2 metric cards
 *   standard (100-160 cols): 24-col sidebar + main content
 *   wide     (>160 cols): sidebar + main + secondary telemetry panel
 *
 * Standard layout structure:
 *
 *   +-- header bar -------------------------------------------+
 *   |  +- menu -+  +- dashboard banner (logo + status) ----+ |
 *   |  +--------+  +--------------------------------------+ |
 *   |               +- infra -+ +- models + +- session + +- mode +
 *   |  +- agents -+  +- codex input ----------------------+ |
 *   |  +----------+  +------------------------------------+ |
 *   |               +- dispatch ------+  +- logs ---------+ |
 *   +-- footer bar -------------------------------------------+
 */

import { truncateToWidth, visibleWidth } from "../../engine/tui";
import { type DashboardState, PLAIN_COLORIZER, type TuiColorizer } from "./dashboard-theme";
import {
  renderAgentRegistry,
  renderAgentRegistryInline,
  renderCodexInput,
  renderDashboardBanner,
  renderDispatchTable,
  renderExpandedMetricsPanel,
  renderFooterBar,
  renderHeaderBar,
  renderLogViewer,
  renderMenuPanel,
  renderMetricCards,
} from "./dashboard-widgets";

// ---------------------------------------------------------------------------
// Layout mode breakpoints
// ---------------------------------------------------------------------------

/** Terminal width breakpoints for responsive layout. */
export type LayoutMode = "compact" | "standard" | "wide";

const COMPACT_BREAKPOINT = 100;
const WIDE_BREAKPOINT = 160;

/** Determine the layout mode from terminal width. */
export function getLayoutMode(width: number): LayoutMode {
  if (width < COMPACT_BREAKPOINT) return "compact";
  if (width > WIDE_BREAKPOINT) return "wide";
  return "standard";
}

// ---------------------------------------------------------------------------
// Column composition
// ---------------------------------------------------------------------------

const SIDEBAR_WIDTH = 24;
const COLUMN_GAP = 2;

/**
 * Pad a rendered line to exactly `targetWidth` visible columns.
 * Truncates (without ellipsis) when wider, pads with spaces when narrower.
 */
function padToWidth(line: string, targetWidth: number): string {
  const w = visibleWidth(line);
  if (w > targetWidth) return truncateToWidth(line, targetWidth, "");
  if (w < targetWidth) return line + " ".repeat(targetWidth - w);
  return line;
}

/**
 * Merge two column arrays side by side with a gap.
 */
function mergeColumns(left: string[], leftWidth: number, right: string[], rightWidth: number, gap: number): string[] {
  const maxLines = Math.max(left.length, right.length);
  const result: string[] = [];
  const gapStr = " ".repeat(gap);
  const emptyLeft = " ".repeat(leftWidth);
  const emptyRight = " ".repeat(rightWidth);

  for (let i = 0; i < maxLines; i++) {
    const l = i < left.length ? padToWidth(left[i], leftWidth) : emptyLeft;
    const r = i < right.length ? padToWidth(right[i], rightWidth) : emptyRight;
    result.push(l + gapStr + r);
  }

  return result;
}

/** Pad or trim output lines to exact terminal height. */
function fitToHeight(lines: string[], width: number, height: number): string[] {
  while (lines.length < height) {
    lines.push(" ".repeat(width));
  }
  if (lines.length > height) {
    lines.length = height;
  }
  return lines;
}

// ---------------------------------------------------------------------------
// Main dashboard renderer (dispatches by layout mode)
// ---------------------------------------------------------------------------

/**
 * Render the complete PanCode Unified Terminal UI.
 *
 * All data comes from real runtime telemetry via the DashboardState interface.
 * Returns a string[] that fills `width` x `height` terminal cells.
 * Automatically selects compact, standard, or wide layout based on width.
 */
export function renderDashboard(
  state: DashboardState,
  width: number,
  height: number,
  c: TuiColorizer = PLAIN_COLORIZER,
): string[] {
  const mode = getLayoutMode(width);
  switch (mode) {
    case "compact":
      return renderCompactDashboard(state, width, height, c);
    case "wide":
      return renderWideDashboard(state, width, height, c);
    default:
      return renderStandardDashboard(state, width, height, c);
  }
}

// ---------------------------------------------------------------------------
// Standard layout (100-160 columns)
// ---------------------------------------------------------------------------

/**
 * Two-column layout with 24-col sidebar and main content area.
 * This is the default layout for typical terminal widths.
 */
function renderStandardDashboard(state: DashboardState, width: number, height: number, c: TuiColorizer): string[] {
  const lines: string[] = [];

  // Header (2 lines)
  lines.push(...renderHeaderBar(state, width, c));

  // Column widths
  const mainWidth = width - SIDEBAR_WIDTH - COLUMN_GAP;

  // Menu panel + Dashboard banner
  const menuPanel = renderMenuPanel(state, SIDEBAR_WIDTH, c);
  const banner = renderDashboardBanner(state, mainWidth, c);
  lines.push(...mergeColumns(menuPanel, SIDEBAR_WIDTH, banner, mainWidth, COLUMN_GAP));

  // Metric cards (main column)
  const metrics = renderMetricCards(state, mainWidth, c);
  const indent = " ".repeat(SIDEBAR_WIDTH + COLUMN_GAP);
  for (const line of metrics) {
    lines.push(indent + line);
  }

  // Agent registry + Codex input
  const agentPanel = renderAgentRegistry(state.agents, SIDEBAR_WIDTH, 8, c);
  const codexPanel = renderCodexInput(state, mainWidth, c);
  lines.push(...mergeColumns(agentPanel, SIDEBAR_WIDTH, codexPanel, mainWidth, COLUMN_GAP));

  // Dispatch table + Log viewer (main column, split 45:55)
  const dispatchWidth = Math.max(30, Math.floor((mainWidth - COLUMN_GAP) * 0.45));
  const logWidth = mainWidth - dispatchWidth - COLUMN_GAP;
  const maxLogRows = 8;

  const dispatchPanel = renderDispatchTable(state.tasks, dispatchWidth, maxLogRows, c);
  const logPanel = renderLogViewer(state.logs, logWidth, maxLogRows, c);
  const bottomPanels = mergeColumns(dispatchPanel, dispatchWidth, logPanel, logWidth, COLUMN_GAP);
  for (const line of bottomPanels) {
    lines.push(indent + line);
  }

  // Footer (2 lines)
  lines.push(...renderFooterBar(state, width, c));

  return fitToHeight(lines, width, height);
}

// ---------------------------------------------------------------------------
// Compact layout (<100 columns)
// ---------------------------------------------------------------------------

/**
 * Single-column stacked layout for narrow terminals.
 * No sidebar. Metric cards render in a 2x2 grid.
 * Agent registry appears as an inline row above the dispatch table.
 * Dispatch and log panels are stacked vertically instead of side by side.
 */
function renderCompactDashboard(state: DashboardState, width: number, height: number, c: TuiColorizer): string[] {
  const lines: string[] = [];

  // Header (2 lines)
  lines.push(...renderHeaderBar(state, width, c));

  // Metric cards in 2x2 grid (full width)
  lines.push(...renderMetricCards(state, width, c, 2));

  // Codex input (full width)
  lines.push(...renderCodexInput(state, width, c));

  // Agent registry as inline badges (full width)
  lines.push(...renderAgentRegistryInline(state.agents, width, c));

  // Dispatch table (full width, stacked)
  const maxRows = 6;
  lines.push(...renderDispatchTable(state.tasks, width, maxRows, c));

  // Log viewer (full width, stacked below dispatch)
  lines.push(...renderLogViewer(state.logs, width, maxRows, c));

  // Footer (2 lines)
  lines.push(...renderFooterBar(state, width, c));

  return fitToHeight(lines, width, height);
}

// ---------------------------------------------------------------------------
// Wide layout (>160 columns)
// ---------------------------------------------------------------------------

/**
 * Three-column layout for wide terminals.
 * Top section uses sidebar + banner + secondary telemetry panel.
 * Below the top section, standard two-column layout resumes with the
 * full remaining width as the main content area.
 */
function renderWideDashboard(state: DashboardState, width: number, height: number, c: TuiColorizer): string[] {
  const lines: string[] = [];

  // Header (2 lines)
  lines.push(...renderHeaderBar(state, width, c));

  // Top section: three-column with sidebar, banner, and expanded telemetry
  const secondaryWidth = Math.max(30, Math.floor((width - SIDEBAR_WIDTH - COLUMN_GAP * 2) * 0.25));
  const topMainWidth = width - SIDEBAR_WIDTH - COLUMN_GAP - secondaryWidth - COLUMN_GAP;

  const menuPanel = renderMenuPanel(state, SIDEBAR_WIDTH, c);
  const banner = renderDashboardBanner(state, topMainWidth, c);
  const expanded = renderExpandedMetricsPanel(state, secondaryWidth, c);

  const leftAndMain = mergeColumns(menuPanel, SIDEBAR_WIDTH, banner, topMainWidth, COLUMN_GAP);
  const topSection = mergeColumns(
    leftAndMain,
    SIDEBAR_WIDTH + COLUMN_GAP + topMainWidth,
    expanded,
    secondaryWidth,
    COLUMN_GAP,
  );
  lines.push(...topSection);

  // Below top section: standard two-column layout at full width
  const mainWidth = width - SIDEBAR_WIDTH - COLUMN_GAP;
  const indent = " ".repeat(SIDEBAR_WIDTH + COLUMN_GAP);

  // Metric cards (main column, 4 across)
  const metrics = renderMetricCards(state, mainWidth, c);
  for (const line of metrics) {
    lines.push(indent + line);
  }

  // Agent registry + Codex input
  const agentPanel = renderAgentRegistry(state.agents, SIDEBAR_WIDTH, 8, c);
  const codexPanel = renderCodexInput(state, mainWidth, c);
  lines.push(...mergeColumns(agentPanel, SIDEBAR_WIDTH, codexPanel, mainWidth, COLUMN_GAP));

  // Dispatch table + Log viewer (main column, split 45:55)
  const dispatchWidth = Math.max(30, Math.floor((mainWidth - COLUMN_GAP) * 0.45));
  const logWidth = mainWidth - dispatchWidth - COLUMN_GAP;
  const maxLogRows = 8;

  const dispatchPanel = renderDispatchTable(state.tasks, dispatchWidth, maxLogRows, c);
  const logPanel = renderLogViewer(state.logs, logWidth, maxLogRows, c);
  const bottomPanels = mergeColumns(dispatchPanel, dispatchWidth, logPanel, logWidth, COLUMN_GAP);
  for (const line of bottomPanels) {
    lines.push(indent + line);
  }

  // Footer (2 lines)
  lines.push(...renderFooterBar(state, width, c));

  return fitToHeight(lines, width, height);
}

export { renderDashboard as renderPanCodeDashboard };
