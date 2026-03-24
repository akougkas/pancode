# PAN-COMMANDS: Complete Command and Configurability Audit

> Spec version: 2026-03-24
> Status: AUDIT (current state, no redesign proposals)

---

## Part 1: Complete Command Surface Map

### 1.1 Pi SDK Built-in Commands (19 commands, ALL hidden)

PanCode hides every Pi SDK built-in via `src/engine/shell-overrides.ts`.
The mechanism: backward-iterate `BUILTIN_SLASH_COMMANDS` and `splice()` each
matching entry out of the array, then patch `InteractiveMode.prototype` methods
to redirect their execution.

| # | Command | Pi Behavior | Hidden | Patched | Patch Effect |
|---|---------|-------------|--------|---------|-------------|
| 1 | `/model` | TUI ModelSelectorComponent with fuzzy search | Yes | Yes | Redirects to PanCode `/models` |
| 2 | `/scoped-models` | TUI toggle for Ctrl+P model cycling | Yes | No | Dead. Inaccessible. |
| 3 | `/settings` | TUI SettingsSelectorComponent | Yes | Yes | Redirects to PanCode `/settings` |
| 4 | `/export` | Export session to HTML file | Yes | No | Pass-through (Pi handles) |
| 5 | `/share` | Share session as secret GitHub gist | Yes | No | Pass-through (Pi handles) |
| 6 | `/copy` | Copy last agent message to clipboard | Yes | No | Pass-through (Pi handles) |
| 7 | `/name` | Set session display name | Yes | No | Pass-through (Pi handles) |
| 8 | `/session` | Show session info and stats | Yes | Yes | Redirects to PanCode `/session` |
| 9 | `/changelog` | Show changelog entries | Yes | No | Dead. Inaccessible. |
| 10 | `/hotkeys` | Show keyboard shortcuts | Yes | Yes | Redirects to PanCode `/hotkeys` |
| 11 | `/fork` | TUI: branch from previous message | Yes | No | Pass-through (Pi handles) |
| 12 | `/tree` | TUI: navigate session branch tree | Yes | No | Pass-through (Pi handles) |
| 13 | `/login` | TUI: OAuth provider login | Yes | No | Pass-through (Pi handles) |
| 14 | `/logout` | TUI: OAuth provider logout | Yes | No | Pass-through (Pi handles) |
| 15 | `/new` | Start new session | Yes | Yes | Emits SESSION_RESET before Pi handler |
| 16 | `/compact` | Manually compact context | Yes | Yes | Emits COMPACTION_STARTED before Pi handler |
| 17 | `/resume` | TUI: resume different session | Yes | No | Dead. Inaccessible. |
| 18 | `/quit` | Quit Pi | Yes | No | Dead. Inaccessible. |
| 19 | `/reload` | Reload extensions, skills, prompts, themes | Yes | Yes | Pi handler first, then emits EXTENSIONS_RELOADED |

**Patch categories:**
- **Redirect (4):** /model, /settings, /session, /hotkeys. Pi's handler replaced with `routeToShellCommand()` that sends a PanCode extension command.
- **Wrap (3):** /new, /compact, /reload. Original Pi handler preserved, PanCode emits bus events before or after.
- **Pass-through (5):** /export, /share, /copy, /name, /fork, /tree, /login, /logout. Pi's handler runs unchanged. Hidden from autocomplete/help but still functional via Pi's hardcoded dispatch.
- **Dead (3):** /scoped-models, /changelog, /resume. Hidden and not patched. Unreachable.

| Category | Commands | Count |
|----------|----------|-------|
| Redirect to PanCode | /model, /settings, /session, /hotkeys | 4 |
| Wrap with bus events | /new, /compact, /reload | 3 |
| Pass-through (works, visible in autocomplete) | /quit | 1 |
| Pass-through (works, hidden from help) | /export, /copy, /fork, /tree, /login, /logout, /resume, /share, /name | 9 |
| Dead (hidden, no handler patch) | /scoped-models, /changelog | 2 |

### 1.2 PanCode Extension Commands (36 commands)

Every PanCode command is registered via `pi.registerCommand()` in a domain
extension.ts file. Output is rendered via `pi.sendMessage()` with custom
`PanMessageType.PANEL` type.

