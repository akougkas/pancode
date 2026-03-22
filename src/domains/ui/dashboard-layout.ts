/**
 * Dashboard layout compositor.
 *
 * Assembles the individual dashboard widgets into the unified
 * PanCode Terminal UI layout. Pure function; no Pi SDK imports.
 *
 * Layout structure:
 *
 *   ┌── header bar ───────────────────────────────────────────────┐
 *   │  ┌── menu ──┐  ┌── dashboard banner (logo + status) ────┐  │
 *   │  └──────────┘  └────────────────────────────────────────┘  │
 *   │                 ┌─ infra ─┐ ┌─ models ┐ ┌─ session ┐ ┌─ mode ┐
 *   │  ┌── agents ─┐  ┌── codex input ────────────────────────┐  │
 *   │  └───────────┘  └───────────────────────────────────────┘  │
 *   │                 ┌── dispatch ──────┐  ┌── logs ──────────┐  │
 *   └── footer bar ───────────────────────────────────────────────┘
 */

import { truncateToWidth, visibleWidth } from "../../engine/tui";
import { PLAIN_DASHBOARD, type DashboardColorizer, type DashboardState } from "./dashboard-theme";
import {
  renderAgentRegistry,
  renderCodexInput,
  renderDashboardBanner,
  renderDispatchTable,
  renderFooterBar,
  renderHeaderBar,
  renderLogViewer,
  renderMenuPanel,
  renderMetricCards,
} from "./dashboard-widgets";

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
function mergeColumns(
  left: string[],
  leftWidth: number,
  right: string[],
  rightWidth: number,
  gap: number,
): string[] {
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

// ---------------------------------------------------------------------------
// Main dashboard renderer
// ---------------------------------------------------------------------------

/**
 * Render the complete PanCode Unified Terminal UI.
 *
 * All data comes from real runtime telemetry via the DashboardState interface.
 * Returns a string[] that fills `width` x `height` terminal cells.
 */
export function renderDashboard(
  state: DashboardState,
  width: number,
  height: number,
  c: DashboardColorizer = PLAIN_DASHBOARD,
): string[] {
  const lines: string[] = [];

  // ── Header (2 lines) ──────────────────────────────────────────────────
  lines.push(...renderHeaderBar(state, width, c));

  // ── Column widths ─────────────────────────────────────────────────────
  const mainWidth = width - SIDEBAR_WIDTH - COLUMN_GAP;

  // ── Menu panel + Dashboard banner ─────────────────────────────────────
  const menuPanel = renderMenuPanel(state, SIDEBAR_WIDTH, c);
  const banner = renderDashboardBanner(state, mainWidth, c);
  lines.push(...mergeColumns(menuPanel, SIDEBAR_WIDTH, banner, mainWidth, COLUMN_GAP));

  // ── Metric cards (main column) ────────────────────────────────────────
  const metrics = renderMetricCards(state, mainWidth, c);
  const indent = " ".repeat(SIDEBAR_WIDTH + COLUMN_GAP);
  for (const line of metrics) {
    lines.push(indent + line);
  }

  // ── Agent registry + Codex input ──────────────────────────────────────
  const agentPanel = renderAgentRegistry(state.agents, SIDEBAR_WIDTH, 8, c);
  const codexPanel = renderCodexInput(state, mainWidth, c);
  lines.push(...mergeColumns(agentPanel, SIDEBAR_WIDTH, codexPanel, mainWidth, COLUMN_GAP));

  // ── Dispatch table + Log viewer (main column, split 45:55) ────────────
  const dispatchWidth = Math.max(30, Math.floor((mainWidth - COLUMN_GAP) * 0.45));
  const logWidth = mainWidth - dispatchWidth - COLUMN_GAP;
  const maxLogRows = 8;

  const dispatchPanel = renderDispatchTable(state.tasks, dispatchWidth, maxLogRows, c);
  const logPanel = renderLogViewer(state.logs, logWidth, maxLogRows, c);
  const bottomPanels = mergeColumns(dispatchPanel, dispatchWidth, logPanel, logWidth, COLUMN_GAP);
  for (const line of bottomPanels) {
    lines.push(indent + line);
  }

  // ── Footer (2 lines) ──────────────────────────────────────────────────
  lines.push(...renderFooterBar(state, width, c));

  // ── Pad or trim to exact height ───────────────────────────────────────
  while (lines.length < height) {
    lines.push(" ".repeat(width));
  }
  if (lines.length > height) {
    lines.length = height;
  }

  return lines;
}

export { renderDashboard as renderPanCodeDashboard };
