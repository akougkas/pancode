# Dispatch

The dispatch domain is the core of PanCode's orchestration capability. It
provides the tools that the orchestrator LLM calls to spawn worker agents,
manages the run lifecycle, tracks results, and enforces admission policies.

This document covers the full dispatch pipeline from admission to result
collection.

## Dispatch Pipeline

```
LLM calls dispatch_agent(task, agent, ...)
    │
    ▼
┌─────────────────────────────────┐
│  1. ADMISSION                   │
│  Pre-flight checks (sequential) │
│  - Budget gate                  │
│  - Safety/scope gate            │
│  - Custom registered gates      │
└─────────────┬───────────────────┘
              │ all pass
              ▼
┌─────────────────────────────────┐
│  2. AGENT RESOLUTION            │
│  - Look up AgentSpec            │
│  - Resolve model, tools, prompt │
│  - Select runtime adapter       │
└─────────────┬───────────────────┘
              │
              ▼
┌─────────────────────────────────┐
│  3. WORKER CREATION             │
│  - Build environment variables  │
│  - Compile worker system prompt │
│  - Spawn subprocess             │
│  - Register in run ledger       │
│  - Emit RUN_STARTED event       │
└─────────────┬───────────────────┘
              │
              ▼
┌─────────────────────────────────┐
│  4. EXECUTION                   │
│  - Worker processes task        │
│  - Heartbeat monitoring         │
│  - Progress events forwarded    │
│  - Health state tracking        │
└─────────────┬───────────────────┘
              │ worker exits
              ▼
┌─────────────────────────────────┐
│  5. RESULT COLLECTION           │
│  - Read result file             │
│  - Update run ledger            │
│  - Emit RUN_FINISHED event      │
│  - Trigger metrics + budget     │
│  - Return result to LLM        │
└─────────────────────────────────┘
```

## Admission

Before any worker is spawned, the dispatch domain runs pre-flight checks
through the admission system (`src/domains/dispatch/admission.ts`).

### Pre-Flight Check Registry

```typescript
interface PreFlightContext {
  task: string;
  agent: string;
  model: string | null;
}

interface PreFlightResult {
  admit: boolean;
  reason?: string;
}
```

Checks are registered by name and run sequentially. If any check fails, the
dispatch is rejected with the failing check's name and reason.

### Built-in Admission Gates

**Budget gate** (registered by scheduling domain): checks that the session
has not exceeded its cost ceiling. If the total session cost exceeds the
configured budget, dispatch is rejected.

**Safety/scope gate** (registered by safety domain): validates that the
requested worker permissions do not exceed the orchestrator's current
permissions. The privilege non-escalation invariant ensures workers cannot
gain more access than the orchestrator has.

### Custom Gates

Other domains can register custom pre-flight checks via
`registerPreFlightCheck(name, fn)`. The check receives the task context and
returns an admit/reject decision.

## Dispatch Tools

The dispatch domain registers several tools that the orchestrator LLM can call.

### dispatch_agent

Single worker dispatch. The primary tool for running tasks.

Parameters:
- `task` (required): description of the work to perform
- `agent` (optional): agent name from the spec registry. If omitted, the
  default agent is used.
- `model` (optional): model override for this specific dispatch
- `cwd` (optional): working directory for the worker
- `systemPrompt` (optional): additional system prompt content
- `outputContract` (optional): validation criteria for the result

The tool spawns a subprocess, monitors it, collects the result, and returns
the worker's output to the LLM.

### batch_dispatch

Parallel dispatch of multiple workers. Each worker runs independently with
staggered launches.

Parameters:
- `tasks` (required): array of task descriptions
- `agent` (optional): agent name (applied to all tasks)
- `staggerMs` (optional): delay between worker launches (default varies)

Batch dispatch creates a batch tracker that monitors all workers and reports
individual results as they complete.

### dispatch_chain

Sequential pipeline where each step's output feeds into the next step's input.

Parameters:
- `steps` (required): array of chain steps, each with a task and optional agent
- `agent` (optional): default agent for steps that do not specify one

Chain dispatch substitutes `$INPUT` with the previous step's output and
`$ORIGINAL` with the first step's output. The chain stops at the first failure.

### stoprun

Cancels a running worker by sending SIGTERM to its subprocess.

Parameters:
- `runId` (required): the ID of the run to cancel

### Task Board Tools

The dispatch domain also registers task board tools for structured task
tracking:

- `task_write`: create a new task entry
- `task_check`: check the status of a task
- `task_update`: update a task's status or content
- `task_list`: list all tasks with optional filtering

## Worker Spawning

`src/domains/dispatch/worker-spawn.ts` handles the subprocess lifecycle.

### Native Workers

For agents with `runtime: "pi"`, the worker spawn process:

1. Builds environment variables (`PANCODE_SAFETY`, `PANCODE_PARENT_PID`, etc.)
2. Creates the worker entry command pointing to `src/worker/entry.ts`
3. Passes the task as a CLI argument (or via temp file for tasks > 8KB)
4. Spawns the subprocess with piped stdout
5. Parses NDJSON events from stdout for progress tracking
6. Registers the subprocess in `liveWorkerProcesses` for lifecycle management

### CLI Agent Workers

For agents with `runtime: "cli:*"` (e.g., `cli:claude-code`, `cli:codex`),
the runtime adapter from `src/engine/runtimes/` handles spawning. The adapter:

