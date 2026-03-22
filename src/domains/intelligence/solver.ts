/**
 * Plan generation (experimental).
 * Given an intent, generates a dispatch plan.
 */

import { AgentName, DEFAULT_AGENT } from "../../core/agent-names";
import type { DispatchPlan, Intent } from "./contracts";

const AGENT_MAP: Record<string, string> = {
  coding: AgentName.DEV,
  review: AgentName.REVIEWER,
  research: AgentName.DEV,
  testing: AgentName.DEV,
  refactoring: AgentName.DEV,
  unknown: AgentName.DEV,
};

export function generatePlan(intent: Intent): DispatchPlan {
  const agent = AGENT_MAP[intent.category] ?? DEFAULT_AGENT;

  return {
    intent,
    agent,
    model: null,
    parallel: intent.complexity === "complex",
    estimatedCost: intent.estimatedTokens * 0.00001,
    confidence: intent.category === "unknown" ? 0.3 : 0.7,
  };
}
