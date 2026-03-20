/**
 * Plan generation (experimental).
 * Given an intent, generates a dispatch plan.
 */

import type { DispatchPlan, Intent } from "./contracts";

const AGENT_MAP: Record<string, string> = {
  coding: "dev",
  review: "reviewer",
  research: "dev",
  testing: "dev",
  refactoring: "dev",
  unknown: "dev",
};

export function generatePlan(intent: Intent): DispatchPlan {
  const agent = AGENT_MAP[intent.category] ?? "dev";

  return {
    intent,
    agent,
    model: null,
    parallel: intent.complexity === "complex",
    estimatedCost: intent.estimatedTokens * 0.00001,
    confidence: intent.category === "unknown" ? 0.3 : 0.7,
  };
}
