/**
 * Adaptive learning from dispatch outcomes (experimental).
 * Tracks which dispatch plans succeeded and adjusts future routing.
 */

import type { DispatchOutcome } from "./contracts";

export class DispatchLearner {
  private readonly outcomes: DispatchOutcome[] = [];

  record(outcome: DispatchOutcome): void {
    this.outcomes.push(outcome);
  }

  getSuccessRate(agent: string): number {
    const agentOutcomes = this.outcomes.filter((o) => o.plan.agent === agent);
    if (agentOutcomes.length === 0) return 0;
    const successes = agentOutcomes.filter((o) => o.success).length;
    return successes / agentOutcomes.length;
  }

  getAverageCost(agent: string): number {
    const agentOutcomes = this.outcomes.filter((o) => o.plan.agent === agent);
    if (agentOutcomes.length === 0) return 0;
    const totalCost = agentOutcomes.reduce((sum, o) => sum + o.actualCost, 0);
    return totalCost / agentOutcomes.length;
  }

  getOutcomeCount(): number {
    return this.outcomes.length;
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
