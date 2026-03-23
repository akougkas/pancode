# Worker Isolation

Every PanCode worker runs as an isolated subprocess. Workers cannot import
orchestrator domain logic, cannot spawn child workers, and cannot access other
workers' state. This physical isolation is a locked architectural decision.

## Why Subprocess Isolation

PanCode orchestrates heterogeneous coding agents. Each agent may use different
models, different providers, and different tool sets. Running them in-process
would create shared state hazards, make crash isolation impossible, and prevent
PanCode from supporting CLI-based agents that run as separate binaries.

Subprocess isolation provides:

- **Crash containment**: a crashing worker does not bring down the orchestrator
- **Resource isolation**: each worker has its own memory space and file handles
- **Security boundary**: workers run with constrained permissions enforced by
  the safety extension
- **Runtime flexibility**: Pi SDK native agents and CLI agents (Claude Code,
  Codex, Gemini CLI) use the same dispatch interface

## Physical Separation

`src/worker/` lives outside `src/domains/`. This is enforced by directory
structure and verified by `npm run check-boundaries`. The worker directory
contains exactly four files:

| File | Purpose |
|------|---------|
| `entry.ts` | Main worker subprocess entry point for Pi SDK native agents |
| `cli-entry.ts` | Thin wrapper that monitors parent process and forwards signals |
| `provider-bridge.ts` | Builds environment variables and CLI args for Pi SDK model resolution |
| `safety-ext.ts` | Pi SDK extension loaded into workers for policy enforcement |

Workers load only the provider bridge (for model resolution) and the safety
extension (for tool call gating). They do not load dispatch, agents,
observability, scheduling, or any other orchestrator domain.

## Worker Lifecycle

### Spawn

The orchestrator's dispatch domain (`src/domains/dispatch/worker-spawn.ts`)
spawns workers via `child_process.spawn`. The spawn process:

1. Resolves the agent spec (model, tools, system prompt, runtime type)
2. Selects the runtime adapter (Pi native or CLI agent)
3. Builds the worker environment variables (`PANCODE_SAFETY`, `PANCODE_PARENT_PID`,
   `PANCODE_BOARD_FILE`, `PANCODE_CONTEXT_FILE`, etc.)
4. Spawns the subprocess with piped stdout for event collection

For Pi SDK native workers, the entry point is `src/worker/entry.ts`. For CLI
agents, the entry point is `src/worker/cli-entry.ts` which wraps the external
binary.

### Execution

During execution, the worker processes its task and communicates with the
orchestrator through two channels:

**Stdout (NDJSON events)**: The worker emits newline-delimited JSON events to
stdout. These include lifecycle events (`worker:started`, `worker:completed`),
heartbeat events (periodic health signals), and progress events (token counts,
current tool). The orchestrator's dispatch extension parses these events to
update the live progress display.

**Result file**: On completion, the worker writes a structured JSON result to
`.pancode/runtime/results/<runId>.result.json`. This file contains the exit
code, assistant output text, usage metrics (tokens, cost), errors, and log
paths.

### Monitoring

The orchestrator monitors workers through two mechanisms:

**Heartbeat monitoring**: Workers emit periodic heartbeat events. The health
monitor (`src/domains/dispatch/health.ts`) classifies workers as healthy,
stale, or dead based on heartbeat freshness. Health state changes emit
`pancode:worker-health-changed` events on the SharedBus.

**Parent PID checking**: Workers monitor the orchestrator's PID at 2-second
intervals. If the parent process dies (e.g., SIGKILL), the worker detects
this and exits. This prevents orphaned worker processes.

```typescript
// From src/worker/cli-entry.ts
const parentCheck = setInterval(() => {
  try { process.kill(parentPid, 0); }
  catch { clearInterval(parentCheck); child.kill("SIGTERM"); }
}, 2000);
```

### Termination

Workers terminate in one of four ways:

1. **Normal completion**: the agent finishes its task and exits with code 0
2. **Timeout**: the worker exceeds its configured timeout and is killed with
   SIGTERM, then SIGKILL after a grace period
3. **Budget exceeded**: the worker exceeds its per-run cost budget
4. **Orchestrator shutdown**: the termination coordinator sends SIGTERM to all
   workers, waits for exit, then sends SIGKILL to stragglers

