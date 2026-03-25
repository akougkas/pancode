---
title: "Commands"
description: "Complete slash command reference"
---

:::caution[Experimental Preview]
This is an experimental preview release. APIs, commands, and features may change without notice.
:::


Complete reference for all PanCode slash commands and tools, organized by domain.

## Agents Domain

### /agents

List and configure PanCode agent specs.

```
/agents                              List all registered agents
/agents set <name> runtime <value>   Change agent runtime
/agents set <name> model <value>     Change agent model
/agents set <name> tier <value>      Change agent tier (frontier/mid/any)
```

Output shows a table with agent name, model, speed, autonomy, tags, and readonly status. Changes via `set` are persisted to `~/.pancode/panagents.yaml`.

### /runtimes

List all registered agent runtimes with availability status.

```
/runtimes
```

Shows each runtime's ID, type (native/cli), tier, version, active/missing status, and binary name. Runtimes are discovered at boot by scanning PATH for known binaries.

### /workers

Show the PanCode worker pool with composite scores.

```
/workers
```

Displays each materialized worker with availability, capacity, load, capability, cost, and overall score. Workers are the cross-product of agent specs, available runtimes, and discovered models.

### /skills

Discover and inspect agent skills from the project directory.

```
/skills                  List all discovered skills
/skills show <name>      Show full skill definition
/skills validate         Check tool requirements against active tools
```

Skills are markdown files (`SKILL.md`, `*.skill.md`) discovered from `.pancode/skills/`, `.claude/`, `.codex/`, and `.gemini/` directories.

## Dispatch Domain

### Tools

These are orchestrator tools invoked through conversation, not slash commands.

#### dispatch_agent

Delegate a task to a specialized worker agent.

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `task` | string | required | Task description for the worker |
| `agent` | string | `"dev"` | Agent spec name |
| `isolate` | boolean | false | Run in a git worktree |

The worker runs as a separate subprocess with its own context window. Results are returned to the orchestrator context.

Mode gating: Dispatch is disabled in Plan mode. Review mode only allows readonly agents.

#### batch_dispatch

Run multiple tasks in parallel across agents.

| Parameter | Type | Description |
|-----------|------|-------------|
| `tasks` | array | Array of `{task, agent}` objects |

Tasks launch with staggered starts to avoid resource contention. Each task gets its own worker subprocess.

#### dispatch_chain

Run a sequential multi-step pipeline.

| Parameter | Type | Description |
|-----------|------|-------------|
| `steps` | array | Ordered array of `{task, agent}` steps |

Each step receives the output of the previous step. The chain stops on any failure.

#### task_write

Create a task in the PanCode task list.

| Parameter | Type | Description |
|-----------|------|-------------|
| `title` | string | Task title |
| `description` | string | Task description |

#### task_check

Mark a task as done.

| Parameter | Type | Description |
|-----------|------|-------------|
| `id` | string | Task ID |

#### task_update

Update a task's title, description, or status.

| Parameter | Type | Description |
|-----------|------|-------------|
| `id` | string | Task ID |
| `title` | string | New title (optional) |
| `description` | string | New description (optional) |
| `status` | string | New status (optional) |

#### task_list

List all tasks in the PanCode task list.

No parameters.

### Slash Commands

#### /stoprun

Stop a running dispatch by run ID.

```
/stoprun <run-id>
/stoprun          # Stops the most recent running dispatch
```

Sends termination signal to the worker subprocess.

#### /cost

Show per-run cost breakdown.

```
/cost
```

Displays a table of all dispatches with cost, tokens, duration, and status.

#### /runs

Show dispatch run history.

```
/runs              # Show recent runs (default: 20)
/runs 50           # Show last 50 runs
```

Displays run ID, agent, status, model, duration, cost, and timestamps.

#### /batches

Show batch dispatch history.

```
/batches
```

Displays recent batch dispatches with task count, status breakdown, and timing.

## Observability Domain

### /metrics

Show PanCode dispatch metrics.

```
/metrics           # Show summary and last 10 runs
/metrics 25        # Show summary and last 25 runs
```

Displays total runs, total cost, total input/output tokens, and recent run details.

### /audit

Show the structured audit trail.

```
/audit                 # Show last 50 entries
/audit <domain>        # Filter by domain (dispatch, session, safety, etc.)
/audit error           # Filter by severity: error
/audit warn            # Filter by severity: warn
/audit info            # Filter by severity: info
/audit run:<runId>     # Filter by correlation ID
```

Each entry shows timestamp, severity, domain, event type, and detail.

### /doctor

Run diagnostic health checks. Eight probes execute in sequence:

