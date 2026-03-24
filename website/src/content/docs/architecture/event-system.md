---
title: "Event System"
description: "Cross-domain event bus architecture"
---

:::caution[Experimental Preview]
This is an experimental preview release. APIs, commands, and features may change without notice.
:::


PanCode uses a SafeEventBus for all cross-domain communication. Domains never
call each other's methods to notify state changes. Instead, the owning domain
emits an event on the shared bus, and interested domains subscribe to it.

## SafeEventBus

The SafeEventBus (`src/core/event-bus.ts`) wraps a standard pub/sub pattern
with error isolation. A crashing listener in one domain does not propagate to
the emitting domain's call stack.

```typescript
export interface SafeEventBus {
  emit(channel: string, payload: unknown): void;
  emitSafe(channel: string, payload: unknown): void;
  on(channel: string, listener: SafeEventListener): () => void;
  listeners(channel: string): SafeEventListener[];
  clear(): void;
}
```

The `on()` method returns an unsubscribe function. The `emit()` method
dispatches the payload to all registered listeners for that channel.

### Error Isolation

The key design choice is using `queueMicrotask` to execute each listener:

```typescript
export function emitSafe(bus: Pick<SafeEventBus, "listeners">, channel: string, payload: unknown): void {
  for (const listener of bus.listeners(channel)) {
    queueMicrotask(() => {
      void Promise.resolve()
        .then(() => listener(payload))
        .catch((error) => reportListenerError(channel, error));
    });
  }
}
```

This provides two guarantees:

1. **Error isolation**: a throwing listener is caught and logged, not propagated
   to the emitter
2. **Predictable ordering**: `queueMicrotask` keeps execution within the same
   microtask queue, maintaining predictable ordering while preventing
   synchronous error propagation

If the observability domain's listener throws while processing a
`pancode:run-finished` event, the dispatch domain (which emitted the event)
is unaffected.

## Shared Bus Singleton

`src/core/shared-bus.ts` exports a module-level singleton:

```typescript
export const sharedBus: SafeEventBus = createSafeEventBus();
```

All domains import this singleton for cross-domain events. Using a singleton
avoids the need to pass the bus through Pi extension contexts. Domains subscribe
in their `session_start` handler and emit when their state changes.

## Event Channels

All channel names and payload types are defined in `src/core/bus-events.ts`.
This centralization means that a shape change in an event payload breaks at
compile time everywhere, preventing silent payload mismatches.

### Channel Name Constants

```typescript
export const BusChannel = {
  RUN_STARTED:          "pancode:run-started",
  RUN_FINISHED:         "pancode:run-finished",
  WORKER_PROGRESS:      "pancode:worker-progress",
  WORKER_HEARTBEAT:     "pancode:worker-heartbeat",
  WORKER_HEALTH_CHANGED:"pancode:worker-health-changed",
  SHUTDOWN_DRAINING:    "pancode:shutdown-draining",
  WARNING:              "pancode:warning",
  SESSION_RESET:        "pancode:session-reset",
  COMPACTION_STARTED:   "pancode:compaction-started",
  EXTENSIONS_RELOADED:  "pancode:extensions-reloaded",
  BUDGET_UPDATED:       "pancode:budget-updated",
  RUNTIMES_DISCOVERED:  "pancode:runtimes-discovered",
  PROMPT_COMPILED:      "pancode:prompt-compiled",
  CONFIG_CHANGED:       "pancode:config-changed",
} as const;
```

### Payload Types

Each channel has a corresponding TypeScript interface:

| Channel | Payload Type | Description |
|---------|-------------|-------------|
| `RUN_STARTED` | `RunStartedEvent` | Run ID, task, agent, model, runtime |
| `RUN_FINISHED` | `RunFinishedEvent` | Run ID, agent, status, usage (cost, tokens), timestamps |
| `WORKER_PROGRESS` | `WorkerProgressEvent` | Token counts, turns, current tool, recent tools |
| `WORKER_HEARTBEAT` | `WorkerHeartbeatEvent` | Run ID, timestamp, turns, last tool, token delta |
| `WORKER_HEALTH_CHANGED` | `WorkerHealthChangedEvent` | Run ID, previous state, current state |
| `SHUTDOWN_DRAINING` | `Record<string, never>` | Empty payload (signal only) |
| `WARNING` | `WarningEvent` | Source identifier, warning message |
| `SESSION_RESET` | `Record<string, never>` | Empty payload (signal only) |
| `COMPACTION_STARTED` | `CompactionStartedEvent` | Custom instructions text |
| `BUDGET_UPDATED` | `BudgetUpdatedEvent` | Total cost, ceiling, run count, token totals |
| `PROMPT_COMPILED` | `PromptCompiledEvent` | Role, tier, mode, estimated tokens, fragment count, hash |
| `CONFIG_CHANGED` | `ConfigChangedEvent` | Key, previous value, new value |

### Health State Classification

Worker health is classified into four states:

```typescript
export type HealthState = "healthy" | "stale" | "dead" | "recovered";
```

- **healthy**: heartbeats arriving within expected intervals
- **stale**: heartbeat delayed beyond threshold
- **dead**: no heartbeat for extended period
- **recovered**: previously stale/dead worker that resumed heartbeats

## Subscription Patterns

Domains subscribe to bus events in their `session_start` hook:

```typescript
// From observability/extension.ts (pattern)
pi.on(PiEvent.SESSION_START, (_event, _ctx) => {
  sharedBus.on(BusChannel.RUN_FINISHED, (payload) => {
    const event = payload as RunFinishedEvent;
    metricsLedger.record(event);
  });
});
```

The unsubscribe function returned by `sharedBus.on()` can be stored for cleanup
during shutdown, though most subscriptions are session-scoped and cleared when
the bus is cleared.

## Emission Patterns

Domains emit events when their state changes:

```typescript
// From dispatch (simplified pattern)
sharedBus.emit(BusChannel.RUN_STARTED, {
  runId: run.id,
  task: run.task,
  agent: run.agent,
  model: run.model,
} satisfies RunStartedEvent);
```

Using `satisfies` ensures the payload matches the expected type at compile time.

## Event Flow Example

When the orchestrator dispatches a worker and the worker completes:

```
dispatch emits RUN_STARTED
  ├─ ui updates worker display
  └─ observability starts tracking

(worker running, emitting progress via stdout)

dispatch emits WORKER_PROGRESS (forwarded from worker stdout)
  └─ ui updates live progress indicator

dispatch emits RUN_FINISHED
  ├─ observability records metrics, updates ledger
  ├─ scheduling adjusts budget counters, emits BUDGET_UPDATED
  │     └─ ui updates budget display
  └─ ui updates worker display (completed/errored)
```

## Rules

1. **No direct cross-domain mutation.** Domains communicate state changes
   exclusively through bus events.
2. **One owner per state.** The domain that owns a piece of state is the only
   one that emits events about it.
3. **Subscribe in session_start.** All subscriptions are registered during
   session initialization.
4. **Type payloads in bus-events.ts.** Never use raw string literals for channel
   names or inline type assertions for payloads.

## Cross-References

- [Domains](./domains.md): which domains emit and subscribe to which events
- [Architecture Overview](./overview.md): where the event system fits
- [Safety](../guides/safety.md): how safety events flow
- [Observability](../guides/observability.md): how metrics are collected from events
