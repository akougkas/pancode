/**
 * Canonical agent name constants shared across domains.
 *
 * Dispatch, intelligence, prompts, and other domains reference these names
 * for default agent selection, team composition, and prompt compilation.
 * A rename in one place breaks at compile time everywhere, instead of
 * silently at runtime.
 */
export const AgentName = {
  DEV: "dev",
  REVIEWER: "reviewer",
} as const;

export type AgentNameValue = (typeof AgentName)[keyof typeof AgentName];

export const DEFAULT_AGENT = AgentName.DEV;
