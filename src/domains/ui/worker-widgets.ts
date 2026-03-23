/**
 * Per-worker live state tracking for the dispatch board widget.
 *
 * Module-level state tracks active workers. Extension.ts subscribes to
 * sharedBus events and calls trackWorkerStart/trackWorkerEnd. The dispatch
 * board widget reads live worker state via getLiveWorkers() on each render.
 *
 * No timers. Elapsed time is computed live in the render function from
 * startedAt timestamps. Pi TUI repaints on user input and event activity,
 * which is sufficient for v1.0. Smooth per-second elapsed time updates
 * require Pi TUI Container-based invalidation (future work).
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type WorkerStatus = "pending" | "running" | "done" | "error" | "cancelled" | "timeout" | "interrupted";

/** Health state classification from heartbeat monitoring. */
export type { HealthState } from "../../core/bus-events";

export interface LiveWorkerState {
  runId: string;
  agent: string;
  task: string;
  model: string | null;
  status: WorkerStatus;
  startedAt: number;
  inputTokens: number;
  outputTokens: number;
  turns: number;
  runtime?: string; // Runtime ID for display badge
  currentTool: string | null; // Tool currently executing
  currentToolArgs: string | null; // Truncated preview of current tool args
  recentTools: string[]; // Ring buffer of recently completed tools (max 5)
  toolCount: number; // Total tool calls observed
  healthState: "healthy" | "stale" | "dead" | "recovered" | null; // Heartbeat health classification
}

// ---------------------------------------------------------------------------
// Module-level state
// ---------------------------------------------------------------------------

const liveWorkers = new Map<string, LiveWorkerState>();
const pendingCleanups = new Set<string>();

// ---------------------------------------------------------------------------
// State management
// ---------------------------------------------------------------------------

export function trackWorkerStart(
  runId: string,
  agent: string,
  task: string,
  model: string | null,
  runtime?: string,
): void {
  pendingCleanups.delete(runId);
  liveWorkers.set(runId, {
    runId,
    agent,
    task,
    model,
    status: "running",
    startedAt: Date.now(),
    inputTokens: 0,
    outputTokens: 0,
    turns: 0,
    runtime,
    currentTool: null,
    currentToolArgs: null,
    recentTools: [],
    toolCount: 0,
    healthState: null,
  });
}

export function updateWorkerProgress(
  runId: string,
  inputTokens: number,
  outputTokens: number,
  turns: number,
  currentTool?: string | null,
  currentToolArgs?: string | null,
  recentTools?: string[],
  toolCount?: number,
): void {
  const worker = liveWorkers.get(runId);
  if (worker) {
    worker.inputTokens = inputTokens;
    worker.outputTokens = outputTokens;
    worker.turns = turns;
    if (currentTool !== undefined) worker.currentTool = currentTool;
    if (currentToolArgs !== undefined) worker.currentToolArgs = currentToolArgs;
    if (recentTools !== undefined) worker.recentTools = recentTools;
    if (toolCount !== undefined) worker.toolCount = toolCount;
  }
}

export function updateWorkerHealth(runId: string, healthState: "healthy" | "stale" | "dead" | "recovered"): void {
  const worker = liveWorkers.get(runId);
  if (worker) {
    worker.healthState = healthState;
  }
}

export function trackWorkerEnd(runId: string, status: WorkerStatus): void {
  const worker = liveWorkers.get(runId);
  if (worker) worker.status = status;
  // Guard against duplicate cleanup from rapid events.
  if (pendingCleanups.has(runId)) return;
  pendingCleanups.add(runId);
  // Remove after 5 seconds so the card lingers briefly before fading to recent.
  setTimeout(() => {
    liveWorkers.delete(runId);
    pendingCleanups.delete(runId);
  }, 5000);
}

export function getLiveWorkers(): LiveWorkerState[] {
  return [...liveWorkers.values()];
}

/**
 * Clear all live worker state. Called on widget dispose or session shutdown.
 */
export function resetAll(): void {
  liveWorkers.clear();
  pendingCleanups.clear();
}
