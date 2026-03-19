/**
 * Orchestrator context window tracking.
 *
 * Module-level state that records cumulative input token usage from the
 * orchestrator's own message lifecycle events. The footer render function
 * reads getContextPercent() on each repaint to show a live context bar.
 *
 * The orchestrator's Pi coding agent fires "message_end" events after each
 * assistant turn. Each event's usage.input reflects the cumulative input
 * tokens for that turn (prompt + conversation history). We store the latest
 * value and divide by the model's contextWindow to produce a fill percentage.
 */

// ---------------------------------------------------------------------------
// Module-level state
// ---------------------------------------------------------------------------

let contextTokens = 0;
let contextWindow = 0;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Record the latest orchestrator input token count and model context window.
 * Called from the UI extension's "message_end" handler.
 */
export function recordContextUsage(inputTokens: number, modelContextWindow: number): void {
  contextTokens = inputTokens;
  if (modelContextWindow > 0) {
    contextWindow = modelContextWindow;
  }
}

/**
 * Get the current context fill percentage (0-100).
 * Returns 0 if the model's context window is unknown.
 */
export function getContextPercent(): number {
  if (contextWindow <= 0) return 0;
  return Math.min(100, Math.round((contextTokens / contextWindow) * 100));
}

/**
 * Reset token counter. Context window is preserved because the model
 * does not change when a session resets.
 */
export function resetContextTracker(): void {
  contextTokens = 0;
}
