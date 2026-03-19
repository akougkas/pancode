/**
 * Per-provider rate limiting and exponential backoff.
 *
 * Tracks consecutive failures per provider and enforces exponential
 * wait times. Supports explicit 429 signals with retry-after headers.
 * Circuit breaker: 3 consecutive failures triggers automatic backoff.
 */

const BASE_DELAY_MS = 2000;
const MAX_DELAY_MS = 60000;
const CIRCUIT_BREAKER_THRESHOLD = 3;
const DEFAULT_429_DELAY_MS = 30000;

export interface BackoffState {
  provider: string;
  consecutiveFailures: number;
  backedOffUntil: number | null;
  lastFailureAt: number | null;
}

export interface BackoffManager {
  signal429(provider: string, retryAfterMs?: number): void;
  signalFailure(provider: string): void;
  signalSuccess(provider: string): void;
  isBackedOff(provider: string): boolean;
  getWaitMs(provider: string): number;
  getState(provider: string): BackoffState;
  getAllStates(): BackoffState[];
}

function computeDelay(consecutiveFailures: number): number {
  const exponential = BASE_DELAY_MS * 2 ** (consecutiveFailures - 1);
  const capped = Math.min(exponential, MAX_DELAY_MS);
  // Add 0-25% jitter to avoid thundering herd
  const jitter = capped * Math.random() * 0.25;
  return Math.round(capped + jitter);
}

export function createBackoffManager(): BackoffManager {
  const states = new Map<string, BackoffState>();

  function getOrCreate(provider: string): BackoffState {
    let state = states.get(provider);
    if (!state) {
      state = { provider, consecutiveFailures: 0, backedOffUntil: null, lastFailureAt: null };
      states.set(provider, state);
    }
    return state;
  }

  return {
    signal429(provider: string, retryAfterMs?: number): void {
      const state = getOrCreate(provider);
      const delay = retryAfterMs ?? DEFAULT_429_DELAY_MS;
      state.backedOffUntil = Date.now() + delay;
      state.lastFailureAt = Date.now();
      state.consecutiveFailures++;
    },

    signalFailure(provider: string): void {
      const state = getOrCreate(provider);
      state.consecutiveFailures++;
      state.lastFailureAt = Date.now();
      if (state.consecutiveFailures >= CIRCUIT_BREAKER_THRESHOLD) {
        const delay = computeDelay(state.consecutiveFailures);
        state.backedOffUntil = Date.now() + delay;
      }
    },

    signalSuccess(provider: string): void {
      const state = getOrCreate(provider);
      state.consecutiveFailures = 0;
      state.backedOffUntil = null;
    },

    isBackedOff(provider: string): boolean {
      const state = states.get(provider);
      if (!state || state.backedOffUntil === null) return false;
      return state.backedOffUntil > Date.now();
    },

    getWaitMs(provider: string): number {
      const state = states.get(provider);
      if (!state || state.backedOffUntil === null) return 0;
      return Math.max(0, state.backedOffUntil - Date.now());
    },

    getState(provider: string): BackoffState {
      return getOrCreate(provider);
    },

    getAllStates(): BackoffState[] {
      return [...states.values()];
    },
  };
}