1. Locates the agent binary in PATH
2. Builds agent-specific CLI arguments for headless mode
3. Passes the task and system prompt through the agent's CLI interface
4. Captures stdout/stderr and parses the result

### Worker Process Tracking

```typescript
export const liveWorkerProcesses = new Set<ChildProcess>();
export const workerProcessByRunId = new Map<string, ChildProcess>();
```

All live worker processes are tracked for bulk operations (shutdown, status).
The `workerProcessByRunId` map enables targeted cancellation via `/stoprun`.

## Run Lifecycle

### Run States

Each dispatch run transitions through states:

```
pending → running → done | error | timeout | budget_exceeded | interrupted
```

- **pending**: admitted but not yet spawned
- **running**: subprocess is active
- **done**: worker completed successfully (exit code 0)
- **error**: worker exited with non-zero exit code
- **timeout**: worker exceeded its timeout and was killed
- **budget_exceeded**: worker exceeded its per-run cost budget
- **interrupted**: worker was killed by orchestrator shutdown or manual cancellation

### Run Ledger

`src/domains/dispatch/state.ts` maintains the run ledger, a persistent record
of all dispatch runs. The ledger is stored in `.pancode/runs.json` and loaded
on session start.

Each run envelope contains:
- Run ID, task description, agent name
- Model, runtime, timestamps (started, completed)
- Exit code, status, result text
- Usage metrics (cost, tokens, turns)
- Error messages if any

### Orphan Reaping

On session start, the orchestrator checks for runs in "running" or "pending"
state from a previous session. These are marked as "interrupted" because the
previous orchestrator process is no longer managing them.

## Monitoring

### Heartbeat Events

Workers emit periodic heartbeat events (`WorkerHeartbeatEvent`) as NDJSON on
stdout. Each heartbeat includes:

```typescript
{
  runId: string;
  ts: string;          // ISO timestamp
  turns: number;       // LLM conversation turns
  lastToolCall: string | null;
  tokensThisBeat: { in: number; out: number };
}
```

### Health Monitor

`src/domains/dispatch/health.ts` tracks worker health based on heartbeat
freshness. Workers are classified as:

- **healthy**: heartbeats arriving within expected intervals
- **stale**: heartbeat delayed beyond threshold
- **dead**: no heartbeat for an extended period
- **recovered**: previously stale/dead worker that resumed

Health state changes emit `pancode:worker-health-changed` events on the
SharedBus. The UI domain displays health status in the worker progress view.

### Progress Events

Workers emit progress events (`WorkerProgressEvent`) with:

```typescript
{
  runId: string;
  inputTokens: number;
  outputTokens: number;
  turns: number;
  currentTool: string | null;
  currentToolArgs: string | null;
  recentTools: string[];     // ring buffer, max 5
  toolCount: number;
}
```

The UI domain uses these events to display live worker activity.

## Provider Resilience

### Backoff

`src/domains/dispatch/backoff.ts` implements token bucket rate limiting and
exponential backoff for provider requests. If a provider returns rate limit
errors, subsequent dispatches to that provider are delayed with exponential
backoff.

### Circuit Breaker

`src/domains/dispatch/resilience.ts` implements a circuit breaker pattern for
provider health. If a provider consistently fails, the circuit breaker opens
and rejects dispatches to that provider until health recovers.

## Worktree Isolation

`src/domains/dispatch/isolation.ts` supports git worktree isolation for
workers that need their own filesystem view. When enabled, the dispatch system
creates a temporary git worktree for the worker, runs the task in that worktree,
and cleans up after completion.

This prevents concurrent workers from interfering with each other's file
operations on the same repository.

## Output Contracts

`src/domains/dispatch/validation.ts` implements post-dispatch validation.
An output contract specifies expected results:

```typescript
interface OutputContract {
  expectedFiles?: string[];      // files that should exist after the task
  expectedPatterns?: string[];   // regex patterns that should match in output
  validationCommand?: string;    // shell command that should exit 0
  timeoutMs?: number;           // timeout for validation command
}
```

Each check produces a pass/fail result. The contract summary is included in
the dispatch result returned to the LLM.

## Dispatch Commands

The dispatch domain registers several slash commands:

- `/cost`: show session cost summary (total cost, tokens, runs)
- `/runs`: list dispatch runs with filtering options
- `/batches`: list batch dispatch operations

## Event Flow

When a dispatch completes:

```
dispatch emits RUN_FINISHED
  ├─ observability: records metrics, updates dispatch ledger
  ├─ scheduling: adjusts budget, emits BUDGET_UPDATED
  │     └─ ui: updates budget display
  ├─ ui: updates worker status display
  └─ intelligence (if enabled): records outcome for learning
```

## Recursion Guards

The dispatch system includes guards against recursive dispatch. A worker
cannot dispatch other workers because:

1. Workers do not load the dispatch domain (physical isolation)
2. Workers do not have dispatch tools registered
3. The worker entry point loads only the provider bridge and safety extension

This is enforced structurally, not by runtime checks.

## Cross-References

- [Architecture Overview](../architecture/overview.md): data flow diagram
- [Worker Isolation](../architecture/worker-isolation.md): subprocess model
- [Safety](./safety.md): admission gates and scope enforcement
- [Observability](./observability.md): metrics collection from dispatch events
- [Domains](../architecture/domains.md): dispatch domain reference
