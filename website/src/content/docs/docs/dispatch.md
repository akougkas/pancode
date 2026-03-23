---
title: Dispatch Pipeline
---

# Dispatch

Dispatch is where PanCode turns a task into a subprocess result. The path is:

1. The user asks for work in the shell.
2. The orchestrator compiles its prompt and decides whether dispatch is allowed.
3. `src/domains/dispatch/routing.ts` resolves the target model, tools, runtime,
   and readonly flag from the agent spec.
4. `src/domains/dispatch/worker-spawn.ts` asks the runtime adapter for a spawn
   config and launches the subprocess.
5. NDJSON or text output is parsed back into a `WorkerResult`.
6. The run ledger, metrics ledger, budget tracker, and UI are updated from the
   bus events.

## Read These Files First

- `src/domains/dispatch/extension.ts`
- `src/domains/dispatch/routing.ts`
- `src/domains/dispatch/primitives.ts`
- `src/domains/dispatch/state.ts`
- `src/domains/dispatch/worker-spawn.ts`
- `src/engine/runtimes/pi-runtime.ts`
- `src/engine/runtimes/cli-base.ts`

## Worker Lifecycle

### Single Dispatch

`dispatch_agent` handles one task, one agent, one worker subprocess.

Flow:

- Resolve the agent spec, default agent, and mode gates
- Run pre-flight admission checks from safety and scheduling
- Create a `RunEnvelope`
- Emit `pancode:run-started`
- Compile the worker prompt
- Spawn the worker
- Collect streamed progress or buffered output
- Update the run ledger and emit `pancode:run-finished`

The tool accepts:

- `task`
- `agent` with default `dev`
- `isolate` for git worktree isolation

### Batch Dispatch

`batch_dispatch` runs many independent tasks in parallel.

The tool accepts:

- `tasks[]`
- `agent` with default `dev`
- `concurrency` with default 4 and a max of 8

Batch-specific behavior:

- Each task gets its own `RunEnvelope`
- `batch-tracker.ts` records the group
- Workers are launched with a 150ms stagger between runner starts
- The batch summary includes cost and completion counts

### Chain Dispatch

`dispatch_chain` runs a sequential pipeline.

The tool accepts:

- `steps[]`
- `originalTask`

Chain-specific behavior:

- `steps[].task` may reference `$INPUT` and `$ORIGINAL`
- Each step gets the previous step's output
- The chain stops on the first failure
- Optional `outputContract` validation can check files, regex patterns, or a
  validation command

## Routing

`src/domains/dispatch/routing.ts` resolves the worker config from the agent spec.

Resolution order:

1. Use the agent spec model if present
2. Otherwise use `PANCODE_WORKER_MODEL`
3. Otherwise fall back to the orchestrator model

Other routing fields:

- `tools` come from the agent spec
- `systemPrompt` comes from the agent spec
- `sampling` is loaded from the matching model profile if a preset exists
- `runtime` defaults to `pi`
- `runtimeArgs` are passed through unchanged
- `readonly` comes from the agent spec

If the model profile says a tool-calling capability is missing, routing emits a
warning event so the TUI can surface it.

## Safety Gates

Dispatch is blocked when any of the following fail:

- The current mode does not allow dispatch
- The mode allows only readonly agents and the target agent is mutable
- The system is draining for shutdown
- Recursion depth exceeds `PANCODE_DISPATCH_MAX_DEPTH`
- Pre-flight admission checks reject the task
- The agent spec is unknown
- Dispatch rules block the task
- The selected provider is in backoff

Current hardening features:

- Recursion depth guard
- Provider backoff and resilience tracking
- Timeout enforcement
- Worktree isolation for optional filesystem separation
- Session artifact cleanup on shutdown
- Long prompt temp-file protocol

## Progress Tracking

`src/domains/dispatch/worker-spawn.ts` parses Pi NDJSON output and emits live
progress events. The UI listens to those events to update the dispatch board.

Tracked fields:

- Current tool
- Truncated tool arguments
- A ring buffer of the last 5 completed tools
- Total tool count
- Token counts
- Turns

Relevant bus channels:

- `pancode:run-started`
- `pancode:worker-progress`
- `pancode:run-finished`

## Temp Files

Long tasks and long system prompts use the `@/path/to/file` protocol so the
prompt text does not have to live in a process argument list.

Current thresholds:

- Worker runtime prompt threshold: 8000 characters
- Worker entry task prompt threshold: 8000 characters

The temp files are written with `0o600` permissions and cleaned up after the
run completes.

## Timeout Enforcement

Defaults:

- Worker timeout default: 5 minutes
- Override: `PANCODE_WORKER_TIMEOUT_MS`

Where it is enforced:

- `src/domains/dispatch/worker-spawn.ts`
- `src/engine/runtimes/pi-runtime.ts`
- `src/worker/entry.ts`

The Pi runtime passes `--timeout-ms` into the worker entry, and the worker
entry enforces the deadline on the Pi subprocess itself.

## Result Flow

Pi runtime:

- Streams NDJSON for live progress
- Writes the authoritative result to a result file
- Reads the result file back after the subprocess exits

CLI runtime:

- Buffers stdout and stderr
- Parses the adapter-specific JSON or text format
- Returns a `RuntimeResult` directly

The dispatcher normalizes both paths into a single `WorkerResult` shape and
stores it in the run ledger.

## Runtime Adapters

Runtime tiering:

- `native` - Pi
- `cli` - Claude Code, Codex, Gemini, OpenCode, Cline, Copilot CLI

Runtime matrix:

- `pi` - native Pi subprocess, NDJSON streaming, result file
- `cli:claude-code` - `claude`, JSON output
- `cli:codex` - `codex`, JSON lines
- `cli:gemini` - `gemini`, JSON output
- `cli:opencode` - `opencode`, NDJSON output
- `cli:cline` - `cline`, JSON lines
- `cli:copilot-cli` - `copilot`, plain text output

`src/engine/runtimes/discovery.ts` registers the Pi runtime and all CLI
adapters at boot. `/runtimes` shows which ones are available on the current
machine.

## Task Tools

Dispatch also registers task-tracking tools:

- `task_write`
- `task_check`
- `task_update`
- `task_list`

These tools write into the task store under `.pancode/tasks.json`. The task
store is separate from `PANCODE_RUNTIME_ROOT`; runtime scratch files, worker
results, and prompt versions stay under the runtime directory.

## Practical Notes

- `dispatch_chain` is capped at 10 steps
- `batch_dispatch` is capped at 8 tasks
- `dispatch_agent` can optionally isolate work in a git worktree
- Run history, metrics, and budget state are written incrementally to disk
- The dispatch board is a view of those ledgers, not a separate source of truth
