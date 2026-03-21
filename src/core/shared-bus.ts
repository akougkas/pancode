import { type SafeEventBus, createSafeEventBus } from "./event-bus";

/**
 * Shared event bus for cross-domain events.
 *
 * Channel names and payload types are defined in ./bus-events.ts (BusChannel,
 * RunStartedEvent, RunFinishedEvent, etc.). All domains import from there
 * instead of using raw string literals.
 *
 * Observability, scheduling, and ui subscribe to these channels.
 * Using a singleton avoids the need to pass the bus through Pi extension contexts.
 */
export const sharedBus: SafeEventBus = createSafeEventBus();
