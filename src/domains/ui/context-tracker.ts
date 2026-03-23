/**
 * Orchestrator context window tracking with per-category breakdown.
 *
 * Module-level state that records context fill percentage from the Pi SDK's
 * getContextUsage() API. The footer render function reads getContextPercent()
 * on each repaint to show a live context bar.
 *
 * Two update paths for total context:
 * 1. recordContextFromSdk(): called from the message_end handler using
 *    ctx.getContextUsage() which returns { tokens, contextWindow, percent }.
 *    This is the authoritative source when available.
 * 2. recordContextUsage(): fallback that accepts raw input tokens and model
 *    context window. Used when the SDK's getContextUsage() returns undefined.
 *
 * Per-category tracking approximates what fills the context window:
 * system prompt, tool definitions, scout results, dispatch results,
 * orchestrator (panos) output, and user input. Fixed categories (system,
 * tools) store absolute estimates. Conversation categories (scout, dispatch,
 * panos, user) accumulate deltas and are proportionally mapped to the
 * remaining context space.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ContextCategory = "system" | "tools" | "scout" | "dispatch" | "panos" | "user";

export interface CategoryBreakdown {
  category: ContextCategory;
  tokens: number;
  percent: number;
}

// ---------------------------------------------------------------------------
// Module-level state
// ---------------------------------------------------------------------------

let contextPercent = 0;
let contextTokens = 0;
let contextWindow = 0;

const CATEGORY_ORDER: ContextCategory[] = ["system", "tools", "scout", "dispatch", "panos", "user"];

/** Absolute token estimates for fixed categories, cumulative counters for conversation categories. */
const categoryEstimates: Record<ContextCategory, number> = {
  system: 0,
  tools: 0,
  scout: 0,
  dispatch: 0,
  panos: 0,
  user: 0,
};

// ---------------------------------------------------------------------------
// Public API: total context tracking
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

/** Get the current absolute token count within the context window. */
export function getContextTokens(): number {
  return contextTokens;
}

/** Get the model's total context window size in tokens. */
export function getContextWindow(): number {
  return contextWindow;
}

// ---------------------------------------------------------------------------
// Public API: per-category tracking
// ---------------------------------------------------------------------------

/**
 * Set the absolute token estimate for a category.
 * Used for fixed categories (system, tools) that are known at specific points
 * such as prompt compilation or setActiveTools.
 */
export function recordCategoryTokens(category: ContextCategory, tokens: number): void {
  categoryEstimates[category] = Math.max(0, tokens);
}

/**
 * Add tokens to a category's cumulative counter.
 * Used for conversation categories (panos, dispatch, scout, user) that
 * accumulate across message_end events and run completions.
 */
export function addCategoryTokens(category: ContextCategory, delta: number): void {
  if (delta > 0) {
    categoryEstimates[category] += delta;
  }
}

/**
 * Get the per-category context breakdown.
 *
 * Fixed categories (system, tools) contribute their absolute estimates.
 * Conversation categories (scout, dispatch, panos, user) share the remaining
 * context proportionally based on their cumulative counters. If no conversation
 * tracking data exists, the entire conversation portion is attributed to "user".
 *
 * Returns an empty array when the context window is unknown.
 */
export function getCategoryBreakdown(): CategoryBreakdown[] {
  if (contextWindow <= 0) return [];

  // Fixed categories are absolute estimates clamped to context tokens.
  const systemEst = Math.min(categoryEstimates.system, contextTokens);
  const toolsEst = Math.min(categoryEstimates.tools, Math.max(0, contextTokens - systemEst));
  const fixedTotal = systemEst + toolsEst;

  // Conversation portion is the remainder after fixed categories.
  const conversationTotal = Math.max(0, contextTokens - fixedTotal);

  // Sum of all conversation category counters for proportional distribution.
  const conversationCounters =
    categoryEstimates.panos + categoryEstimates.scout + categoryEstimates.dispatch + categoryEstimates.user;

  const result: CategoryBreakdown[] = [];

  for (const cat of CATEGORY_ORDER) {
    let tokens: number;

    if (cat === "system") {
      tokens = systemEst;
    } else if (cat === "tools") {
      tokens = toolsEst;
    } else if (conversationCounters > 0) {
      // Distribute conversation proportionally by cumulative counters.
      tokens = Math.round((categoryEstimates[cat] / conversationCounters) * conversationTotal);
    } else if (cat === "user" && conversationTotal > 0) {
      // No tracking data yet; attribute all conversation to user.
      tokens = conversationTotal;
    } else {
      tokens = 0;
    }

    result.push({
      category: cat,
      tokens,
      percent: contextWindow > 0 ? Math.round((tokens / contextWindow) * 100) : 0,
    });
  }

  return result;
}

// ---------------------------------------------------------------------------
// Reset
// ---------------------------------------------------------------------------

/**
 * Reset token counters and category estimates. Context window is preserved
 * because the model does not change when a session resets.
 */
export function resetContextTracker(): void {
  contextTokens = 0;
  contextPercent = 0;
  for (const cat of CATEGORY_ORDER) {
    categoryEstimates[cat] = 0;
  }
}
