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
  });
}

export function updateWorkerProgress(runId: string, inputTokens: number, outputTokens: number, turns: number): void {
  const worker = liveWorkers.get(runId);
  if (worker) {
    worker.inputTokens = inputTokens;
    worker.outputTokens = outputTokens;
    worker.turns = turns;
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
