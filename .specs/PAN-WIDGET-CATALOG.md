# PanCode TUI Widget Catalog

Every widget is a pure function: `(state, width, colorizer) → string[]`

## Widget Registry

```yaml
widgets:
  # Dashboard chrome
  - id: header-bar
    file: dashboard-widgets.ts
    fn: renderHeaderBar
    height: 2
    data: [productName, version, activeMode, activeModel, currentTime]

  - id: footer-bar
    file: dashboard-widgets.ts
    fn: renderFooterBar
    height: 2
    data: [systemStatus, contextPercent, totalCost, totalRuns]

  - id: footer-lines
    file: footer-renderer.ts
    fn: renderFooterLines
    height: 5
    data: [modeName, safety, modelLabel, reasoning, workers, contextPercent, categories]

  # Sidebar (fixed 24 cols)
  - id: menu-panel
    file: dashboard-widgets.ts
    fn: renderMenuPanel
    width: 24
    data: [username, hostname]

  - id: agent-registry
    file: dashboard-widgets.ts
    fn: renderAgentRegistry
    width: 24
    max_rows: 8
    data: [agents[].name, agents[].status]

  # Main content
  - id: dashboard-banner
    file: dashboard-widgets.ts
    fn: renderDashboardBanner
    contains: [context-panel, worker-panel]
    data: [logo, version, systemStatus, contextPercent, activeWorkerCount]

  - id: metric-cards
    file: dashboard-widgets.ts
    fn: renderMetricCards
    columns: 4
    data: [nodes, agentCount, runtimeCount, totalModels, totalRuns, totalCost, activeMode, safetyLevel]

  - id: dispatch-table
    file: dashboard-widgets.ts
    fn: renderDispatchTable
    data: [tasks[].id, tasks[].agent, tasks[].status, tasks[].tokens]

  - id: log-viewer
    file: dashboard-widgets.ts
    fn: renderLogViewer
    max_rows: 8
    data: [logs[].time, logs[].message, logs[].highlight]

  # Dispatch board (separate view)
  - id: dispatch-board
    file: dispatch-board.ts
    fn: renderDispatchBoard
    contains: [dispatch-card, recent-run, agent-stats, dispatch-footer]
    border: rounded
    data: [active[], recent[], totalRuns, totalCost, budgetCeiling, agentStats[]]

  - id: dispatch-card
    file: dispatch-board.ts
    fn: renderDispatchCard
    height: 6
    border: rounded
    data: [agent, status, elapsedMs, model, taskPreview, runtime, healthState, cost, tokens, turns]

  # Panels (generic)
  - id: panel
    file: panel-renderer.ts
    fn: renderPanel
    border: rounded
    data: [PanelSpec with title + sections of kv/text/blank rows]

  # Editor
  - id: editor-border
    file: pancode-editor.ts
    class: PanCodeEditor
    border: rounded
    note: "Top border has mode badge (inverse video), bottom has model info"
```

## Dispatch Card Layout (6 lines, rounded border)

```
╭─────────────────────────────╮    line 0: top border
│ builder [claude-code]       │    line 1: agent name + runtime badge (bold accent)
│ ● running           1m23s  │    line 2: status icon + status + elapsed
│ claude-opus-4-6             │    line 3: model (muted)
│ 12.4k tok  T4  implement.. │    line 4: tokens + turns + task preview
╰─────────────────────────────╯    line 5: bottom border
```

```typescript
// Card rendering contract
export function renderDispatchCard(
  card: DispatchCardData,
  cardWidth: number,
  c: TuiColorizer,
): string[] {
  // Returns exactly 6 lines, padded to cardWidth
  // Line 0: rounded top border (dim)
  // Line 1: c.bold(c.accent(agentName + runtimeBadge))
  // Line 2: coloredStatusIcon + c.muted(status) + c.dim(elapsed)
  // Line 3: c.muted(model)
  // Line 4: c.dim(tokenInfo) + taskPreview
  // Line 5: rounded bottom border (dim)
}
```

## Card Grid Layout

```typescript
function calculateGridColumns(cardCount: number, terminalWidth: number): number {
  const maxCols = Math.floor((terminalWidth + CARD_GAP) / (MIN_CARD_WIDTH + CARD_GAP));
  if (cardCount <= 3) return Math.min(cardCount, maxCols);
  if (cardCount <= 6) return Math.min(3, maxCols);
  return Math.min(4, maxCols);
}

// Cards render in rows. Incomplete rows leave trailing space (not blank cards).
// Each row is CARD_HEIGHT (6) lines. Cards in a row are joined by CARD_GAP (2) spaces.
```

## Metric Card Layout (square border)

