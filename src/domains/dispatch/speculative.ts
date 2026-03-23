/**
 * Speculative dispatch: hedge a task across multiple runtimes or models.
 *
 * Dispatches the same task to N workers simultaneously. Takes the first
 * good result and cancels the rest. Trades compute cost for latency
 * and reliability.
 *
 * Use cases:
 * 1. Latency hedging: local model (fast) vs cloud model (capable)
 * 2. Reliability hedging: two different providers
 * 3. Quality racing: frontier vs mid-tier, use the better result
 */

export interface SpeculativeReplica {
  agent: string;
  runtime: string;
  model?: string;
}

export type SpeculativeStrategy = "first-success" | "best-of-n";

export interface SpeculativeConfig {
  replicas: SpeculativeReplica[];
  strategy: SpeculativeStrategy;
}

export interface SpeculativeResult {
  /** The winning replica's index in the replicas array. */
  winnerIndex: number;
  /** The winning replica's result text. */
  result: string;
  /** Whether other replicas were cancelled. */
  cancelledCount: number;
  /** Wall time of the winning replica in milliseconds. */
  winnerDurationMs: number;
  /** Wall times of all replicas (including cancelled ones). */
  allDurationsMs: number[];
}

/**
 * Parse speculative dispatch config from tool arguments.
 * Returns null if no speculative configuration is present.
 */
export function parseSpeculativeConfig(args: {
  speculative?: boolean;
  replicas?: Array<{ agent?: string; runtime?: string; model?: string }>;
  strategy?: string;
}): SpeculativeConfig | null {
  if (!args.speculative || !args.replicas || args.replicas.length < 2) {
    return null;
  }

  const replicas: SpeculativeReplica[] = args.replicas.map((r) => ({
    agent: r.agent ?? "dev",
    runtime: r.runtime ?? "pi",
    model: r.model,
  }));

  const strategy: SpeculativeStrategy = args.strategy === "best-of-n" ? "best-of-n" : "first-success";

  return { replicas, strategy };
}

/**
 * Determine the winner among completed results based on strategy.
 *
 * For "first-success": returns the index of the first successful result.
 * For "best-of-n": returns the index of the longest (most detailed) result.
 *
 * Returns -1 if no result qualifies.
 */
export function selectWinner(
  results: Array<{ exitCode: number; result: string; durationMs: number } | null>,
  strategy: SpeculativeStrategy,
): number {
  if (strategy === "first-success") {
    for (let i = 0; i < results.length; i++) {
      const r = results[i];
      if (r && r.exitCode === 0 && r.result.trim().length > 0) {
        return i;
      }
    }
    return -1;
  }

  // best-of-n: pick the result with the most content
  let bestIndex = -1;
  let bestLength = 0;

  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    if (r && r.exitCode === 0 && r.result.trim().length > bestLength) {
      bestLength = r.result.trim().length;
      bestIndex = i;
    }
  }

  return bestIndex;
}