#### UI Domain (15 registrations in `src/domains/ui/extension.ts`)

| # | Command | Handler | Description | Output | Notes |
|---|---------|---------|-------------|--------|-------|
| 1 | `/dashboard` | `showDashboard` | Main dispatch board and session summary | Widget (dashboard view) | Primary overview surface |
| 2 | `/status` | `showDashboard` | Alias for dashboard, also switches view | Widget | Duplicate of /dashboard |
| 3 | `/theme` | `handleThemeCommand` | List themes or switch: `/theme dark` | Panel | Overlaps Pi /settings theme picker |
| 4 | `/models` | `handleModelsCommand` | Tier-grouped model list, switch model | Panel | `/models all`, `/models provider/id` |
| 5 | `/preferences` | `handlePreferencesCommand` | Show PanCode configuration state | Panel | Delegates to domain sub-panels |
| 6 | `/settings` | `handlePreferencesCommand` | Alias for /preferences | Panel | **Name conflict with Pi built-in** |
| 7 | `/reasoning` | `handleReasoningCommand` | Show or set reasoning level | Panel | `/reasoning high` |
| 8 | `/thinking` | `handleReasoningCommand` | Legacy alias for /reasoning | Panel | Duplicate |
| 9 | `/modes` | `handleModesCommand` | Show or switch orchestrator mode | Panel | `/modes build` |
| 10 | `/help` | `handleHelpCommand` | Categorized command reference | Panel | Replaces Pi help entirely |
| 11 | `/preset` | `handlePresetCommand` | List or apply boot preset | Panel | `/preset local` |
| 12 | `/perf` | `handlePerfCommand` | Boot phase timing breakdown | Panel | Dev/debug |
| 13 | `/safety` | `handleSafetyCommand` | Show or cycle safety level | Panel | `/safety full-auto` |
| 14 | `/exit` | `handleExitCommand` | Graceful shutdown | Notification | Overlaps Pi /quit |
| 15 | `/hotkeys` | `handleHotkeysCommand` | Show keyboard shortcuts | Panel | **Name conflict with Pi built-in** |

#### Session Domain (4 registrations in `src/domains/session/extension.ts`)

| # | Command | Description | Output | Notes |
|---|---------|-------------|--------|-------|
| 16 | `/session` | Pi session info + PanCode domain state summary | Panel | **Name conflict with Pi built-in** |
| 17 | `/checkpoint` | Save, list, or inspect session checkpoints | Panel | `/checkpoint list`, `/checkpoint <label>` |
| 18 | `/context` | View cross-agent context registry | Panel | `/context <key>`, `/context <source>` |
| 19 | `/reset` | Reset coordination state | Notification | `/reset all`, `/reset context` |

#### Agents Domain (4 registrations in `src/domains/agents/extension.ts`)

| # | Command | Description | Output | Notes |
|---|---------|-------------|--------|-------|
| 20 | `/agents` | List agent specs, set fields | Panel | `/agents set <name> <field> <value>` |
| 21 | `/runtimes` | List registered runtimes with status | Panel | Includes telemetry, auth, agent mapping |
| 22 | `/workers` | Show worker pool with scoring | Panel | Availability, capability, cost scores |
| 23 | `/skills` | Discover and inspect agent skills | Panel | `/skills list`, `/skills show <name>` |

#### Dispatch Domain (5 registrations in `src/domains/dispatch/extension.ts`)

| # | Command | Description | Output | Notes |
|---|---------|-------------|--------|-------|
| 24 | `/stoprun` | Stop an active worker run | Notification | `/stoprun <runId>` |
| 25 | `/cost` | Show session cost data | Panel | |
| 26 | `/dispatch-insights` | Dispatch analytics and patterns | Panel | Locked decision #7: marked for removal |
| 27 | `/runs` | Show dispatch run history | Panel | `/runs [N]` |
| 28 | `/batches` | Show batch operation history | Panel | |

#### Observability Domain (4 registrations in `src/domains/observability/extension.ts`)