```
┌─ Infrastructure Overview ──┐
│ Agents: 2 active / 5 total│
│ Runtimes: 8               │
│ Nodes: 3                  │
│                            │
│ Current Orchestrator: Panos│
└────────────────────────────┘
```

```typescript
function renderMetricCard(
  title: string,
  contentLines: string[],
  bottomRight: string,
  width: number,
  inner: number,
  c: TuiColorizer,
): string[] {
  // boxTop(title, width, c)
  // for each contentLine: boxLine(line, width, c)
  // boxLine(bottomRight.padStart(inner), width, c)
  // boxBottom(width, c)
}
```

## Recent Run Layout (single line, no border)

```
  ✓ scout   Found 8 test files      $0.02   3.2s
  ✗ builder Error in dispatch        $0.14  1m12s
```

```typescript
function renderRecentRun(card: DispatchCardData, width: number, c: TuiColorizer): string {
  // coloredIcon + c.accent(agent) + displayText + c.muted(cost) + c.dim(elapsed)
  // Prefers resultPreview over taskPreview for completed runs
}
```

## Claude SDK Card Widget (planned, not yet implemented)

Extended card for `sdk:claude-code` workers with runtime-specific sections.

```
╭─── Claude SDK Worker ──────────────────────────────────────╮
│ ● claude-builder                    running      1m 23s    │
│   claude-opus-4-6                   sdk:claude-code        │
├─── Progress ───────────────────────────────────────────────│
│   ████████████░░░░░░░░  Turn 4/30                 $0.042   │
│   ▸ Edit src/engine/runtimes/adapters/claude-sd...         │
│   Recent: Read → Grep → Bash → Edit                       │
├─── Tokens ─────────────────────────────────────────────────│
│   In: 12,847   Out: 3,421   Cache: 8,200 read             │
│   Thinking: active                        Cost: $0.042     │
├─── Session ────────────────────────────────────────────────│
│   ID: a8f2...b3c1   Resume: available                      │
│   Stream: ▸▸▸ live          Tools: 7 calls                 │
╰────────────────────────────────────────────────────────────╯
```

```yaml
claude_sdk_card:
  border: rounded
  accent_color: "#D97706"   # Anthropic orange
  height: dynamic           # varies by section visibility
  sections:
    header:
      line1: "status_icon agent_name                status    elapsed"
      line2: "  model_name                          runtime_badge"
    progress:
      divider: "├─── Progress ───"
      line1: "progress_bar  Turn current/max        cost"
      line2: "▸ current_tool tool_args_preview"
      line3: "Recent: tool1 → tool2 → tool3 → tool4"
    tokens:
      divider: "├─── Tokens ─────"
      line1: "In: N   Out: N   Cache: N read"
      line2: "Thinking: active/idle          Cost: $N.NNN"
    session:
      divider: "├─── Session ────"
      line1: "ID: short_uuid   Resume: available/unavailable"
      line2: "Stream: status   Tools: N calls"
```

## Widget Data Flow

```yaml
data_flow:
  bus_events:
    WORKER_PROGRESS:
      fields: [runId, inputTokens, outputTokens, turns, currentTool, currentToolArgs, recentTools, toolCount]
      consumers: [dispatch-card, claude-sdk-card, footer-lines]

    RUN_STARTED:
      fields: [runId, task, agent, model, runtime]
      consumers: [dispatch-board, agent-registry, log-viewer]

    RUN_FINISHED:
      fields: [runId, agent, status, usage, runtime, startedAt, completedAt]
      consumers: [dispatch-board, metric-cards, footer-lines, log-viewer]

  state_builders:
    DashboardStateManager:
      caches: true
      stale_groups: [clock, workers, context, budget, infrastructure, agents]
      refresh: "on event or 1-second timer"

    LiveWorkerState:
      tracking: "in-memory map of runId → progress data"
      cleanup: "removed on RUN_FINISHED"
```

## Responsive Behavior

```yaml
breakpoints:
  compact:
    width: "<100"
    layout: "single column, stacked panels"
    metric_cards: "2x2 grid"
    sidebar: "hidden"

  standard:
    width: "100-160"
    layout: "sidebar (24) + main"
    metric_cards: "4 across"
    dispatch_logs: "45:55 split"

  wide:
    width: ">160"
    layout: "sidebar + main + secondary telemetry"
    metric_cards: "4 across with extra detail"

  narrow_fallback:
    width: "<60"
    footer: "single line: [mode] ● N  XX%"
    cards: "name + status only"
```

## Verification

```bash
# Width-safety regression harness
npm run verify-tui
# Tests all widgets at 80, 100, 120, 140, 200 columns
# Checks: no line exceeds width, borders match, height is exact
# Uses PLAIN_COLORIZER to strip ANSI for measurement
```
