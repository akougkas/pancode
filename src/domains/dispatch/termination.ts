/**
 * Advanced dispatch termination controls.
 *
 * Infrastructure-level constraints that mechanically enforce dispatch
 * time and resource limits. These are not prompt-level guidance;
 * the dispatch system enforces them structurally.
 *
 * Controls:
 *   maxTurns      - count agent conversation turns, kill at limit
 *   maxDuration   - wall-clock timer, kill at expiry
 *   budgetTokens  - accumulated input+output tokens, kill at limit
 *   stopOnText    - scan worker output for stop phrases, terminate gracefully
 */

export interface TerminationConfig {
  /** Maximum conversation turns before forced termination. */
  maxTurns: number;
  /** Maximum wall-clock time in milliseconds (0 = no limit). */
  maxDurationMs: number;
  /** Maximum total tokens (input + output) before termination (0 = no limit). */
  budgetTokens: number;
  /** Stop phrases in worker output that trigger graceful termination. */
  stopOnText: string[];
}

export interface TerminationState {
  turns: number;
  startedAt: number;
  totalTokens: number;
  terminated: boolean;
  reason: string | null;
}

/** Default termination config: generous limits. */
export const DEFAULT_TERMINATION: TerminationConfig = {
  maxTurns: 50,
  maxDurationMs: 0,
  budgetTokens: 0,
  stopOnText: [],
};

/**
 * Create a new termination state tracker.
 */
export function createTerminationState(): TerminationState {
  return {
    turns: 0,
    startedAt: Date.now(),
    totalTokens: 0,
    terminated: false,
    reason: null,
  };
}

/**
 * Check whether any termination condition is met.
 * Updates the state and returns true if the worker should be terminated.
 */
export function shouldTerminate(config: TerminationConfig, state: TerminationState, outputText?: string): boolean {
  if (state.terminated) return true;

  // Turn limit
  if (config.maxTurns > 0 && state.turns >= config.maxTurns) {
    state.terminated = true;
    state.reason = `Turn limit reached (${state.turns}/${config.maxTurns})`;
    return true;
  }

  // Wall-clock duration
  if (config.maxDurationMs > 0) {
    const elapsed = Date.now() - state.startedAt;
    if (elapsed >= config.maxDurationMs) {
      state.terminated = true;
      state.reason = `Duration limit reached (${elapsed}ms/${config.maxDurationMs}ms)`;
      return true;
    }
  }

  // Token budget
  if (config.budgetTokens > 0 && state.totalTokens >= config.budgetTokens) {
    state.terminated = true;
    state.reason = `Token budget exhausted (${state.totalTokens}/${config.budgetTokens})`;
    return true;
  }

  // Stop-on-text phrases
  if (outputText && config.stopOnText.length > 0) {
    for (const phrase of config.stopOnText) {
      if (outputText.includes(phrase)) {
        state.terminated = true;
        state.reason = `Stop phrase detected: "${phrase}"`;
        return true;
      }
    }
  }

  return false;
}

/**
 * Record a turn update (called on each message_end from the worker).
 */
export function recordTurn(state: TerminationState, inputTokens: number, outputTokens: number): void {
  state.turns++;
  state.totalTokens += inputTokens + outputTokens;
}

/**
 * Parse termination config from a YAML agent entry.
 */
export function parseTerminationConfig(entry: {
  termination?: {
    max_turns?: number;
    max_duration_ms?: number;
    budget_tokens?: number;
    stop_on_text?: string[];
  };
}): TerminationConfig {
  if (!entry.termination) return { ...DEFAULT_TERMINATION };

  return {
    maxTurns: entry.termination.max_turns ?? DEFAULT_TERMINATION.maxTurns,
    maxDurationMs: entry.termination.max_duration_ms ?? DEFAULT_TERMINATION.maxDurationMs,
    budgetTokens: entry.termination.budget_tokens ?? DEFAULT_TERMINATION.budgetTokens,
    stopOnText: Array.isArray(entry.termination.stop_on_text)
      ? entry.termination.stop_on_text
      : DEFAULT_TERMINATION.stopOnText,
  };
}