| # | Command | Description | Output | Notes |
|---|---------|-------------|--------|-------|
| 29 | `/metrics` | Dispatch metrics summary | Panel | `/metrics [N]` |
| 30 | `/audit` | Structured audit trail | Panel | `/audit run:<id>`, `/audit <severity>` |
| 31 | `/doctor` | Diagnostic health checks | Panel | Status icons + pass/fail checks |
| 32 | `/receipt` | List or verify reproducibility receipts | Panel | `/receipt verify <id>` |

#### Scheduling Domain (1 registration in `src/domains/scheduling/extension.ts`)

| # | Command | Description | Output | Notes |
|---|---------|-------------|--------|-------|
| 33 | `/budget` | Show budget ceiling, spent, remaining | Panel | |

#### Prompts Domain (3 registrations in `src/domains/prompts/extension.ts`)

| # | Command | Description | Output | Notes |
|---|---------|-------------|--------|-------|
| 34 | `/prompt-debug` | Show last compiled orchestrator prompt | Panel | Fragment list, token count, hash |
| 35 | `/prompt-version` | Prompt compilation version history | Panel | `/prompt-version latest`, `/prompt-version [N]` |
| 36 | `/prompt-workers` | Recent worker prompt compilations | Panel | |

### 1.3 Keyboard Shortcuts (3 PanCode shortcuts)

Registered in `src/domains/ui/extension.ts` via editor `actionHandlers`.

| Key | Action | Mechanism | State Mutated |
|-----|--------|-----------|---------------|
| `Shift+Tab` | Cycle mode: plan → build → review → plan | Replaces Pi's `cycleThinkingLevel` | `currentMode`, tools via `setActiveTools()`, reasoning level |
| `Ctrl+Y` | Cycle safety: suggest → auto-edit → full-auto | Direct handler | `PANCODE_SAFETY` env var, persisted to settings |
| `Alt+A` | Toggle Admin mode (God Mode) | Stores/restores previous mode+safety+reasoning | All three: mode, safety, reasoning |

**Pi SDK reserved shortcuts (not overridable):**
- `Ctrl+D` (exit), `Ctrl+O` (tool expand), `Ctrl+T` (reasoning toggle), `Ctrl+P` (cycle scoped models)

### 1.4 Registered Tools (10 PanCode tools)

Registered via `pi.registerTool()` in domain extensions.

| # | Tool Name | Domain | Description | Mode Gating |
|---|-----------|--------|-------------|-------------|
| 1 | `dispatch_agent` | dispatch | Dispatch a single worker | admin, build, review |
| 2 | `batch_dispatch` | dispatch | Dispatch multiple workers in parallel | admin, build, review |
| 3 | `dispatch_chain` | dispatch | Chain sequential dispatches | admin, build, review |
| 4 | `shadow_explore` | agents | Read-only shadow exploration | admin, plan, build, review |
| 5 | `task_write` | dispatch | Create a task entry | admin, plan, build |
| 6 | `task_check` | dispatch | Check a task's status | admin, plan, build |
| 7 | `task_update` | dispatch | Update a task entry | admin, plan, build |
| 8 | `task_list` | dispatch | List all tasks | admin, plan, build |
| 9 | `pan_read_config` | panconfigure | Read configuration state | admin, plan, build, review |
| 10 | `pan_apply_config` | panconfigure | Apply configuration change | admin, plan, build, review |

### 1.5 Bus Event Channels (14 channels)

Cross-domain communication via `sharedBus` (typed EventEmitter).

| Channel | Emitter(s) | Subscriber(s) | Purpose |
|---------|-----------|---------------|---------|
| `pancode:run-started` | dispatch | ui (view switch) | Worker run began |
| `pancode:run-finished` | dispatch | ui (auto-transition), observability, scheduling | Worker run completed |
| `pancode:worker-progress` | dispatch (via heartbeat) | ui (worker cards) | Live worker progress |
| `pancode:worker-heartbeat` | dispatch | ui | Raw heartbeat data |
| `pancode:worker-health-changed` | dispatch | ui | Health state transition |
| `pancode:shutdown-draining` | core/termination | dispatch, ui | Graceful shutdown initiated |
| `pancode:warning` | any domain | ui (surface to user) | Cross-domain warning |
| `pancode:session-reset` | shell-overrides (/new) | session, dispatch | Clear coordination state |
| `pancode:compaction-started` | shell-overrides (/compact) | session | Context compaction event |
| `pancode:extensions-reloaded` | shell-overrides (/reload) | ui | Re-register domain state |
| `pancode:budget-updated` | scheduling | ui (80% warning) | Budget tracking |
| `pancode:runtimes-discovered` | agents | ui | Provider discovery complete |
| `pancode:prompt-compiled` | prompts | ui, observability | Prompt compilation event |
| `pancode:config-changed` | panconfigure | ui (sync mode/safety/reasoning/theme) | Configuration change |

