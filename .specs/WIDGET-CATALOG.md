# PanCode TUI Widget Catalog

## Rendering Contract

All widgets are pure functions: `(state, width, colorizer) → string[]`

No Pi SDK imports. No side effects. The extension constructs a colorizer from
the theme and passes it in. Widgets return arrays of ANSI-decorated strings,
one per terminal line.

## Implemented Widgets

### 1. renderHeaderBar

**File:** `dashboard-widgets.ts`
**Signature:** `(state: DashboardState, width: number, c: DashboardColorizer) → string[]`
**Lines:** 2 (content + border)

**Data sources:**
- `state.config.productName` → PANCODE_PRODUCT_NAME
- `state.config.version` → process.env.npm_package_version
- `state.activeMode` → getModeDefinition().name
- `state.activeModel` → currentModelLabel
- `state.currentTime` → Date().toLocaleTimeString()

**Layout:**
```
PanCode v0.3.0 | admin | dynamo/qwen3-30b-a3b                          16:09:08
────────────────────────────────────────────────────────────────────────────────
```

---

### 2. renderFooterBar

**File:** `dashboard-widgets.ts`
**Lines:** 2 (border + content)

**Data sources:**
- `state.systemStatus` → derived from worker health
- `state.contextPercent` → getContextPercent()
- `state.totalCost` → getBudgetTracker().getState().totalCost
- `state.totalRuns` → getRunLedger().getAll().length

**Layout:**
```
────────────────────────────────────────────────────────────────────────────────
STATUS: OPERATIONAL  |  ctx ███░░░░░ 34%  |  $0.12  |  7 runs   [O] [W] [M] [H]
```

---

### 3. renderMenuPanel

**File:** `dashboard-widgets.ts`
**Width:** Fixed 24 columns

**Data sources:**
- `state.username` → process.env.USER
- `state.hostname` → os.hostname()

**Layout:**
```
┌─MENU ────────────────┐
│ akougkas             │
│ zbook                │
│                      │
│ [D]ashboard          │
│ [E]ditor             │
│ [A]gents             │
│ [L]ogs               │
│                      │
│ [S]ettings           │
│ [Q]uit               │
└──────────────────────┘
```

---

### 4. renderAgentRegistry

**File:** `dashboard-widgets.ts`
**Width:** Fixed 24 columns

**Data sources:**
- `state.agents[]` → merged from agentRegistry.getAll() + getLiveWorkers()

**Layout:**
```
┌─AGENT_REGISTRY ──────┐
│ NAME        STATE    │
│ panos       ACTIVE   │  ← bright (running worker)
│ scout       ACTIVE   │
│ dev         IDLE     │  ← dim (registered but idle)
│ review      IDLE     │
└──────────────────────┘
```

---

### 5. renderDashboardBanner

**File:** `dashboard-widgets.ts`
**Contains sub-panels:** CONTEXT_WINDOW, ACTIVE_WORKERS

**Data sources:**
- PANCODE_LOGO constant (ASCII art)
- `state.config.productName`, `state.config.version`
- `state.systemStatus` → derived from worker health
- CONTEXT_WINDOW: `state.contextPercent`, `state.contextTokens`, `state.contextWindow`
- ACTIVE_WORKERS: `state.activeWorkerCount`, `state.totalWorkerCount`, token throughput

---

### 6. renderMetricCards

**File:** `dashboard-widgets.ts`
**Cards:** 4 side-by-side

| Card | Line 1 | Line 2 | Bottom Right |
|------|--------|--------|-------------|
| INFRASTRUCTURE | NODES: {n} | AGENTS: {n} | {n} runtimes |
| MODEL_REGISTRY | TOTAL: {n} | {node summary} | {active model} |
| SESSION | RUNS: {n} | COST: ${n} | {total tokens} |
| MODE | ACTIVE: {mode} | SAFETY: {level} | {reasoning} |

**Data sources:**
- Nodes: getModelProfileCache() grouped by providerId prefix
- Agents: agentRegistry.getAll().length
- Runtimes: runtimeRegistry.available().length
- Models: filtered chat model count from profile cache
- Session: getMetricsLedger(), getBudgetTracker()
- Mode: getModeDefinition(), PANCODE_SAFETY, pi.getThinkingLevel()

---

### 7. renderCodexInput

**File:** `dashboard-widgets.ts`

**Data sources:**
- `state.activeModel` → currentModelLabel
- `state.activeMode` → getModeDefinition().name
- `state.safetyLevel` → PANCODE_SAFETY
- `state.contextPercent` → getContextPercent()
- `state.totalInputTokens + totalOutputTokens` → getMetricsLedger()
- `state.totalCost` → getBudgetTracker()

---

### 8. renderDispatchTable

**File:** `dashboard-widgets.ts`
**Columns:** RUN_ID, AGENT, STATUS, TOKENS

**Data sources:**
- Active tasks: getLiveWorkers() mapped to TaskEntry[]
- Recent tasks: getRunLedger().getAll() last 5 completed

**Color rules:**
- DONE/COMPLETE → success (green)
- ERROR/TIMEOUT → error (red)
- IDLE/CANCELLED → dim
- RUNNING/other → default (terminal green)

---

### 9. renderLogViewer

**File:** `dashboard-widgets.ts`
**Max rows:** 8

**Data sources:**
- `state.logs[]` → populated from sharedBus events (to be wired)

---

### 10. renderDashboard (compositor)

**File:** `dashboard-layout.ts`
**Signature:** `(state, width, height, colorizer) → string[]`

Assembles all widgets into the unified layout. Pads output to exact `height`.

## Not Yet Implemented (Planned)

### 11. Log Event Collector

A module-level ring buffer that subscribes to sharedBus events and stores
the last N log entries for the log viewer. Similar pattern to worker-widgets.ts.

### 12. Dashboard Widget Registration

Wire `renderDashboard` into extension.ts as a `ctx.ui.setWidget()` call,
following the dispatch board pattern. Includes 1-second refresh timer.

### 13. Welcome Screen Replacement

Replace the current `buildWelcomeScreen()` text panel with the full dashboard
banner, showing on session start.
