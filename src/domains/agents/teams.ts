import { AgentName } from "../../core/agent-names";

/**
 * Team topology types that govern collaboration patterns.
 *
 * "leader-workers": one orchestrator dispatches to N workers (current default).
 * "reviewer-gate": every mutable dispatch auto-inserts a review step.
 * "mesh": workers communicate directly via shared board (future, design only).
 */
export type TeamTopology = "leader-workers" | "reviewer-gate" | "mesh";

export interface TeamDefinition {
  name: string;
  description: string;
  agents: string[];
  workflow: "parallel" | "sequential" | "review";
  /** Collaboration topology enforced by the runtime. Defaults to "leader-workers". */
  topology: TeamTopology;
  /** For reviewer-gate topology: the agent that performs automatic review. */
  reviewerAgent?: string;
  /** Maximum retry attempts when reviewer rejects (reviewer-gate only). */
  maxReviewRetries?: number;
}

export const BUILTIN_TEAMS: TeamDefinition[] = [
  {
    name: "code-review",
    description: "Developer writes code, reviewer checks it",
    agents: [AgentName.DEV, AgentName.REVIEWER],
    workflow: "sequential",
    topology: "leader-workers",
  },
  {
    name: "research-dev",
    description: "Reviewer explores codebase, developer implements",
    agents: [AgentName.REVIEWER, AgentName.DEV],
    workflow: "sequential",
    topology: "leader-workers",
  },
  {
    name: "reviewed-dev",
    description: "Developer writes code with automatic review gate",
    agents: [AgentName.DEV, AgentName.REVIEWER],
    workflow: "review",
    topology: "reviewer-gate",
    reviewerAgent: AgentName.REVIEWER,
    maxReviewRetries: 2,
  },
];

/**
 * Check whether a team uses the reviewer-gate topology.
 * When true, the dispatch system should auto-expand single-agent
 * mutable dispatches into a chain: [builder, reviewer].
 */
export function isReviewerGateTeam(team: TeamDefinition): boolean {
  return team.topology === "reviewer-gate" && !!team.reviewerAgent;
}

/**
 * Build a dispatch chain expansion for reviewer-gate topology.
 * Returns the steps that should replace a single dispatch.
 *
 * Step 1: Original agent performs the task.
 * Step 2: Reviewer agent validates the output.
 *
 * If the reviewer rejects, the caller re-dispatches with feedback
 * up to maxReviewRetries times.
 */
export function expandReviewerGateChain(
  team: TeamDefinition,
  originalAgent: string,
  originalTask: string,
): Array<{ agent: string; task: string }> {
  if (!isReviewerGateTeam(team)) {
    return [{ agent: originalAgent, task: originalTask }];
  }

  const reviewer = team.reviewerAgent ?? "reviewer";
  return [
    { agent: originalAgent, task: originalTask },
    { agent: reviewer, task: "Review the changes from the previous step: $INPUT" },
  ];
}