### 1.6 Custom Message Types (2 types)

Registered via `pi.registerMessageRenderer()` in `src/domains/ui/extension.ts`.

| Type | Renderer | Used By |
|------|----------|---------|
| `PanMessageType.PANEL` | Bordered box with title, Unicode rounded corners, theme-aware colors | All 36 PanCode commands |
| `PanMessageType.MODE_TRANSITION` | Dimmed `▸`-prefixed warning text | Mode switch notifications |

### 1.7 Summary Counts

| Surface | Count |
|---------|-------|
| Pi SDK built-in commands (all hidden) | 19 |
| PanCode extension commands | 36 |
| PanCode keyboard shortcuts | 3 |
| PanCode registered tools | 10 |
| SharedBus event channels | 14 |
| Custom message renderers | 2 |
| **Total interactive surfaces** | **84** |

---

## Part 2: Configurability Audit

Every knob, setting, file, and runtime-mutable parameter in PanCode.

### 2.1 ConfigService Schema (15 parameters)

Defined in `src/domains/panconfigure/config-schema.ts`. Readable via `pan_read_config`
tool, writable via `pan_apply_config` tool.

| Key | Type | Default | Hot Reload | Admin Only | Env Var | Settings Key | Command |
|-----|------|---------|------------|------------|---------|-------------|---------|
| `runtime.safety` | enum: suggest, auto-edit, full-auto | auto-edit | Yes | No | `PANCODE_SAFETY` | safetyMode | `/safety` |
| `runtime.mode` | enum: admin, plan, build, review | build | Yes | No | | | `/modes` |
| `runtime.reasoning` | enum: off, minimal, low, medium, high, xhigh | medium | Yes | No | `PANCODE_REASONING` | reasoningPreference | `/reasoning` |
| `runtime.theme` | enum: dark, light | dark | Yes | No | `PANCODE_THEME` | theme | `/theme` |
| `runtime.intelligence` | boolean | false | Yes | No | `PANCODE_INTELLIGENCE` | intelligence | None |
| `models.orchestrator` | string (provider/model-id) | "" | No | No | `PANCODE_MODEL` | preferredModel | `/models` |
| `models.worker` | string (provider/model-id) | "" | Yes | No | `PANCODE_WORKER_MODEL` | workerModel | None |
| `models.scout` | string (provider/model-id) | "" | Yes | No | `PANCODE_SCOUT_MODEL` | | None |
| `budget.ceiling` | number ($) | 10.0 | Yes | No | `PANCODE_BUDGET_CEILING` | budgetCeiling | `/budget` (view only) |
| `dispatch.timeout` | number (ms) | 300000 | Yes | Yes | `PANCODE_DISPATCH_TIMEOUT` | | None |
| `dispatch.maxDepth` | number | 2 | Yes | Yes | `PANCODE_DISPATCH_MAX_DEPTH` | | None |
| `dispatch.concurrency` | number | 4 | Yes | Yes | `PANCODE_DISPATCH_CONCURRENCY` | | None |
| `dispatch.heartbeatInterval` | number (ms) | 10000 | Yes | Yes | `PANCODE_HEARTBEAT_INTERVAL_MS` | | None |
| `dispatch.workerTimeout` | number (ms) | 300000 | Yes | Yes | `PANCODE_WORKER_TIMEOUT_MS` | | None |
| `preset.active` | string | "" | No | No | `PANCODE_PRESET` | | `/preset` |