On termination, the worker's run status is updated in the dispatch ledger
(done, error, timeout, budget_exceeded, or interrupted).

## IPC Mechanism

### Orchestrator to Worker

Configuration flows from the orchestrator to the worker via:

- **Command-line arguments**: task prompt, model, provider, safety mode, system
  prompt, result file path. For prompts exceeding 8KB, the prompt is written to
  a temporary file and passed via `@filepath` syntax.
- **Environment variables**: `PANCODE_SAFETY` (autonomy mode),
  `PANCODE_PARENT_PID` (parent process ID), `PANCODE_BOARD_FILE` (shared board
  path), `PANCODE_CONTEXT_FILE` (context registry path), `PI_CODING_AGENT_DIR`
  (Pi SDK agent directory).

### Worker to Orchestrator

Results flow from the worker to the orchestrator via:

- **Stdout NDJSON**: real-time events (heartbeats, progress, lifecycle)
- **Result file**: final structured result written atomically to disk

The orchestrator never reads worker memory directly. All communication is
through these two explicit channels.

## Worker-Side Safety

Workers load `src/worker/safety-ext.ts` as a Pi SDK extension. This extension:

1. Defines a policy matrix identical to the orchestrator's safety domain but
   evaluated locally in the worker process
2. Classifies every tool call into an action class
3. Blocks disallowed actions before execution
4. Detects destructive bash patterns (`rm -rf`, `git reset --hard`,
   `git push --force`)
5. Registers coordination tools (`board_read`, `board_write`,
   `report_context`, `read_context`) for file-based IPC with the orchestrator

The autonomy mode is passed from the orchestrator via the `PANCODE_SAFETY`
environment variable. Workers cannot escalate their own permissions.

## Scope Enforcement

The safety domain's `scope-enforcement.ts` validates at dispatch admission that
a worker's requested permissions do not exceed the orchestrator's current
permissions. This is the privilege non-escalation invariant:

- A worker dispatched in `auto-edit` mode cannot gain `full-auto` permissions
- A worker dispatched in `suggest` mode cannot write files or execute bash
- The orchestrator's current safety level is the ceiling for all workers

## Coordination Tools

Workers can communicate structured data back to the orchestrator through
file-based coordination tools registered by the safety extension:

### board_read / board_write

The shared board (`PANCODE_BOARD_FILE`) is a namespaced key-value store. Workers
write intermediate findings that other workers or the orchestrator can read.
Writes use file-based locking for safe concurrent access.

### report_context / read_context

The context registry (`PANCODE_CONTEXT_FILE`) stores structured findings from
worker agents. Workers call `report_context(key, value)` to contribute
discoveries. The orchestrator reads accumulated context via `read_context()`.
Each entry is tagged with its source agent and timestamp.

These tools are only registered if the corresponding environment variables are
set by the orchestrator at dispatch time. Workers that do not need coordination
run without these tools.

## Process Management

### Stale Artifact Cleanup

The dispatch domain periodically cleans up result files older than 24 hours
from `.pancode/runtime/results/`. This prevents disk space accumulation from
long-running sessions.

### Concurrent Worker Limits

The dispatch system respects concurrency limits configured via the scheduling
domain. When the maximum number of concurrent workers is reached, new dispatch
requests are queued until a running worker completes.

### Signal Handling

Workers forward signals from the orchestrator to their child processes:

- **SIGTERM**: graceful shutdown request. The worker attempts to stop cleanly.
- **SIGINT**: interrupt request. Forwarded to allow the agent to handle Ctrl+C.
- **SIGKILL**: forced termination after the grace period expires.

The orchestrator's termination coordinator (`src/core/termination.ts`) ensures
all workers receive SIGTERM during shutdown, waits for graceful exit, and
escalates to SIGKILL for workers that do not respond within the timeout.

## Cross-References

- [Architecture Overview](./overview.md): where workers fit in the 5-layer model
- [Engine Boundary](./engine-boundary.md): the Pi SDK boundary that workers use
- [Safety](../guides/safety.md): behavioral model and policy enforcement
- [Dispatch](../guides/dispatch.md): the full dispatch pipeline
