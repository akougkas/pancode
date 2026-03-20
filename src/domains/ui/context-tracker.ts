/**
 * Orchestrator context window tracking.
 *
 * Module-level state that records context fill percentage from the Pi SDK's
 * getContextUsage() API. The footer render function reads getContextPercent()
 * on each repaint to show a live context bar.
 *
 * Two update paths exist:
 * 1. recordContextFromSdk(): called from the message_end handler using
 *    ctx.getContextUsage() which returns { tokens, contextWindow, percent }.
 *    This is the authoritative source when available.
 * 2. recordContextUsage(): fallback that accepts raw input tokens and model
 *    context window. Used when the SDK's getContextUsage() returns undefined.
 */

// ---------------------------------------------------------------------------
// Module-level state
// ---------------------------------------------------------------------------

let contextPercent = 0;
let contextTokens = 0;
let contextWindow = 0;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Record context usage from the Pi SDK's getContextUsage() API.
 * This is the preferred path since the SDK computes the estimate internally.
 */
export function recordContextFromSdk(usage: {
  tokens: number | null;
  contextWindow: number;
  percent: number | null;
}): void {
  if (usage.percent !== null) {
    contextPercent = Math.min(100, Math.round(usage.percent));
  }
  if (usage.tokens !== null) {
    contextTokens = usage.tokens;
  }
  if (usage.contextWindow > 0) {
    contextWindow = usage.contextWindow;
  }
}

/**
 * Record the latest orchestrator input token count and model context window.
 * Fallback path when ctx.getContextUsage() is not available.
 */
export function recordContextUsage(inputTokens: number, modelContextWindow: number): void {
  contextTokens = inputTokens;
  if (modelContextWindow > 0) {
    contextWindow = modelContextWindow;
  }
  if (contextWindow > 0) {
    contextPercent = Math.min(100, Math.round((contextTokens / contextWindow) * 100));
  }
}

/**
 * Get the current context fill percentage (0-100).
 * Returns 0 if context usage is unknown.
 */
export function getContextPercent(): number {
  return contextPercent;
}

/**
 * Reset token counter. Context window is preserved because the model
 * does not change when a session resets.
 */
export function resetContextTracker(): void {
  contextTokens = 0;
  contextPercent = 0;
}
