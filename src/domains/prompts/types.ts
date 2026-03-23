// Prompt engine type definitions for the PanPrompt compilation system.

import type { OrchestratorMode } from "../../core/modes";

/** Model capability tier for prompt density selection. */
export type ModelTier = "frontier" | "mid" | "small";

/** Which agent role a prompt targets. */
export type PromptRole = "orchestrator" | "worker" | "scout";

/**
 * Fragment category determines ordering within the compiled prompt.
 * Categories are assembled in the order listed here; identity first,
 * operational last. Budget enforcement drops from the bottom up.
 */
export type FragmentCategory =
  | "identity"
  | "constitution"
  | "mode"
  | "dispatch"
  | "safety"
  | "tool-guidance"
  | "output-contract"
  | "operational";

/** Ordered category list for compilation. Identity is highest priority. */
export const CATEGORY_ORDER: readonly FragmentCategory[] = [
  "identity",
  "constitution",
  "mode",
  "dispatch",
  "safety",
  "tool-guidance",
  "output-contract",
  "operational",
] as const;

/**
 * A typed prompt fragment. Fragments are the atomic unit of the prompt
 * compilation system. Each declares its applicability (role, tier, mode)
 * and the compiler assembles matching fragments into a final prompt string.
 */
export interface Fragment {
  /** Unique identifier, e.g. "orch.identity.frontier" */
  readonly id: string;
  /** Monotonic version for iteration tracking. */
  readonly version: number;
  /** Which prompt roles include this fragment. Empty array means all roles. */
  readonly roles: readonly PromptRole[];
  /** Which model tiers receive this fragment. Empty array means all tiers. */
  readonly tiers: readonly ModelTier[];
  /** Which orchestrator modes include this fragment. Empty array means all modes. */
  readonly modes: readonly OrchestratorMode[];
  /** Which runtimes include this fragment. Empty array means all runtimes. */
  readonly runtimes?: readonly string[];
  /** Category determines ordering and budget priority. */
  readonly category: FragmentCategory;
  /** Pre-computed token estimate for budget enforcement. */
  readonly estimatedTokens: number;
  /** The prompt text. Supports ${VAR} template variable expansion. */
  readonly text: string;
}

/**
 * Context passed to the compiler to select and assemble fragments.
 */
export interface CompilationContext {
  readonly role: PromptRole;
  readonly tier: ModelTier;
  readonly mode: OrchestratorMode;
  /** Runtime identifier for runtime-specific fragment filtering. */
  readonly runtime?: string;
  /** Template variables for ${VAR} expansion in fragment text. */
  readonly variables: Readonly<Record<string, string>>;
  /** Maximum token budget for the compiled output. */
  readonly tokenBudget: number;
}

/**
 * Result of a prompt compilation pass.
 */
export interface CompiledPrompt {
  /** The final assembled prompt text. */
  readonly text: string;
  /** Fragment IDs included in this compilation, in assembly order. */
  readonly includedFragments: readonly string[];
  /** Fragment IDs excluded by tier, mode, or budget filtering. */
  readonly excludedFragments: readonly string[];
  /** Estimated total token count of the compiled text. */
  readonly estimatedTokens: number;
  /** ISO timestamp of compilation. */
  readonly compiledAt: string;
  /** SHA-256 hash of the compiled text for integrity tracking. */
  readonly hash: string;
}

/**
 * Context for dynamic worker prompt compilation at dispatch time.
 */
export interface WorkerPromptContext {
  readonly agentName: string;
  readonly task: string;
  readonly readonly: boolean;
  /** CSV tool allowlist for this worker. */
  readonly tools: string;
  readonly mode: OrchestratorMode;
  readonly tier: ModelTier;
  /** Previous step output for chain dispatch ($INPUT substitution). */
  readonly previousOutput?: string;
}

/**
 * Persisted prompt compilation manifest for versioning.
 */
export interface PromptManifest {
  readonly role: PromptRole;
  readonly tier: ModelTier;
  readonly mode: OrchestratorMode;
  readonly fragmentIds: readonly string[];
  readonly estimatedTokens: number;
  readonly hash: string;
  readonly compiledAt: string;
}