**Command coverage gaps:**
- `runtime.intelligence`: No command to view or toggle. Only accessible via `pan_apply_config` tool or env var.
- `models.worker`: No command to view or set. Only via env var or tool.
- `models.scout`: No command to view or set. Only via env var or tool.
- `budget.ceiling`: `/budget` shows it but cannot change it. Only via env var or tool.
- `dispatch.*` (5 params): No commands. Admin-only via `pan_apply_config` tool.

### 2.2 Environment Variables (comprehensive list)

#### User-Facing Configuration

| Env Var | Controls | Boot/Runtime | Default | Has Command |
|---------|----------|-------------|---------|-------------|
| `PANCODE_PRESET` | Active boot preset | Boot | none | `/preset` |
| `PANCODE_MODEL` | Orchestrator model | Boot | auto-select | `/models` |
| `PANCODE_WORKER_MODEL` | Worker pool model | Runtime | null (inherit) | **No** |
| `PANCODE_SCOUT_MODEL` | Shadow scout model | Runtime | null (inherit) | **No** |
| `PANCODE_SAFETY` | Autonomy level | Runtime | auto-edit | `/safety`, Ctrl+Y |
| `PANCODE_REASONING` | Reasoning effort | Runtime | medium | `/reasoning` |
| `PANCODE_THEME` | TUI color theme | Runtime | dark | `/theme` |
| `PANCODE_INTELLIGENCE` | Adaptive learning | Runtime | false | **No** |
| `PANCODE_BUDGET_CEILING` | Max session spend ($) | Runtime | 10.0 | `/budget` (view only) |
| `PANCODE_PER_RUN_BUDGET` | Per-run budget cap | Runtime | none | **No** |
| `PANCODE_DISPATCH_TIMEOUT` | Worker timeout (ms) | Runtime | 300000 | **No** |
| `PANCODE_DISPATCH_MAX_DEPTH` | Max dispatch depth | Runtime | 2 | **No** |
| `PANCODE_DISPATCH_CONCURRENCY` | Concurrent workers | Runtime | 4 | **No** |
| `PANCODE_HEARTBEAT_INTERVAL_MS` | Heartbeat interval | Runtime | 10000 | **No** |
| `PANCODE_WORKER_TIMEOUT_MS` | Per-spawn timeout | Runtime | 300000 | **No** |
| `PANCODE_VERBOSE` | Debug logging | Runtime | false | **No** |
| `PANCODE_STRICT_TIERS` | Enforce tier routing | Boot | false | **No** |
| `PANCODE_SCORING_POLICY` | Agent scoring mode | Boot | default | **No** |

#### Infrastructure Discovery

| Env Var | Controls | Boot/Runtime | Default | Has Command |
|---------|----------|-------------|---------|-------------|
| `PANCODE_LOCAL_MACHINES` | Remote engine endpoints | Boot | none | **No** |
| `PANCODE_NODE_CONCURRENCY` | Per-machine limit | Boot | none | **No** |
| `PANCODE_PROBE_TIMEOUT_MS` | Discovery probe timeout | Boot | 1000 | **No** |
| `PANCODE_CACHE_TTL_HOURS` | Model cache validity | Boot | none | **No** |

#### System Paths

| Env Var | Controls | Boot/Runtime | Default |
|---------|----------|-------------|---------|
| `PANCODE_HOME` | User config dir | Boot | ~/.pancode |
| `PANCODE_PACKAGE_ROOT` | Installation root | Boot | process.cwd() |
| `PANCODE_BIN_PATH` | Entry script path | Boot | argv[1] |
| `PANCODE_AGENT_DIR` | Pi SDK agent dir | Boot | ~/.pancode/agent-engine |
| `PANCODE_RUNTIME_ROOT` | Per-project runtime state | Boot | .pancode/runtime |
| `PANCODE_PROJECT` | Project root dir | Boot | cwd |
| `PANCODE_TIMEOUT_MS` | Tool execution timeout | Boot | 120000 |
| `PANCODE_STARTUP_BUDGET_MS` | Boot phase budget | Boot | 3000 |

#### Internal (set by system, not user)

