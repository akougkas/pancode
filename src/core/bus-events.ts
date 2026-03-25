/**
 * Canonical SharedBus event channel names and payload types.
 *
 * Every domain that emits or subscribes to cross-domain events imports from
 * this file. Inline type assertions (payload as { ... }) are replaced with
 * these shared interfaces. A shape change breaks at compile time everywhere.
 */

// ---------------------------------------------------------------------------
// Channel name constants
// ---------------------------------------------------------------------------

export const BusChannel = {
  RUN_STARTED: "pancode:run-started",
  RUN_FINISHED: "pancode:run-finished",
  WORKER_PROGRESS: "pancode:worker-progress",
  WORKER_HEARTBEAT: "pancode:worker-heartbeat",
  WORKER_HEALTH_CHANGED: "pancode:worker-health-changed",
  SHUTDOWN_DRAINING: "pancode:shutdown-draining",
  WARNING: "pancode:warning",
  SESSION_RESET: "pancode:session-reset",
  COMPACTION_STARTED: "pancode:compaction-started",
  EXTENSIONS_RELOADED: "pancode:extensions-reloaded",
  BUDGET_UPDATED: "pancode:budget-updated",
  RUNTIMES_DISCOVERED: "pancode:runtimes-discovered",
  PROMPT_COMPILED: "pancode:prompt-compiled",
  CONFIG_CHANGED: "pancode:config-changed",
} as const;

export type BusChannelName = (typeof BusChannel)[keyof typeof BusChannel];

// ---------------------------------------------------------------------------
// Payload interfaces
// ---------------------------------------------------------------------------

export interface RunStartedEvent {
  runId: string;
  task: string;
  agent: string;
  model: string | null;
  runtime?: string;
}

export interface RunFinishedEvent {
  runId: string;
  agent: string;
  status: string;
  usage: {
    cost: number | null;
    turns: number | null;
    inputTokens: number | null;
    outputTokens: number | null;
    cacheReadTokens: number | null;
    cacheWriteTokens: number | null;
  };
  runtime?: string;
  startedAt: string;
  completedAt: string;
}

export interface WorkerProgressEvent {
  runId: string;
  inputTokens: number;
  outputTokens: number;
  turns: number;
  /** Name of the tool currently executing (null when between tool calls). */
  currentTool: string | null;
  /** Preview of the current tool's arguments (truncated). */
  currentToolArgs: string | null;
  /** Ring buffer of recently completed tool names (max 5, newest last). */
  recentTools: string[];
  /** Total tool calls observed so far. */
  toolCount: number;
  // SDK extensions (optional, only set by SDK runtimes)
  /** Cache read tokens reported by SDK runtimes. */
  cacheReadTokens?: number;
  /** Cache write tokens reported by SDK runtimes. */
  cacheWriteTokens?: number;
  /** Accumulated cost reported by SDK runtimes. */
  cost?: number;
  /** Whether the model is actively using extended thinking. */
  thinkingActive?: boolean;
  /** Whether the SDK stream is actively producing events. */
  streamActive?: boolean;
  /** Incremental text output from the SDK stream. */
  textDelta?: string;
}

export interface WarningEvent {
  source: string;
  message: string;
}

export interface BudgetUpdatedEvent {
  totalCost: number;
  ceiling: number;
  runsCount: number;
  totalInputTokens: number;
  totalOutputTokens: number;
}

export interface CompactionStartedEvent {
  customInstructions: string | null;
}

export interface PromptCompiledEvent {
  role: "orchestrator" | "worker" | "scout";
  tier: string;
  mode: string;
  estimatedTokens: number;
  fragmentCount: number;
  hash: string;
}

export interface WorkerHeartbeatEvent {
  runId: string;
  ts: string;
  turns: number;
  lastToolCall: string | null;
  tokensThisBeat: { in: number; out: number };
}

/** Health state classification for worker heartbeat monitoring. */
export type HealthState = "healthy" | "stale" | "dead" | "recovered";

export interface WorkerHealthChangedEvent {
  runId: string;
  previousState: HealthState;
  currentState: HealthState;
}

export interface ConfigChangedEvent {
  key: string;
  previousValue: unknown;
  newValue: unknown;
}

// Convenience: map channel names to their payload types for documentation.
// Not enforced at runtime (the bus is stringly typed), but enables grep-based
// auditing of which channel carries which shape.
export interface BusEventMap {
  [BusChannel.RUN_STARTED]: RunStartedEvent;
  [BusChannel.RUN_FINISHED]: RunFinishedEvent;
  [BusChannel.WORKER_PROGRESS]: WorkerProgressEvent;
  [BusChannel.WORKER_HEARTBEAT]: WorkerHeartbeatEvent;
  [BusChannel.WORKER_HEALTH_CHANGED]: WorkerHealthChangedEvent;
  [BusChannel.SHUTDOWN_DRAINING]: Record<string, never>;
  [BusChannel.WARNING]: WarningEvent;
  [BusChannel.SESSION_RESET]: Record<string, never>;
  [BusChannel.COMPACTION_STARTED]: CompactionStartedEvent;
  [BusChannel.EXTENSIONS_RELOADED]: Record<string, never>;
  [BusChannel.BUDGET_UPDATED]: BudgetUpdatedEvent;
  [BusChannel.RUNTIMES_DISCOVERED]: unknown;
  [BusChannel.PROMPT_COMPILED]: PromptCompiledEvent;
  [BusChannel.CONFIG_CHANGED]: ConfigChangedEvent;
}

// ---------------------------------------------------------------------------
// Typed bus helpers
// ---------------------------------------------------------------------------
// The underlying SafeEventBus accepts plain strings and unknown payloads.
// These wrappers provide compile-time type checking for channel/payload
// pairs, preventing typos in channel names and payload shape mismatches.
// New code should prefer these over raw sharedBus.emit/on calls.

import type { SafeEventBus } from "./event-bus";

/** Type-safe emit: the payload must match BusEventMap[channel]. */
export function typedEmit<K extends keyof BusEventMap>(bus: SafeEventBus, channel: K, payload: BusEventMap[K]): void {
  bus.emit(channel, payload);
}

/** Type-safe subscribe: the listener receives the correctly typed payload. */
export function typedOn<K extends keyof BusEventMap>(
  bus: SafeEventBus,
  channel: K,
  listener: (payload: BusEventMap[K]) => void | Promise<void>,
): () => void {
  return bus.on(channel, listener as (payload: unknown) => void | Promise<void>);
}
