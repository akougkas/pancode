// Worker and scout prompt compiler.
// Generates dynamic system prompts at dispatch time based on agent spec,
// task context, model tier, and mode constraints.

import { compilePrompt } from "./compiler";
import { ALL_FRAGMENTS } from "./fragments";
import { classifyModelTier, deriveProviderHint } from "./tiering";
import type { CompilationContext, CompiledPrompt, ModelTier, WorkerPromptContext } from "./types";

/** Token budget for worker system prompts. */
const WORKER_PROMPT_BUDGET = 500;

/** Token budget for scout system prompts. */
const SCOUT_PROMPT_BUDGET = 250;

/** Recent worker compilations ring buffer for debugging. */
const recentCompilations: CompiledPrompt[] = [];
const MAX_RECENT = 20;

/**
 * Minimal agent spec interface. Keeps the prompts domain free of
 * cross-domain imports by accepting any object with these fields.
 */
export interface AgentSpecSlice {
  name: string;
  systemPrompt?: string;
  readonly?: boolean;
  tools?: string;
}

/**
 * Minimal model profile interface (same as orchestrator-compiler).
 */
export interface WorkerModelProfileSlice {
  providerId?: string;
  family?: string | null;
  capabilities?: {
    contextWindow?: number | null;
    parameterCount?: number | null;
    reasoning?: boolean | null;
  } | null;
}

/**
 * Compile a dynamic worker system prompt at dispatch time.
 *
 * Assembles role identity, task framing, safety constraints, tool strategy,
 * and output contract based on the agent spec and dispatch context.
 *
 * Falls back to the static panagents.yaml system_prompt if the agent has a
 * custom prompt (non-default). Default agents (dev, reviewer) get dynamic
 * prompts from the fragment library.
 */
export function compileWorkerPrompt(
  spec: AgentSpecSlice | null,
  context: WorkerPromptContext,
  modelProfile: WorkerModelProfileSlice | null,
): string {
  // If the agent spec has a custom system prompt that was explicitly set
  // (not a default empty string), preserve it. Custom agents from panagents.yaml
  // retain their user-authored prompts.
  if (spec?.systemPrompt && isCustomAgentPrompt(spec.name, spec.systemPrompt)) {
    return spec.systemPrompt;
  }

  const tier = resolveWorkerTier(modelProfile);

  const variables: Record<string, string> = {
    WORKER_TASK: context.task || "",
  };

  const compilationContext: CompilationContext = {
    role: "worker",
    tier,
    mode: context.mode,
    variables,
    tokenBudget: WORKER_PROMPT_BUDGET,
  };

  const compiled = compilePrompt(ALL_FRAGMENTS, compilationContext);

  // Track for debugging.
  recentCompilations.push(compiled);
  if (recentCompilations.length > MAX_RECENT) {
    recentCompilations.shift();
  }

  return compiled.text;
}

/**
 * Compile the scout system prompt for shadow_explore.
 * Replaces the hardcoded SCOUT_SYSTEM_PROMPT constant.
 */
export function compileScoutPrompt(modelProfile: WorkerModelProfileSlice | null): string {
  const tier = resolveWorkerTier(modelProfile);

  const context: CompilationContext = {
    role: "scout",
    tier,
    mode: "build", // Scouts are mode-independent; build gives widest fragment match
    variables: {},
    tokenBudget: SCOUT_PROMPT_BUDGET,
  };

  return compilePrompt(ALL_FRAGMENTS, context).text;
}

/**
 * Returns recent worker prompt compilations for debugging.
 */
export function getRecentWorkerCompilations(count = 10): readonly CompiledPrompt[] {
  return recentCompilations.slice(-count);
}

/**
 * Determine if an agent's system prompt is a user-authored custom prompt
 * (as opposed to a PanCode default). Default agents use well-known prefixes.
 */
function isCustomAgentPrompt(agentName: string, prompt: string): boolean {
  // Known default agent names get dynamic prompts from the fragment library.
  const defaultAgents = new Set(["dev", "reviewer"]);
  if (defaultAgents.has(agentName)) return false;

  // Any other agent with a non-empty system prompt is considered custom.
  return prompt.trim().length > 0;
}

/**
 * Resolve model tier from a profile slice.
 */
function resolveWorkerTier(profile: WorkerModelProfileSlice | null): ModelTier {
  if (!profile) return "mid";
  const providerHint = deriveProviderHint(profile.providerId ?? null);
  return classifyModelTier(profile.capabilities ?? null, providerHint, profile.family);
}
