# Observability

PanCode provides unified observability across all dispatch runs, agents, and
providers. The observability domain collects metrics from SharedBus events,
maintains a persistent dispatch ledger, records structured audit trails, and
generates human-readable receipts.

## Architecture

The observability domain (`src/domains/observability/`) depends on dispatch
and subscribes to bus events to collect data passively. It does not intercept
or modify dispatch behavior.

```
dispatch emits events  ──►  observability collects
  RUN_STARTED                 - MetricsLedger
  RUN_FINISHED                - DispatchLedger
  WORKER_PROGRESS             - AuditTrail
  WARNING                     - ReceiptWriter
  BUDGET_UPDATED
  SESSION_RESET
  COMPACTION_STARTED
```

### Initialization

On `session_start`, the observability extension initializes four subsystems:

1. **MetricsLedger**: session-scoped and cumulative metrics
2. **DispatchLedger**: persistent record of all dispatch runs
3. **AuditTrail**: structured safety and system events
4. **ReceiptWriter**: generates formatted receipts for completed runs

## Metrics Ledger

`src/domains/observability/metrics.ts` tracks quantitative metrics with both
session-scoped and persistent counters.

### Session Metrics

Reset on each session start or `/reset` command:

- Total cost (USD)
- Total input tokens
- Total output tokens
- Cache read/write tokens
- Number of dispatch runs
- Number of successful/failed/timed-out runs
- Tool call counts

### Persistent Metrics

Accumulated across sessions and stored in `.pancode/metrics.json`:

- Cumulative cost
- Cumulative token usage
- Historical run counts

### Metric Collection

Metrics are updated by subscribing to `pancode:run-finished`:

```typescript
sharedBus.on(BusChannel.RUN_FINISHED, (payload) => {
  const event = payload as RunFinishedEvent;
  metricsLedger.recordRun({
    cost: event.usage.cost,
    inputTokens: event.usage.inputTokens,
    outputTokens: event.usage.outputTokens,
    cacheReadTokens: event.usage.cacheReadTokens,
    cacheWriteTokens: event.usage.cacheWriteTokens,
    status: event.status,
  });
});
```

The `/metrics` command displays the current session metrics.

## Dispatch Ledger

`src/domains/observability/dispatch-ledger.ts` maintains a searchable record
of all dispatch runs. The ledger supports:

- **Filtering**: by agent, status, time range
- **Aggregation**: group by agent, compute averages
- **Ring buffer**: configurable maximum entries (default 500, set via
  `PANCODE_MAX_RUNS`). Oldest entries are evicted when the buffer is full.

The ledger is distinct from the run ledger in `dispatch/state.ts`. The dispatch
domain's state tracks active lifecycle. The observability ledger is an
analytical view optimized for querying and reporting.

## Telemetry

`src/domains/observability/telemetry.ts` provides session lifecycle telemetry:

- Boot timing per phase
- Extension loading duration
- Model discovery timing
- Session duration
- Peak concurrent workers

Telemetry data is accessible via the `/perf` command, which shows a breakdown
of startup phases and their durations.

## Receipts

`src/domains/observability/receipts.ts` generates human-readable receipts for
completed dispatch runs. Each receipt includes:

- Run ID and timestamp
- Agent name and model used
- Task description
- Duration (wall clock)
- Token usage (input, output, cache)
- Estimated cost
- Exit status
- Result summary (truncated)

Receipts are accessible via the `/receipt` command:

```
/receipt              # show receipt for most recent run
/receipt <runId>      # show receipt for a specific run
```

## Health Monitoring

`src/domains/observability/health.ts` provides runtime health diagnostics:

- Provider connectivity status
- Model availability
- Domain loading status
- Budget utilization
- Active worker count and health states

The `/doctor` command runs a diagnostic check and reports the health status
of all system components.

## Audit Trail

The audit trail records structured events with timestamps, source
identification, and categorization. Two primary sources feed the audit trail:

### Safety Audit Events

Every tool call evaluation by the safety domain is recorded:

```typescript
{
  timestamp: string;
  toolName: string;
  actionClass: ActionClass;
  allowed: boolean;
  reasonCode: SafetyReasonCode;
  detail: string;
}
```

### System Events

System-level events are also recorded:
- Session start/stop
- Mode changes
- Safety level changes
- Configuration changes
- Warnings and errors
- Compaction events

The `/audit` command displays the audit trail with filtering options.

## Cost Tracking

Cost tracking spans the observability and scheduling domains:

- **Observability** records per-run costs in the metrics ledger and dispatch
  ledger
- **Scheduling** maintains the budget tracker with ceiling enforcement

The `/cost` command (registered by dispatch) shows a session cost summary:
- Total cost this session
- Per-agent cost breakdown
- Per-model cost breakdown
- Budget utilization percentage

## Persistence

Observability data is stored in `.pancode/`:

| File | Contents | Retention |
|------|----------|-----------|
| `metrics.json` | Cumulative and session metrics | Ring buffer (default 1000 entries) |
| `runs.json` | Run ledger (shared with dispatch) | Ring buffer (default 500 entries) |

Ring buffer sizes are configurable via environment variables:
- `PANCODE_MAX_RUNS`: maximum run history entries
- `PANCODE_MAX_METRICS`: maximum metric history entries

## Commands

| Command | Description |
|---------|-------------|
| `/metrics` | Show session metrics (cost, tokens, runs) |
| `/audit` | Show safety audit trail |
| `/doctor` | Run system diagnostics |
| `/receipt` | Show dispatch run receipt |
| `/cost` | Show session cost summary (registered by dispatch) |
| `/perf` | Show startup performance breakdown (registered by ui) |

## Cross-References

- [Dispatch](./dispatch.md): where dispatch events originate
- [Event System](../architecture/event-system.md): SharedBus event flow
- [Safety](./safety.md): safety audit event generation
- [Domains](../architecture/domains.md): observability domain reference