| Env Var | Set By | Purpose |
|---------|--------|---------|
| `PANCODE_ENTRYPOINT` | loader.ts | orchestrator or worker |
| `PANCODE_INSIDE_TMUX` | loader.ts | Boot context detection |
| `PANCODE_ENABLED_DOMAINS` | orchestrator.ts | Loaded domain list |
| `PANCODE_EFFECTIVE_THINKING` | orchestrator.ts | Computed thinking level |
| `PANCODE_DISPATCH_DEPTH` | cli-base.ts | Current nesting level |
| `PANCODE_SESSION_ID` | dispatch ext | Session identifier |
| `PANCODE_PARENT_PID` | worker entry | Worker parent PID |
| `PANCODE_BOARD_FILE` | worker entry | Dispatch board path |
| `PANCODE_CONTEXT_FILE` | worker entry | Context data path |
| `PANCODE_RUN_ID` | worker entry | Current run ID |
| `PANCODE_RECEIPT_DIR` | receipts.ts | Receipt storage path |
| `PANCODE_MAX_RUNS` | state.ts | Ring buffer limit |
| `PANCODE_MAX_METRICS` | metrics.ts | Metrics buffer limit |
| `PANCODE_LEDGER_MAX` | dispatch-ledger.ts | Ledger capacity |
| `PI_SKIP_VERSION_CHECK` | orchestrator.ts | Skip Pi SDK version check |
| `PI_CODING_AGENT_DIR` | shared.ts | Pi SDK compat path |

### 2.3 Config Files

#### Global User Config (~/.pancode/)

| File | Format | Purpose | User-Editable | Has Command |
|------|--------|---------|--------------|-------------|
| `settings.json` | JSON | Persistent user preferences | Yes (via tool) | `/preferences` |
| `panpresets.yaml` | YAML | Named boot configurations | Yes (manual) | `/preset` |
| `panagents.yaml` | YAML | Custom agent specs | Yes (manual) | `/agents` (view only) |
| `panproviders.yaml` | YAML | Cached engine endpoints + models | Auto-generated | `/runtimes` (view only) |
| `model-cache.yaml` | YAML | Merged model profiles + reasoning | Auto-generated | `/models` (view only) |
| `default-model` | Text | Single-line fallback model ID | Yes (manual) | **No** |
| `agent-engine/auth.json` | JSON | Pi SDK credentials (API keys) | Via Pi `/login` | **No** |
| `agent-engine/models.json` | JSON | Pi SDK model registry | Auto-managed | **No** |
| `agent-engine/settings.json` | JSON | Pi SDK settings | Via Pi `/settings` | **No** |

#### Project-Local Config (<project>/.pancode/)

| File | Format | Purpose | User-Editable | Has Command |
|------|--------|---------|--------------|-------------|
| `settings.json` | JSON | Project-level config overrides | Yes | **No** |

#### Safety Rules (project or global)

| File | Format | Purpose | User-Editable | Has Command |
|------|--------|---------|--------------|-------------|
| `pansafety.yaml` | YAML | Path + bash restrictions (legacy) | Yes (manual) | **No** |
| `safety-rules.yaml` | YAML | Unified safety rules | Yes (manual) | **No** |

#### Runtime State Files (auto-managed, per-project)

| File | Format | Purpose | Has Command |
|------|--------|---------|-------------|
| `runs.json` | JSON | Dispatch run history | `/runs` |
| `metrics.json` | JSON | Performance metrics per agent | `/metrics` |
| `budget.json` | JSON | Session spending tracker | `/budget` |
| `tasks.json` | JSON | Task list state | (via task tools) |
| `receipts/*.json` | JSON | Completed run receipts | `/receipt` |
| `dispatch-ledger.ndjson` | NDJSON | Full dispatch log | `/audit` |
| `runtime/board.json` | JSON | Worker subprocess state | `/workers` |
| `runtime/context/*.json` | JSON | Cross-agent context data | `/context` |

### 2.4 Config Precedence (highest wins)

```
1. CLI arguments (--model, --safety, --preset, --theme)
2. Preset values (from ~/.pancode/panpresets.yaml)
3. Environment variables (PANCODE_*)
4. Project config (<project>/.pancode/settings.json)
5. Global config (~/.pancode/settings.json)
6. Defaults (src/core/defaults.ts)
```

### 2.5 Preset Schema