| Check | What It Validates |
|-------|-------------------|
| runtime-dir | `.pancode/runtime/` directory exists and is writable |
| orphan-workers | No leaked worker processes (warns if > 8 active) |
| stale-runs | No runs stuck in "running" for over 1 hour |
| provider-health | All tracked providers are healthy or degraded |
| json-file-integrity | State files (runs.json, metrics.json) parse correctly |
| session-dir-size | Session directory disk usage is reasonable |
| budget-headroom | Budget has remaining headroom |
| model-available | At least one model is available |

```
/doctor
```

Output: `[OK]`, `[!!]` (warning), or `[XX]` (failure) for each check with a summary message.

### /receipt

List or verify reproducibility receipts.

```
/receipt                      # List recent receipts
/receipt verify <receipt-id>  # Verify receipt integrity
```

Receipts are generated after each dispatch completes. They contain a hash of the run parameters and results for audit-ready verification.

## Session Domain

### /session

Show session info with PanCode state summary.

```
/session
```

Displays: session file, session ID, session name, branch depth, context tokens, current model, context registry size, shared board size, and memory counts.

### /checkpoint

Mark, list, or inspect session checkpoints.

```
/checkpoint <label>     # Save a checkpoint with label
/checkpoint list        # Show all checkpoints
/checkpoint restore <id>  # Display checkpoint data (display-only in current version)
```

Checkpoints record context registry size, board entries, temporal/persistent memory counts, and budget state.

### /context

View the cross-agent context registry.

```
/context               # List all entries (last 20)
/context <key>         # Show full value for a specific key
/context <source>      # Filter entries by source
```

The context registry enables cross-agent information sharing. Workers write context entries that persist across dispatches.

### /reset

Reset coordination state.

```
/reset                 # Quick reset: clear board + temporal memory (context preserved)
/reset context         # Clear context registry only (with confirmation)
/reset all             # Clear everything: board, context, temporal memory (with confirmation)
```

## Scheduling Domain

### /budget

Show PanCode dispatch budget status.

```
/budget
```

Displays: ceiling, spent, remaining, estimated next dispatch cost, run count, input/output tokens, and per-run cap if set.

Budget changes are conversational. Ask the orchestrator: "set budget to $20".

## UI Domain

### /dashboard

Open the PanCode dashboard.

```
/dashboard
```

Displays a visual summary with mode badge, active dispatches, session statistics, context window bar, and budget status.

### /theme

Inspect or change the active PanCode theme.

```
/theme              # Show current theme
/theme <name>       # Switch theme
```

### /models

List PanCode-visible models or switch model.

```
/models                        # List all visible models
/models provider/model-id      # Switch to specific model
```

### /reasoning

Inspect or change the reasoning preference.

```
/reasoning              # Show current level
/reasoning <level>      # Set level: off|minimal|low|medium|high|xhigh
```

### /modes

Switch orchestrator mode.

```
/modes                  # Show current mode
/modes admin            # Switch to Admin mode
/modes plan             # Switch to Plan mode
/modes build            # Switch to Build mode
/modes review           # Switch to Review mode
```

### /help

Show all PanCode commands organized by category.

```
/help
```

### /preset

List or apply a boot preset.

```
/preset                 # List available presets
/preset <name>          # Apply a preset
```

### /perf

Show boot phase timing breakdown.

```
/perf
```

Displays each boot phase with duration. Phases exceeding 500ms are flagged.

### /safety

Show or switch safety level live.

```
/safety                 # Show current level
/safety suggest         # Switch to suggest
/safety auto-edit       # Switch to auto-edit
/safety full-auto       # Switch to full-auto
```

### /exit

Exit PanCode.

```
/exit
```

### /hotkeys

Show keyboard shortcuts.

```
/hotkeys
```

## Prompts Domain

### /prompt-debug

Show the last compiled orchestrator prompt breakdown.

```
/prompt-debug
```

Displays estimated tokens, included/excluded fragments, hash, and a text preview.

### /prompt-version

Show prompt compilation version history.

```
/prompt-version          # Show last 10 history entries
/prompt-version latest   # Show latest manifests for orchestrator/worker/scout
/prompt-version 25       # Show last 25 entries
```

### /prompt-workers

Show recent worker prompt compilations.

```
/prompt-workers
```

## PanConfigure Domain

### Tools

#### pan_read_config

Read PanCode configuration parameters through conversation.

| Parameter | Type | Description |
|-----------|------|-------------|
| `domain` | string (optional) | Filter: runtime, models, budget, dispatch, preset |

Returns current values, defaults, types, and descriptions.

#### pan_apply_config

Apply a configuration change through conversation.

| Parameter | Type | Description |
|-----------|------|-------------|
| `key` | string | Config param key (e.g., `runtime.safety`) |
| `value` | string, number, or boolean | New value |

Admin-only parameters (`dispatch.timeout`, `dispatch.maxDepth`, `dispatch.concurrency`) require Admin mode.
