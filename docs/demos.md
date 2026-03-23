# PanCode Demo Scenarios

Three reproducible demos that showcase PanCode's orchestration, dispatch, and
observability capabilities. Each demo targets a different use case and
exercises a different capability surface.

## Prerequisites (All Demos)

- Node.js 20 or newer
- `tmux` installed
- PanCode installed (`npm link` from the project root)
- At least one local provider (LM Studio, Ollama, or llama.cpp)

## Demo 1: TUI Interactive (Multi-Provider Dispatch)

**Story:** A developer opens PanCode, dispatches agents across multiple
providers, and observes safety enforcement with live telemetry.

### Setup

1. A local model running on the network (LM Studio, Ollama, or llama.cpp).
2. Claude Code installed with an Anthropic API key configured.
3. A real TypeScript project as the working directory.

```bash
export PANCODE_WORKER_MODEL=lmstudio/qwen3.5-35b-a3b
export PANCODE_SAFETY=auto-edit
```

### Script

```bash
# 1. Boot PanCode in tmux
pancode --preset local
```

Once the dashboard appears:

```text
# 2. Natural language dispatch (orchestrator picks a scout agent)
You: Scan this project for security issues

# PanCode dispatches a scout worker. When the scout returns findings,
# the orchestrator dispatches parallel reviewers across available runtimes.

# 3. Observe dispatch state
/runs          # Shows all dispatches with runtime, tokens, cost
/cost          # Per-provider cost breakdown (local = $0.00, Claude = $X.XX)

# 4. Check worker pool health
/metrics       # Dispatch metrics with timing and token counts

# 5. Switch modes (Shift+Tab or /modes command)
/modes review  # Safety gates change: only readonly workers allowed

# 6. Verify mode enforcement
You: Refactor the auth module
# PanCode blocks dispatch: "Mode 'review' does not allow mutable operations"

# 7. Switch safety level live
/safety suggest  # Workers now require confirmation before edits
```

### What to Look For

- The dispatch board populates as workers launch.
- `/runs` shows each worker's runtime (pi, cli:claude-code), token count,
  and cost.
- Mode switching visibly changes the footer and restricts dispatch behavior.
- Safety level changes take effect immediately without restarting.

### Demonstrates

- Multi-runtime dispatch (Pi native and CLI agents in the same session)
- Multi-provider cost tracking (local at $0.00, cloud with real cost)
- Live safety and mode switching
- Observability commands (/runs, /cost, /metrics)

---

## Demo 2: Batch Audit (Parallel Domain Analysis)

**Story:** A researcher batch-audits a codebase with parallel analysis tasks,
one per domain, and reviews aggregated results.

### Setup

1. PanCode installed with a local model.
2. Use PanCode's own `src/` as the target project.

```bash
export PANCODE_WORKER_MODEL=lmstudio/qwen3.5-35b-a3b
export PANCODE_NODE_CONCURRENCY=4
```

### Script

```bash
# 1. Boot PanCode
pancode --preset local
```

Once the dashboard appears:

```text
# 2. Request a batch audit
You: Audit all domain extensions for boundary violations, one task per domain.
     Check that no domain imports from another domain's internal modules.

# The orchestrator decomposes this into a batch dispatch. Each domain
# gets its own worker analyzing its extension.ts and imports.

# 3. Observe concurrent execution
/runs 10       # Shows up to 10 dispatch entries with timing
/batches       # Shows batch dispatch groupings

# 4. Review budget and analytics
/budget        # Total session spend
/metrics       # Per-dispatch timing and token usage

# 5. Check domain-specific results
/dispatch-insights  # Agent selection and routing decisions

# 6. Verify boot performance
/perf          # Boot phase timing breakdown
```

### What to Look For

- Multiple workers launch in parallel (staggered start visible in /runs).
- Each worker's runtime and completion time appears independently.
- `/budget` accumulates cost across all dispatches.
- `/metrics` shows aggregate statistics (mean latency, total tokens).

### Demonstrates

- Batch dispatch with parallel worker execution
- Concurrency control (PANCODE_NODE_CONCURRENCY limits simultaneous workers)
- Observability aggregation across multiple dispatches
- Budget tracking for batch operations

---

## Demo 3: Headless CI/CD Pipeline (Deferred)

**Story:** A CI pipeline runs PanCode as a code review gate, producing
structured JSON output without a TUI.

> **Status:** Deferred. PanCode v0.3.0 does not include standalone headless
> execution mode. This demo will ship when headless execution is implemented
> (see future-plans/headless-execution.md).

### Simulation

Until headless mode ships, the worker subprocess interface can be invoked
directly to demonstrate the structured output pipeline:

```bash
# Invoke a worker directly (this is how PanCode dispatches internally)
node dist/loader.js --worker \
  --prompt "Review the staged changes for bugs and security issues" \
  --result-file /tmp/pancode-review.json \
  --tools "read,bash,grep,find,ls" \
  --timeout-ms 120000

# Read the structured result
cat /tmp/pancode-review.json | jq '{status: .status, result: .result}'
```

### Target Interface (Future)

```bash
pancode run --headless \
  --task "Review the staged changes for bugs and security issues" \
  --agent reviewer \
  --safety suggest \
  --json \
  | jq '{status: .status, issues: .result}'
```

### Demonstrates (When Shipped)

- Automation integration without tmux or TUI
- Structured JSON output for CI pipeline consumption
- Agent and safety configuration via CLI flags

---

## Diagnostic Health Check (Bonus)

Run the diagnostic command to verify system health before any demo:

```bash
pancode --preset local
```

```text
/doctor
```

The doctor command runs 6 verification categories: runtime availability,
provider connectivity, configuration validity, domain registration, file
system access, and environment variable resolution.
