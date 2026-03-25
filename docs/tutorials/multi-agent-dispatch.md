# Tutorial: Multi-Agent Dispatch

This tutorial covers PanCode's dispatch system: single dispatches, batch operations, chain pipelines, monitoring, and budget management.

## Prerequisites

- PanCode running with at least one model available
- Build mode active (Shift+Tab to cycle)

## Single Dispatch

The simplest dispatch sends one task to one agent.

### Through Conversation

Ask PanCode to perform a task. The orchestrator decides whether to handle it directly or delegate to a worker:

```
You: "Review the authentication module in src/auth/ for security issues"
```

If the orchestrator dispatches, it uses the `dispatch_agent` tool internally:
- `task`: The task description
- `agent`: Which agent to use (defaults to "dev")
- `isolate`: Whether to use worktree isolation (defaults to false)

### Specifying an Agent

```
You: "Dispatch the reviewer agent to analyze src/core/config.ts"
You: "Use the scout to explore what test frameworks are in use"
You: "Have the planner create an implementation plan for the auth refactor"
```

### Worktree Isolation

For tasks that modify files, request isolation to prevent interference between concurrent workers:

```
You: "Dispatch the builder to refactor config.ts, use worktree isolation"
```

With isolation enabled:
1. PanCode creates a git worktree
2. The worker operates on an isolated copy of the repository
3. On completion, file changes are merged back as delta patches
4. The worktree is cleaned up

## Batch Dispatch

Run multiple tasks in parallel using `batch_dispatch`:

```
You: "Review these three files in parallel:
      - src/core/config.ts
      - src/core/presets.ts
      - src/core/defaults.ts"
```

PanCode launches one worker per task with staggered starts to avoid resource contention. Each worker has its own context window and runs independently.

### Monitoring Batches

```
/batches        # View batch dispatch history with task counts
/runs           # View individual run history
```

## Chain Dispatch

Run a sequential pipeline where each step builds on the previous:

```
You: "First have the planner analyze the auth module, then have the builder
      implement the improvements, then have the reviewer validate the changes"
```

PanCode uses `dispatch_chain` internally:
1. Step 1 (planner): Analyzes the module, produces a plan
2. Step 2 (builder): Receives the plan as context, implements changes
3. Step 3 (reviewer): Reviews the implementation

The chain stops if any step fails. Each step receives the output of the previous step.

## Monitoring Dispatches

### Active Dispatches

The TUI footer shows active dispatch status with progress indicators. While workers are running, you can continue interacting with the orchestrator.

### Run History

```
/runs           # Show last 20 runs
/runs 50        # Show last 50 runs
```

Each entry shows: run ID, agent, status, model, duration, and cost.

Run statuses:
| Status | Meaning |
|--------|---------|
| `done` | Completed successfully |
| `error` | Worker encountered an error |
| `timeout` | Worker exceeded time limit |
| `budget_exceeded` | Per-run budget cap hit |
| `interrupted` | Worker stopped by user or shutdown |
| `running` | Currently executing |
| `pending` | Queued, not yet started |

### Stop a Running Dispatch

```
/stoprun <run-id>
/stoprun              # Stops most recent running dispatch
```

### Cost Analysis

```
/cost                 # Per-run cost breakdown
/metrics              # Aggregate statistics (total runs, cost, tokens)
```

## Reproducibility Receipts

Every completed dispatch generates a reproducibility receipt containing:
- Run parameters (task, agent, model, safety level)
- Results (exit code, duration, token usage, cost)
- Content hash for integrity verification

### List Receipts

```
/receipt
```

### Verify a Receipt

```
/receipt verify <receipt-id>
```

Returns `PASS` if the receipt is intact or `TAMPERED` if the content has been modified.

## Budget Management

PanCode tracks dispatch spending against a configurable ceiling.

### View Budget

```
/budget
```

Shows: ceiling, amount spent, remaining budget, estimated cost of next dispatch, run count, and token totals.

### Set Budget

Budget changes are conversational:

```
You: "Set the budget ceiling to $25"
You: "Increase the budget to $50"
```

Or set via environment variable:

```bash
PANCODE_BUDGET_CEILING=25.00
```

### Per-Run Budget Cap

Limit the cost of any single dispatch:

```bash
PANCODE_PER_RUN_BUDGET=2.00
```

### Budget Admission Gate

When the budget ceiling is approached, PanCode blocks new dispatches:

```
Dispatch blocked: Budget ceiling would be exceeded
(spent: $9.50, estimated next: $0.75, ceiling: $10.00)
```

## Admission Pipeline

Every dispatch passes through an admission pipeline before execution:

1. **Mode gate**: Dispatch must be enabled in the current mode (not Plan mode)
2. **Mutation check**: In Review mode, only readonly agents are permitted
3. **Drain check**: No dispatches during shutdown
4. **Recursion guard**: Depth cannot exceed `PANCODE_DISPATCH_MAX_DEPTH` (default: 2)
5. **Task validation**: Empty tasks are rejected
6. **Path validation**: File paths in the task are checked for scope violations (no paths outside project root) and existence warnings
7. **Safety pre-flight**: Scope enforcement and loop detection
8. **Budget check**: Estimated cost against remaining budget
9. **Agent resolution**: Agent spec must exist in the registry
10. **Worker routing**: Model and runtime resolution for the agent

## Audit Trail

```
/audit                    # Show recent audit entries
/audit dispatch           # Filter by dispatch domain
/audit run:<run-id>       # Show all entries for a specific run
/audit error              # Show errors only
```

The audit trail records every significant event: run starts, completions, failures, safety decisions, budget changes, and session events.

## Advanced Patterns

### Parallel Reviews

```
You: "Have three different reviewers check src/auth/login.ts simultaneously.
      Use the reviewer for code quality, plan-reviewer for architecture,
      and red-team for security"
```

### Explore Then Build

```
You: "First dispatch the scout to understand the test framework setup,
      then dispatch the builder to add tests for the config module"
```

### Iterative Refinement

```
You: "Dispatch the builder to implement the feature, then dispatch
      the reviewer to check it, and if there are issues, dispatch
      the builder again to fix them"
```

## See Also

- [Agents Guide](../guides/agents.md): Agent specs and capabilities
- [Teams Guide](../guides/teams.md): Team definitions and workflows
- [Commands Reference](../reference/commands.md): All dispatch-related commands
- [Custom Agent Tutorial](./custom-agent.md): Creating specialized agents