File: `~/.pancode/panpresets.yaml`

```yaml
preset_name:
  description: "Human-readable description"
  model: "provider/model-id"          # Orchestrator model
  workerModel: "provider/model-id"    # Worker model (or null)
  scoutModel: "provider/model-id"     # Scout model (or null)
  reasoning: "off|minimal|low|medium|high|xhigh"
  safety: "suggest|auto-edit|full-auto"
```

Applying a preset sets env vars: `PANCODE_MODEL`, `PANCODE_WORKER_MODEL`,
`PANCODE_SCOUT_MODEL`, `PANCODE_REASONING`, `PANCODE_SAFETY`, `PANCODE_PRESET`.

### 2.6 Mode System

Four orchestrator modes control what the orchestrator can DO with user input.
Orthogonal to safety modes (which control what is ALLOWED).

| Mode | Dispatch | Shadow | Mutations | Reasoning | Color |
|------|----------|--------|-----------|-----------|-------|
| admin | Yes | Yes | No | xhigh | #3b82f6 (blue) |
| plan | No | Yes | No | high | #7f45e0 (purple) |
| build | Yes | Yes | Yes | medium | #16c858 (green) |
| review | Yes | Yes | No | xhigh | #dc5663 (red) |

**Tool gating per mode:**

| Tool | admin | plan | build | review |
|------|-------|------|-------|--------|
| read, bash, grep, find, ls | Yes | Yes | Yes | Yes |
| edit, write | No | No | Yes | No |
| shadow_explore | Yes | Yes | Yes | Yes |
| dispatch_agent, batch_dispatch, dispatch_chain | Yes | No | Yes | Yes |
| task_write, task_check, task_update, task_list | Yes | Yes | Yes | No |
| pan_read_config, pan_apply_config | Yes | Yes | Yes | Yes |

**Cycle behavior:**
- Shift+Tab cycles: plan → build → review → plan (excludes admin)
- Alt+A toggles: current ↔ admin (stores/restores previous state)

### 2.7 Safety Levels

| Level | Behavior |
|-------|----------|
| suggest | Ask before executing risky tool actions |
| auto-edit | Approve edits, ask for destructive actions |
| full-auto | Full automation (typically admin-only) |

### 2.8 Reasoning Levels

| Level | Description |
|-------|-------------|
| off | No extended thinking |
| minimal | Minimal reasoning tokens |
| low | Light reasoning |
| medium | Standard reasoning (default) |
| high | Deep reasoning |
| xhigh | Maximum reasoning effort |

Clamped to model capabilities at runtime. Not all models support all levels.
Mode transitions auto-set reasoning: admin→xhigh, plan→high, build→medium, review→xhigh.

### 2.9 Theme System

Two themes: `dark`, `light`. 12 color slots per theme.

| Slot | Purpose |
|------|---------|
| accent | Highlighted elements |
| bold | Bold emphasis |
| muted | Secondary text |
| dim | Low-priority text |
| success | Green states |
| error | Red states |
| warning | Yellow/orange states |
| primary | Headings, active elements |
| bright | White/near-white |
| barFill | Progress bar fill |
| barEmpty | Progress bar empty |
| mode | Mode-specific (varies) |

Mode overrides the `mode` color slot: admin=accent, plan=muted, build=success, review=error.

---

## Part 3: Gap Analysis

### 3.1 Configurability Surfaces with No Command

These config parameters have no slash command to view or change them interactively:

