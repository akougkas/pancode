// Core prompt compilation engine.
// Filters fragments by role/tier/mode, orders by category, expands variables,
// enforces token budget, and produces a CompiledPrompt with metadata.

import { createHash } from "node:crypto";
import type { OrchestratorMode } from "../../core/modes";
import {
  CATEGORY_ORDER,
  type CompilationContext,
  type CompiledPrompt,
  type Fragment,
  type FragmentCategory,
  type ModelTier,
  type PromptRole,
} from "./types";

/**
 * Estimate token count using the ~4 characters per token heuristic.
 * Sufficient for budget enforcement. Not used for billing.
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * Expand ${VAR} template references in text.
 * Unknown variables are replaced with empty string.
 */
export function expandVariables(text: string, variables: Readonly<Record<string, string>>): string {
  return text.replace(/\$\{(\w+)\}/g, (_match, name: string) => variables[name] ?? "");
}

/** Compute SHA-256 hash of text, returned as hex string. */
function computeHash(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

/**
 * Check whether a fragment matches the compilation context.
 * Empty arrays in the fragment mean "all values match".
 */
function fragmentMatches(
  fragment: Fragment,
  role: PromptRole,
  tier: ModelTier,
  mode: OrchestratorMode,
  runtime?: string,
): boolean {
  if (fragment.roles.length > 0 && !fragment.roles.includes(role)) return false;
  if (fragment.tiers.length > 0 && !fragment.tiers.includes(tier)) return false;
  if (fragment.modes.length > 0 && !fragment.modes.includes(mode)) return false;
  if (fragment.runtimes && fragment.runtimes.length > 0) {
    if (!runtime || !fragment.runtimes.includes(runtime)) return false;
  }
  return true;
}

/** Get the sort index for a fragment category. Unknown categories sort last. */
function categoryIndex(category: FragmentCategory): number {
  const idx = CATEGORY_ORDER.indexOf(category);
  return idx === -1 ? CATEGORY_ORDER.length : idx;
}

/**
 * Compile fragments into a prompt string.
 *
 * 1. Filter fragments by role, tier, and mode
 * 2. Sort by category order (identity first, operational last)
 * 3. Expand template variables
 * 4. Enforce token budget by dropping lowest-priority categories first
 * 5. Join with double newline separators
 * 6. Return CompiledPrompt with full metadata
 */
export function compilePrompt(fragments: readonly Fragment[], context: CompilationContext): CompiledPrompt {
  const { role, tier, mode, variables, tokenBudget, runtime } = context;

  // 1. Filter matching fragments
  const matching: Fragment[] = [];
  const excluded: string[] = [];
  for (const f of fragments) {
    if (fragmentMatches(f, role, tier, mode, runtime)) {
      matching.push(f);
    } else {
      excluded.push(f.id);
    }
  }

  // 2. Sort by category order, then by fragment ID for determinism within same category
  matching.sort((a, b) => {
    const catDiff = categoryIndex(a.category) - categoryIndex(b.category);
    if (catDiff !== 0) return catDiff;
    return a.id.localeCompare(b.id);
  });

  // 3. Expand template variables
  const expanded = matching.map((f) => ({
    fragment: f,
    text: expandVariables(f.text, variables),
  }));

  // 4. Budget enforcement: drop lowest-priority categories until within budget.
  // Walk categories in reverse order (operational first, identity last).
  let totalTokens = expanded.reduce((sum, e) => sum + estimateTokens(e.text), 0);
  const budgetExcluded: string[] = [];

  if (totalTokens > tokenBudget) {
    const reversedCategories = [...CATEGORY_ORDER].reverse();
    for (const cat of reversedCategories) {
      if (totalTokens <= tokenBudget) break;
      // Remove all fragments in this category
      for (let i = expanded.length - 1; i >= 0; i--) {
        if (expanded[i].fragment.category === cat) {
          totalTokens -= estimateTokens(expanded[i].text);
          budgetExcluded.push(expanded[i].fragment.id);
          expanded.splice(i, 1);
        }
        if (totalTokens <= tokenBudget) break;
      }
    }
  }

  // 5. Join with double newline separators
  const text = expanded.map((e) => e.text).join("\n\n");
  const finalTokens = estimateTokens(text);

  // 6. Build metadata
  return {
    text,
    includedFragments: expanded.map((e) => e.fragment.id),
    excludedFragments: [...excluded, ...budgetExcluded],
    estimatedTokens: finalTokens,
    compiledAt: new Date().toISOString(),
    hash: computeHash(text),
  };
}
