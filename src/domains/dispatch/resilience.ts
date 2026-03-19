/**
 * Circuit breaker for provider health tracking.
 *
 * Sliding window of last 10 attempts per provider. Computes health status
 * from success rate: healthy (>=70%), degraded (30-70%), unhealthy (<30%).
 */

const WINDOW_SIZE = 10;

export interface ProviderHealth {
  provider: string;
  status: "healthy" | "degraded" | "unhealthy";
  lastSuccessAt: number | null;
  lastFailureAt: number | null;
  successRate: number;
}

export interface ResilienceTracker {
  recordSuccess(provider: string): void;
  recordFailure(provider: string, reason: string): void;
  getHealth(provider: string): ProviderHealth;
  getAllHealth(): ProviderHealth[];
  isHealthy(provider: string): boolean;
  getBestProvider(candidates: string[]): string | null;
}

interface ProviderWindow {
  provider: string;
  attempts: boolean[];
  lastSuccessAt: number | null;
  lastFailureAt: number | null;
}

function computeStatus(successRate: number): "healthy" | "degraded" | "unhealthy" {
  if (successRate >= 0.7) return "healthy";
  if (successRate >= 0.3) return "degraded";
  return "unhealthy";
}

export function createResilienceTracker(): ResilienceTracker {
  const windows = new Map<string, ProviderWindow>();

  function getOrCreate(provider: string): ProviderWindow {
    let win = windows.get(provider);
    if (!win) {
      win = { provider, attempts: [], lastSuccessAt: null, lastFailureAt: null };
      windows.set(provider, win);
    }
    return win;
  }

  function pushAttempt(win: ProviderWindow, success: boolean): void {
    win.attempts.push(success);
    if (win.attempts.length > WINDOW_SIZE) {
      win.attempts.shift();
    }
  }

  function toHealth(win: ProviderWindow): ProviderHealth {
    const successes = win.attempts.filter(Boolean).length;
    const total = win.attempts.length;
    const successRate = total > 0 ? successes / total : 1;
    return {
      provider: win.provider,
      status: computeStatus(successRate),
      lastSuccessAt: win.lastSuccessAt,
      lastFailureAt: win.lastFailureAt,
      successRate: Math.round(successRate * 100) / 100,
    };
  }

  return {
    recordSuccess(provider: string): void {
      const win = getOrCreate(provider);
      pushAttempt(win, true);
      win.lastSuccessAt = Date.now();
    },

    recordFailure(provider: string, _reason: string): void {
      const win = getOrCreate(provider);
      pushAttempt(win, false);
      win.lastFailureAt = Date.now();
    },

    getHealth(provider: string): ProviderHealth {
      return toHealth(getOrCreate(provider));
    },

    getAllHealth(): ProviderHealth[] {
      return [...windows.values()].map(toHealth);
    },

    isHealthy(provider: string): boolean {
      const health = toHealth(getOrCreate(provider));
      return health.status !== "unhealthy";
    },

    getBestProvider(candidates: string[]): string | null {
      if (candidates.length === 0) return null;
      let best: string | null = null;
      let bestRate = -1;
      for (const provider of candidates) {
        const health = toHealth(getOrCreate(provider));
        if (health.successRate > bestRate) {
          bestRate = health.successRate;
          best = provider;
        }
      }
      return best;
    },
  };
}
