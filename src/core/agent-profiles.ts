/**
 * Agent class profiles: role-based defaults for orchestrator, worker, and scout agents.
 *
 * These profiles define the operational envelope for each agent class independently
 * of which model family is used. A scout running a small model and a scout running
 * a large model both get the same context window, temperature, and reasoning policy.
 *
 * The three agent classes serve fundamentally different purposes:
 *   - Orchestrator: human-facing, creative reasoning, long context for conversation history
 *   - Worker: deterministic code execution, moderate context for file contents
 *   - Scout: fast targeted lookup, minimal creativity, pure tool-call execution
 */

export type AgentClass = "orchestrator" | "worker" | "scout";

export interface AgentClassProfile {
  /** Agent class identifier. */
  readonly agentClass: AgentClass;

  /** Maximum context window in tokens. Models are loaded with this limit. */
  readonly contextWindow: number;

  /** Sampling temperature. Lower = more deterministic. */
  readonly temperature: number;

  /** Nucleus sampling threshold. */
  readonly topP: number;

  /** Top-k sampling limit. */
  readonly topK: number;

  /** Presence penalty to reduce repetition. */
  readonly presencePenalty: number;

  /** Whether reasoning/thinking is enabled for this agent class. */
  readonly reasoning: boolean;

  /** Maximum tool calls before the agent is forcibly stopped. Null = no limit. */
  readonly maxToolCalls: number | null;
}

const ORCHESTRATOR_PROFILE: AgentClassProfile = {
  agentClass: "orchestrator",
  contextWindow: 262_144,
  temperature: 0.6,
  topP: 0.95,
  topK: 20,
  presencePenalty: 0.0,
  reasoning: true,
  maxToolCalls: null,
};

const WORKER_PROFILE: AgentClassProfile = {
  agentClass: "worker",
  contextWindow: 200_000,
  temperature: 0.3,
  topP: 0.9,
  topK: 40,
  presencePenalty: 0.0,
  reasoning: false,
  maxToolCalls: null,
};

const SCOUT_PROFILE: AgentClassProfile = {
  agentClass: "scout",
  contextWindow: 100_000,
  temperature: 0.1,
  topP: 0.9,
  topK: 40,
  presencePenalty: 0.0,
  reasoning: false,
  maxToolCalls: 15,
};

const PROFILES: ReadonlyMap<AgentClass, AgentClassProfile> = new Map([
  ["orchestrator", ORCHESTRATOR_PROFILE],
  ["worker", WORKER_PROFILE],
  ["scout", SCOUT_PROFILE],
]);

/** Get the profile for an agent class. */
export function getAgentProfile(agentClass: AgentClass): AgentClassProfile {
  const profile = PROFILES.get(agentClass);
  if (!profile) throw new Error(`Unknown agent class: ${agentClass}`);
  return profile;
}

/** Get all agent class profiles. */
export function getAllAgentProfiles(): readonly AgentClassProfile[] {
  return [...PROFILES.values()];
}