| Parameter | Current Access | Gap |
|-----------|---------------|-----|
| `models.worker` | Env var, pan_apply_config tool | No human-friendly command |
| `models.scout` | Env var, pan_apply_config tool | No human-friendly command |
| `runtime.intelligence` | Env var, pan_apply_config tool | No command to toggle |
| `budget.ceiling` | Env var, pan_apply_config tool | `/budget` shows but cannot set |
| `dispatch.timeout` | Env var, pan_apply_config tool | Admin-only, no command |
| `dispatch.maxDepth` | Env var, pan_apply_config tool | Admin-only, no command |
| `dispatch.concurrency` | Env var, pan_apply_config tool | Admin-only, no command |
| `dispatch.heartbeatInterval` | Env var, pan_apply_config tool | Admin-only, no command |
| `dispatch.workerTimeout` | Env var, pan_apply_config tool | Admin-only, no command |
| `PANCODE_VERBOSE` | Env var only | No command, no config schema entry |
| `PANCODE_STRICT_TIERS` | Env var only | No command, no config schema entry |
| `PANCODE_SCORING_POLICY` | Env var only | No command, no config schema entry |
| `PANCODE_PER_RUN_BUDGET` | Env var only | No command, no config schema entry |
| `PANCODE_LOCAL_MACHINES` | Env var only | No command, no config schema entry |
| `PANCODE_NODE_CONCURRENCY` | Env var only | No command, no config schema entry |
| `PANCODE_PROBE_TIMEOUT_MS` | Env var only | No command, no config schema entry |
| `PANCODE_CACHE_TTL_HOURS` | Env var only | No command, no config schema entry |
| Project settings.json | Manual file edit | No command to view/set per-project overrides |
| pansafety.yaml | Manual file edit | No command to view/manage safety rules |
| safety-rules.yaml | Manual file edit | No command to view/manage safety rules |
| panagents.yaml | Manual file edit | `/agents` shows but cannot create/edit |
| default-model file | Manual file edit | No command |

### 3.2 Command Aliases and Duplicates

| Canonical | Alias | Should Be |
|-----------|-------|-----------|
| `/dashboard` | `/status` | TBD |
| `/preferences` | `/settings` | TBD (also conflicts with Pi built-in) |
| `/reasoning` | `/thinking` | TBD |

### 3.3 Pi Built-in Conflicts

| Pi Command | PanCode Command | Conflict Type |
|------------|----------------|---------------|
| `/settings` | `/settings` (alias for /preferences) | Name collision. PanCode wins because Pi's is hidden. |
| `/session` | `/session` | Name collision. PanCode wins because Pi's is hidden. |
| `/hotkeys` | `/hotkeys` | Name collision. PanCode wins because Pi's is hidden. |
| `/model` | `/models` (redirect via patch) | Indirect. Pi's handler patched to redirect. |
| `/quit` | `/exit` | Functional overlap. Both shut down. |

### 3.4 Dead Pi Commands (hidden, no patch, unreachable)

| Pi Command | Pi Behavior | Status |
|------------|-------------|--------|
| `/scoped-models` | TUI toggle for Ctrl+P model cycling | Dead. No PanCode equivalent. |
| `/changelog` | Show changelog entries | Dead. No PanCode equivalent. |
| `/resume` | TUI session selector | Dead. Unreachable but handler exists. |
| `/quit` | Quit Pi | Dead (hidden). PanCode has `/exit` instead. |
| `/share` | Share session as GitHub gist | Hidden. May still work via Pi internal dispatch. |
| `/name` | Set session display name | Hidden. May still work via Pi internal dispatch. |

### 3.5 Commands Marked for Removal (Locked Decision #7)

From session handoff locked decisions:
- `/preferences` (remove, not the /settings alias)
- `/thinking` (remove alias)
- `/dispatch-insights` (remove)
- `/status` (remove alias)

---

## Part 4: Cross-Reference Matrix

Which command touches which config parameter:

| Config Parameter | View Command | Set Command | Hotkey | Tool |
|-----------------|-------------|-------------|--------|------|
| runtime.safety | `/safety` | `/safety <level>` | Ctrl+Y | pan_apply_config |
| runtime.mode | `/modes` | `/modes <mode>` | Shift+Tab, Alt+A | pan_apply_config |
| runtime.reasoning | `/reasoning` | `/reasoning <level>` | (mode-auto) | pan_apply_config |
| runtime.theme | `/theme` | `/theme <name>` | | pan_apply_config |
| runtime.intelligence | | | | pan_apply_config |
| models.orchestrator | `/models` | `/models <ref>` | | pan_apply_config |
| models.worker | | | | pan_apply_config |
| models.scout | | | | pan_apply_config |
| budget.ceiling | `/budget` | | | pan_apply_config |
| dispatch.* (5 params) | | | | pan_apply_config |
| preset.active | `/preset` | `/preset <name>` | | pan_apply_config |
