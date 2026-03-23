/**
 * Adaptive learning from dispatch outcomes.
 *
 * Tracks which dispatch plans succeeded and computes outcome statistics
 * per (task_category, agent) pair. After N outcomes, the learner
 * provides routing suggestions that the solver can use instead of
 * the static AGENT_MAP.
 */

import type { DispatchOutcome, Intent, OutcomeStats } from "./contracts";

/** Minimum outcomes before computing meaningful statistics. */
const MIN_OUTCOMES_FOR_STATS = 5;

/** Maximum stored outcomes before pruning oldest entries. */
const MAX_OUTCOMES = 1000;

export class DispatchLearner {
  private readonly outcomes: DispatchOutcome[] = [];

  record(outcome: DispatchOutcome): void {
    this.outcomes.push(outcome);

    // Prune oldest if exceeding capacity
    if (this.outcomes.length > MAX_OUTCOMES) {
      this.outcomes.splice(0, this.outcomes.length - MAX_OUTCOMES);
    }
  }

  getSuccessRate(agent: string): number {
    const agentOutcomes = this.outcomes.filter((o) => o.actualAgent === agent);
    if (agentOutcomes.length === 0) return 0;
    const successes = agentOutcomes.filter((o) => o.success).length;
    return successes / agentOutcomes.length;
  }

  getAverageCost(agent: string): number {
    const agentOutcomes = this.outcomes.filter((o) => o.actualAgent === agent);
    if (agentOutcomes.length === 0) return 0;
    const totalCost = agentOutcomes.reduce((sum, o) => sum + o.actualCost, 0);
    return totalCost / agentOutcomes.length;
  }

  getOutcomeCount(): number {
    return this.outcomes.length;
  }

  /**
   * Compute outcome statistics grouped by (category, agent).
   * Only returns stats for pairs with enough data points.
   */
  computeStats(): OutcomeStats[] {
    const groups = new Map<string, DispatchOutcome[]>();

    for (const outcome of this.outcomes) {
      const key = `${outcome.plan.intent.category}:${outcome.actualAgent}`;
      const group = groups.get(key);
      if (group) {
        group.push(outcome);
      } else {
        groups.set(key, [outcome]);
      }
    }

    const stats: OutcomeStats[] = [];
    for (const [key, outcomes] of groups) {
      if (outcomes.length < MIN_OUTCOMES_FOR_STATS) continue;

      const [category, agent] = key.split(":") as [Intent["category"], string];
      const successCount = outcomes.filter((o) => o.success).length;
      const totalCost = outcomes.reduce((sum, o) => sum + o.actualCost, 0);
      const totalDuration = outcomes.reduce((sum, o) => sum + o.durationMs, 0);

      stats.push({
        category,
        agent,
        totalDispatches: outcomes.length,
        successCount,
        averageCost: totalCost / outcomes.length,
        averageDurationMs: totalDuration / outcomes.length,
        successRate: successCount / outcomes.length,
      });
    }

    return stats;
  }

  /**
   * Get the best agent for a given task category based on historical outcomes.
   * Returns null if insufficient data for a recommendation.
   */
  recommendAgent(category: Intent["category"]): string | null {
    const stats = this.computeStats().filter((s) => s.category === category);
    if (stats.length === 0) return null;

    // Sort by success rate descending, then by average cost ascending
    stats.sort((a, b) => {
      if (b.successRate !== a.successRate) return b.successRate - a.successRate;
      return a.averageCost - b.averageCost;
    });

    return stats[0].agent;
  }

  serialize(): DispatchOutcome[] {
    return [...this.outcomes];
  }

  deserialize(data: DispatchOutcome[]): void {
    this.outcomes.length = 0;
    this.outcomes.push(...data);
  }
}

export const dispatchLearner = new DispatchLearner();
