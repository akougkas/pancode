/**
 * TUI width-safety regression harness.
 *
 * Validates that all TUI widget renderers produce output within specified
 * terminal widths. Tests every widget at 5 breakpoints (80, 100, 120, 140,
 * 200 columns) and checks three invariants:
 *
 * 1. No rendered line exceeds the target width.
 * 2. Bordered panels have matching top and bottom border widths.
 * 3. Full dashboard output has exactly the requested height.
 *
 * Uses PLAIN_COLORIZER to eliminate ANSI escape codes from measurement.
 * Exit 0 on all pass, exit 1 with diagnostics on failure.
 */

import { visibleWidth } from "../../engine/tui";
import { renderDashboard } from "./dashboard-layout";
import { type DashboardState, PLAIN_COLORIZER } from "./dashboard-theme";
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
import {
  type DispatchBoardState,
  renderDispatchBoard,
  renderDispatchCard,
  renderDispatchFooter,
  renderDispatchFooterLine,
} from "./dispatch-board";
import { type FooterData, renderFooterLines } from "./footer-renderer";
import { type PanelSpec, blank, kv, renderPanel, text } from "./panel-renderer";
import { registerCardWidget } from "./widgets/card-registry";
import { type ClaudeSdkCardData, ClaudeSdkCardWidget } from "./widgets/claude-sdk-card";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const TEST_WIDTHS = [80, 100, 120, 140, 200] as const;
const DASHBOARD_HEIGHT = 40;
const c = PLAIN_COLORIZER;

// ---------------------------------------------------------------------------
// Mock data (realistic demo values)
// ---------------------------------------------------------------------------

const mockState: DashboardState = {
  config: { productName: "PanCode", version: "0.3.0" },
  currentTime: "14:32:07",
  username: "akougkas",
  hostname: "blade.local",
  systemStatus: "OPERATIONAL",
  activeWorkerCount: 2,
  totalWorkerCount: 3,
  contextPercent: 42,
  contextTokens: 42000,
  contextWindow: 100000,
  totalCost: 0.48,
  budgetCeiling: 10.0,
  totalRuns: 14,
  totalInputTokens: 38000,
  totalOutputTokens: 14000,
  nodes: [
    { name: "mini", modelCount: 3 },
    { name: "dynamo", modelCount: 5 },
  ],
  agentCount: 4,
  runtimeCount: 2,
  totalModels: 8,
  activeMode: "build",
  activeModel: "dynamo/qwen3.5-35b",
  safetyLevel: "auto-edit",
  reasoningLevel: "medium",
  bootComplete: true,
  agents: [
    { name: "scout", status: "ACTIVE" },
    { name: "dev", status: "BUSY" },
    { name: "reviewer", status: "IDLE" },
    { name: "documenter", status: "IDLE" },
  ],
  tasks: [
    { id: "run-001", agent: "scout", status: "Done", tokens: 3200 },
    { id: "run-002", agent: "dev", status: "Running", tokens: 12400 },
    { id: "run-003", agent: "reviewer", status: "Idle", tokens: 0 },
  ],
  logs: [
    { time: "14:31:42", message: "Scout completed file discovery", highlight: false },
    { time: "14:31:55", message: "Dev worker started on auth module", highlight: true },
    { time: "14:32:01", message: "Context window at 42%", highlight: false },
  ],
};

const mockBoardState: DispatchBoardState = {
  active: [
    {
      agent: "dev",
      status: "running",
      elapsedMs: 23000,
      model: "dynamo/qwen3.5-35b",
      taskPreview: "Implement authentication middleware",
      runId: "run-002",
      batchId: null,
      cost: 0.02,
      inputTokens: 8400,
      outputTokens: 4000,
      turns: 3,
    },
  ],
  recent: [
    {
      agent: "scout",
      status: "done",
      elapsedMs: 3200,
      model: "dynamo/qwen3.5-35b",
      taskPreview: "Find test files",
      resultPreview: "Found 8 test files matching pattern",
      runId: "run-001",
      batchId: null,
      cost: 0.01,
      inputTokens: 2100,
      outputTokens: 1100,
      turns: 1,
    },
  ],
  totalRuns: 14,
  totalCost: 0.48,
  budgetCeiling: 10.0,
  totalInputTokens: 38000,
  totalOutputTokens: 14000,
};

const mockFooterData: FooterData = {
  modeName: "Build",
  safety: "auto-edit",
  modelLabel: "dynamo/qwen3.5-35b",
  reasoning: "medium",
  dispatchCount: 14,
  totalCost: 0.48,
  totalTokens: 52000,
  budgetRemaining: 9.52,
  workers: [
    { agent: "dev", model: "dynamo/qwen3.5-35b", elapsedMs: 23000, tokens: 12400, status: "running" },
    {
      agent: "reviewer",
      runtime: "cli:claude-code",
      model: "claude-sonnet",
      elapsedMs: 8000,
      tokens: 400,
      status: "running",
    },
  ],
  contextPercent: 42,
  categories: [
    { category: "system", tokens: 4000, percent: 10 },
    { category: "tools", tokens: 8000, percent: 19 },
    { category: "user", tokens: 12000, percent: 28 },
    { category: "dispatch", tokens: 10000, percent: 24 },
    { category: "scout", tokens: 5000, percent: 12 },
    { category: "panos", tokens: 3000, percent: 7 },
  ],
  currentView: "editor",
};

