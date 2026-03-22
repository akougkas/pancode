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
  SHUTDOWN_DRAINING: "pancode:shutdown-draining",
  WARNING: "pancode:warning",
  SESSION_RESET: "pancode:session-reset",
  COMPACTION_STARTED: "pancode:compaction-started",
  EXTENSIONS_RELOADED: "pancode:extensions-reloaded",
  BUDGET_UPDATED: "pancode:budget-updated",
  RUNTIMES_DISCOVERED: "pancode:runtimes-discovered",
  PROMPT_COMPILED: "pancode:prompt-compiled",
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
    cost: number;
    turns: number;
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
    cacheWriteTokens: number;
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

// Convenience: map channel names to their payload types for documentation.
// Not enforced at runtime (the bus is stringly typed), but enables grep-based
// auditing of which channel carries which shape.
export interface BusEventMap {
  [BusChannel.RUN_STARTED]: RunStartedEvent;
  [BusChannel.RUN_FINISHED]: RunFinishedEvent;
  [BusChannel.WORKER_PROGRESS]: WorkerProgressEvent;
  [BusChannel.SHUTDOWN_DRAINING]: Record<string, never>;
  [BusChannel.WARNING]: WarningEvent;
  [BusChannel.SESSION_RESET]: Record<string, never>;
  [BusChannel.COMPACTION_STARTED]: CompactionStartedEvent;
  [BusChannel.EXTENSIONS_RELOADED]: Record<string, never>;
  [BusChannel.BUDGET_UPDATED]: BudgetUpdatedEvent;
  [BusChannel.RUNTIMES_DISCOVERED]: unknown;
  [BusChannel.PROMPT_COMPILED]: PromptCompiledEvent;
}
