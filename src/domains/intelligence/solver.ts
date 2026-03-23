/**
 * Enhanced dispatch plan generation.
 *
 * Given an intent, generates a dispatch plan considering:
 * 1. Static agent mapping (deterministic fallback)
 * 2. Model tier matching (intent suggests tier, solver resolves)
 * 3. Learned routing overrides (from dispatch outcomes)
 * 4. Multi-step plan generation for complex tasks
 *
 * Future: replace static AGENT_MAP with a tiny model classifier
 * (FunctionGemma router pattern from the old codebase).
 */

import { AgentName, DEFAULT_AGENT } from "../../core/agent-names";
import type { DispatchPlan, Intent, OutcomeStats } from "./contracts";

/** Static agent mapping as a deterministic fallback. */
const AGENT_MAP: Record<string, string> = {
  coding: AgentName.DEV,
  review: AgentName.REVIEWER,
  research: AgentName.DEV,
  testing: AgentName.DEV,
  refactoring: AgentName.DEV,
  planning: AgentName.DEV,
  documentation: AgentName.DEV,
  unknown: AgentName.DEV,
};

/** Minimum number of outcomes needed before learned routing is used. */
const LEARNED_ROUTING_THRESHOLD = 10;

/** Minimum success rate for learned routing to be considered. */
const LEARNED_SUCCESS_THRESHOLD = 0.6;

export interface SolverContext {
  /** Historical outcome statistics per (category, agent). */
  stats: OutcomeStats[];
  /** Available agents in the current session. */
  availableAgents: string[];
}

/**
 * Generate a dispatch plan from an intent.
 * Uses learned routing when sufficient data is available,
 * falls back to the static AGENT_MAP otherwise.
 */
export function generatePlan(intent: Intent, context?: SolverContext): DispatchPlan {
  // Try learned routing first if context is available
  if (context) {
    const learnedPlan = tryLearnedRouting(intent, context);
    if (learnedPlan) return learnedPlan;
  }

  // Static agent mapping
  const agent = AGENT_MAP[intent.category] ?? DEFAULT_AGENT;

  return {
    intent,
    agent,
    model: null,
    parallel: intent.complexity === "complex",
    estimatedCost: intent.estimatedTokens * 0.00001,
    confidence: intent.confidence * 0.7, // Reduce confidence for static mapping
    learned: false,
  };
}

/**
 * Try to generate a plan using learned routing from historical outcomes.
 * Returns null if insufficient data or no clear winner.
 */
function tryLearnedRouting(intent: Intent, context: SolverContext): DispatchPlan | null {
  // Find all agents that have handled this category
  const categoryStats = context.stats.filter(
    (s) => s.category === intent.category && s.totalDispatches >= LEARNED_ROUTING_THRESHOLD,
  );

  if (categoryStats.length === 0) return null;

  // Pick the agent with the best success rate that exceeds threshold
  let bestAgent: string | null = null;
  let bestRate = 0;

  for (const stat of categoryStats) {
    if (!context.availableAgents.includes(stat.agent)) continue;
    if (stat.successRate > bestRate && stat.successRate >= LEARNED_SUCCESS_THRESHOLD) {
      bestRate = stat.successRate;
      bestAgent = stat.agent;
    }
  }

  if (!bestAgent) return null;

  // Find the stat for cost estimation
  const bestStat = categoryStats.find((s) => s.agent === bestAgent);

  return {
    intent,
    agent: bestAgent,
    model: null,
    parallel: intent.complexity === "complex",
    estimatedCost: bestStat?.averageCost ?? intent.estimatedTokens * 0.00001,
    confidence: intent.confidence * bestRate,
    learned: true,
  };
}

/**
 * Generate a multi-step plan for complex tasks.
 * Decomposes into: scout -> plan -> execute -> review.
 *
 * Returns an array of dispatch steps. Each step has an agent and
 * a task template with $INPUT placeholder for the previous step's output.
 */
export function generateMultiStepPlan(intent: Intent): Array<{ agent: string; taskTemplate: string }> {
  if (intent.complexity !== "complex") {
    const agent = AGENT_MAP[intent.category] ?? DEFAULT_AGENT;
    return [{ agent, taskTemplate: intent.task }];
  }

  // Complex tasks get a multi-step pipeline
  const steps: Array<{ agent: string; taskTemplate: string }> = [];

  // Step 1: Scout the relevant code
  if (intent.mentionedPaths.length > 0) {
    const pathList = intent.mentionedPaths.join(", ");
    steps.push({
      agent: "scout",
      taskTemplate: `Explore these files and report their structure and purpose: ${pathList}`,
    });
  }

  // Step 2: Plan the approach
  if (intent.category === "coding" || intent.category === "refactoring") {
    steps.push({
      agent: "planner",
      taskTemplate: `Create an implementation plan for: ${intent.task}\n\nContext from scout: $INPUT`,
    });
  }

  // Step 3: Execute the task
  const agent = AGENT_MAP[intent.category] ?? DEFAULT_AGENT;
  steps.push({
    agent,
    taskTemplate: steps.length > 0 ? `${intent.task}\n\nPlan: $INPUT` : intent.task,
  });

  // Step 4: Review (for coding and refactoring)
  if (intent.category === "coding" || intent.category === "refactoring") {
    steps.push({
      agent: AgentName.REVIEWER,
      taskTemplate: "Review the changes from the previous step: $INPUT",
    });
  }

  return steps;
}
