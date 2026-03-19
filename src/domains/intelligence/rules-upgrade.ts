/**
 * Rules upgrade stub.
 * When the intelligence domain collects enough dispatch outcomes,
 * it can replace declarative dispatch rules with learned routing.
 * This is the upgrade path from rules-based to adaptive dispatch.
 */

import type { DispatchOutcome, DispatchPlan, Intent } from "./contracts";

export class RulesUpgrade {
  private outcomes: DispatchOutcome[] = [];
  private enabled = false;

  recordOutcome(outcome: DispatchOutcome): void {
    this.outcomes.push(outcome);
  }

  suggest(_intent: Intent): DispatchPlan | null {
    if (!this.enabled || this.outcomes.length < 10) return null;
    // Future: analyze outcomes to suggest optimal routing.
    return null;
  }

  enable(): void {
    this.enabled = true;
  }

  disable(): void {
    this.enabled = false;
  }

  getOutcomeCount(): number {
    return this.outcomes.length;
  }
}

export const rulesUpgrade = new RulesUpgrade();