const mockClaudeSdkCard: ClaudeSdkCardData = {
  agent: "claude-builder",
  status: "running",
  elapsedMs: 83000,
  model: "claude-opus-4-6",
  taskPreview: "Implement authentication middleware for the worker dispatch system",
  runId: "a8f2c3d4-e5f6-7890-abcd-ef1234567890",
  batchId: null,
  cost: 0.042,
  inputTokens: 12847,
  outputTokens: 3421,
  turns: 4,
  runtime: "sdk:claude-code",
  healthState: null,
  maxTurns: 30,
  sessionId: "a8f2c3d4-e5f6-7890-abcd-ef1234567b3c1",
  sessionResumeAvailable: true,
  streamActive: true,
  thinkingActive: true,
  cacheReadTokens: 8200,
  cacheWriteTokens: 1200,
  currentTool: "Edit",
  currentToolArgs: '{"file_path":"src/engine/runtimes/adapters/claude-sdk.ts","old_string":"..."}',
  recentTools: ["Read", "Grep", "Bash", "Edit"],
  toolCount: 7,
};

const mockClaudeSdkCardError: ClaudeSdkCardData = {
  agent: "claude-builder",
  status: "error",
  elapsedMs: 3000,
  model: "claude-opus-4-6",
  taskPreview: "Authentication required",
  runId: "err-001",
  batchId: null,
  runtime: "sdk:claude-code",
  healthState: null,
};

const mockClaudeSdkCardIdle: ClaudeSdkCardData = {
  agent: "claude-scout",
  status: "running",
  elapsedMs: 5000,
  model: "claude-sonnet-4-5",
  taskPreview: "Scan codebase for unused imports",
  runId: "idle-001",
  batchId: null,
  runtime: "sdk:claude-code",
  healthState: null,
  inputTokens: 0,
  outputTokens: 0,
  turns: 0,
  streamActive: true,
  thinkingActive: false,
};

// Register Claude SDK card widget for verification.
registerCardWidget("sdk:claude-code", new ClaudeSdkCardWidget());

const mockPanelSpec: PanelSpec = {
  title: "SYSTEM_STATUS",
  sections: [
    {
      heading: "Infrastructure",
      rows: [
        kv("Nodes", "2 active"),
        kv("Workers", "3 total (2 running)"),
        kv("Models", "8 discovered"),
        blank(),
        text("All systems operational"),
      ],
    },
  ],
};

// ---------------------------------------------------------------------------
// Verification utilities
// ---------------------------------------------------------------------------

interface Failure {
  widget: string;
  width: number;
  lineIndex: number;
  lineWidth: number;
  message: string;
}

const failures: Failure[] = [];
let totalChecks = 0;

/** Assert no line exceeds the target width. */
function checkWidth(widgetName: string, lines: string[], targetWidth: number): void {
  for (let i = 0; i < lines.length; i++) {
    totalChecks++;
    const w = visibleWidth(lines[i]);
    if (w > targetWidth) {
      failures.push({
        widget: widgetName,
        width: targetWidth,
        lineIndex: i,
        lineWidth: w,
        message: `Line ${i} is ${w} cols, exceeds target ${targetWidth}`,
      });
    }
  }
}

/** Assert bordered panels have matching top and bottom border widths. */
function checkBorders(widgetName: string, lines: string[], targetWidth: number): void {
  if (lines.length < 2) return;
  totalChecks++;
  const topW = visibleWidth(lines[0]);
  const botW = visibleWidth(lines[lines.length - 1]);
  if (topW !== botW) {
    failures.push({
      widget: widgetName,
      width: targetWidth,
      lineIndex: -1,
      lineWidth: topW,
      message: `Top border (${topW}) != bottom border (${botW})`,
    });
  }
}

/** Assert full dashboard output has exactly the requested height. */
function checkHeight(lines: string[], expectedHeight: number, width: number): void {
  totalChecks++;
  if (lines.length !== expectedHeight) {
    failures.push({
      widget: "renderDashboard",
      width,
      lineIndex: -1,
      lineWidth: -1,
      message: `Expected ${expectedHeight} lines, got ${lines.length}`,
    });
  }
}

// ---------------------------------------------------------------------------
// Run all checks at every test width
// ---------------------------------------------------------------------------

