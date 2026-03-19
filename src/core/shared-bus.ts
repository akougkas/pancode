import { createSafeEventBus, type SafeEventBus } from "./event-bus";

/**
 * Shared event bus for cross-domain events.
 *
 * Dispatch emits:
 *   pancode:run-started       { runId, task, agent, model }
 *   pancode:run-finished      { runId, agent, status, usage, startedAt, completedAt }
 *   pancode:worker-progress   { runId, inputTokens, outputTokens, turns }
 *   pancode:shutdown-draining {}
 *   pancode:warning           { source, message }
 *
 * Observability, scheduling, and ui subscribe to these channels.
 * Using a singleton avoids the need to pass the bus through Pi extension contexts.
 */
export const sharedBus: SafeEventBus = createSafeEventBus();