for (const w of TEST_WIDTHS) {
  // -- dashboard-widgets.ts: unbounded widgets --

  checkWidth("renderHeaderBar", renderHeaderBar(mockState, w, c), w);
  checkWidth("renderFooterBar", renderFooterBar(mockState, w, c), w);
  checkWidth("renderMetricCards", renderMetricCards(mockState, w, c), w);
  checkWidth("renderMetricCards(2col)", renderMetricCards(mockState, w, c, 2), w);

  // -- dashboard-widgets.ts: bordered panels --

  const bannerLines = renderDashboardBanner(mockState, w, c);
  checkWidth("renderDashboardBanner", bannerLines, w);
  checkBorders("renderDashboardBanner", bannerLines, w);

  const codexLines = renderCodexInput(mockState, w, c);
  checkWidth("renderCodexInput", codexLines, w);
  checkBorders("renderCodexInput", codexLines, w);

  const dispTableLines = renderDispatchTable(mockState.tasks, w, 8, c);
  checkWidth("renderDispatchTable", dispTableLines, w);
  checkBorders("renderDispatchTable", dispTableLines, w);

  const logLines = renderLogViewer(mockState.logs, w, 8, c);
  checkWidth("renderLogViewer", logLines, w);
  checkBorders("renderLogViewer", logLines, w);

  const inlineLines = renderAgentRegistryInline(mockState.agents, w, c);
  checkWidth("renderAgentRegistryInline", inlineLines, w);
  checkBorders("renderAgentRegistryInline", inlineLines, w);

  const expandedLines = renderExpandedMetricsPanel(mockState, w, c);
  checkWidth("renderExpandedMetricsPanel", expandedLines, w);
  checkBorders("renderExpandedMetricsPanel", expandedLines, w);

  const menuLines = renderMenuPanel(mockState, w, c);
  checkWidth("renderMenuPanel", menuLines, w);
  checkBorders("renderMenuPanel", menuLines, w);

  const agentLines = renderAgentRegistry(mockState.agents, w, 8, c);
  checkWidth("renderAgentRegistry", agentLines, w);
  checkBorders("renderAgentRegistry", agentLines, w);

  // -- dispatch-board.ts --

  checkWidth("renderDispatchBoard", renderDispatchBoard(mockBoardState, w, c), w);

  const cardWidth = Math.max(24, Math.floor(w / 3));
  const cardLines = renderDispatchCard(mockBoardState.active[0], cardWidth, c);
  checkWidth("renderDispatchCard", cardLines, cardWidth);
  checkBorders("renderDispatchCard", cardLines, cardWidth);

  checkWidth("renderDispatchFooter", renderDispatchFooter(mockBoardState, w, c), w);

  // -- Claude SDK card widget --

  const sdkWidget = new ClaudeSdkCardWidget();
  const sdkCardWidth = Math.max(40, Math.floor(w / 2));

  const sdkCardLines = sdkWidget.render(mockClaudeSdkCard, sdkCardWidth, c);
  checkWidth("ClaudeSdkCard(running)", sdkCardLines, sdkCardWidth);
  checkBorders("ClaudeSdkCard(running)", sdkCardLines, sdkCardWidth);

  const sdkErrorLines = sdkWidget.render(mockClaudeSdkCardError, sdkCardWidth, c);
  checkWidth("ClaudeSdkCard(error)", sdkErrorLines, sdkCardWidth);
  checkBorders("ClaudeSdkCard(error)", sdkErrorLines, sdkCardWidth);

  const sdkIdleLines = sdkWidget.render(mockClaudeSdkCardIdle, sdkCardWidth, c);
  checkWidth("ClaudeSdkCard(idle)", sdkIdleLines, sdkCardWidth);
  checkBorders("ClaudeSdkCard(idle)", sdkIdleLines, sdkCardWidth);

  // Mixed-height board with SDK card
  const mixedBoardState: DispatchBoardState = {
    ...mockBoardState,
    active: [...mockBoardState.active, { ...mockClaudeSdkCard }],
  };
  checkWidth("renderDispatchBoard(mixed)", renderDispatchBoard(mixedBoardState, w, c), w);

  const footerLine = renderDispatchFooterLine("dynamo/qwen3.5-35b", 2, 14, 0.48, 10.0, 42, w);
  checkWidth("renderDispatchFooterLine", [footerLine], w);

  // -- footer-renderer.ts --

  checkWidth("renderFooterLines", renderFooterLines(mockFooterData, w, c), w);

  // -- panel-renderer.ts --

  const panelLines = renderPanel(mockPanelSpec, w, c);
  checkWidth("renderPanel", panelLines, w);
  checkBorders("renderPanel", panelLines, w);

  // -- dashboard-layout.ts: full dashboard with height check --

  const dashLines = renderDashboard(mockState, w, DASHBOARD_HEIGHT, c);
  checkWidth("renderDashboard", dashLines, w);
  checkHeight(dashLines, DASHBOARD_HEIGHT, w);
}

// ---------------------------------------------------------------------------
// Report results
// ---------------------------------------------------------------------------

if (failures.length === 0) {
  const widthList = TEST_WIDTHS.join(", ");
  console.log(`TUI width-safety: ${totalChecks} checks passed across widths [${widthList}]`);
  process.exit(0);
} else {
  console.error(`TUI width-safety: ${failures.length} failures out of ${totalChecks} checks\n`);
  for (const f of failures) {
    console.error(`  FAIL [${f.widget}] @${f.width}cols: ${f.message}`);
  }
  process.exit(1);
}
