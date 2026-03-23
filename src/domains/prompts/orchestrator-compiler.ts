// Orchestrator system prompt compiler.
// Combines fragment compilation with Pi SDK prompt surgery to produce
// the final orchestrator system prompt injected via before_agent_start.

import type { ModeDefinition } from "../../core/modes";
import { compilePrompt } from "./compiler";
import { ALL_FRAGMENTS } from "./fragments";
import { surgePiPrompt } from "./pi-compat";
import { classifyModelTier, deriveProviderHint } from "./tiering";
import type { CompilationContext, CompiledPrompt, ModelTier } from "./types";

/** Token budget for PanCode's orchestrator content (identity + mode + dispatch + ...). */
const ORCHESTRATOR_PANCODE_BUDGET = 4096;

/** Last compilation result for debugging via /prompt-debug. */
let lastCompilation: CompiledPrompt | null = null;

/**
 * Minimal model profile interface. Accepts MergedModelProfile or any object
 * with these fields. Keeps the prompts domain free of cross-domain imports.
 */
export interface ModelProfileSlice {
  providerId?: string;
  family?: string | null;
  capabilities?: {
    contextWindow?: number | null;
    parameterCount?: number | null;
    reasoning?: boolean | null;
  } | null;
}

/**
 * Compile the PanCode orchestrator system prompt.
 *
 * Takes the Pi SDK's auto-built base prompt, performs surgical section
 * replacement (identity, Pi docs removal), and injects compiled PanCode
 * content based on current mode and model tier.
 *
 * Called from the ui extension's before_agent_start hook on every turn.
 */
export function compileOrchestratorPrompt(
  piBasePrompt: string,
  mode: ModeDefinition,
  modelProfile: ModelProfileSlice | null,
  variables?: Record<string, string>,
): string {
  const tier = resolveOrchestratorTier(modelProfile);

  // Build compilation context.
  const context: CompilationContext = {
    role: "orchestrator",
    tier,
    mode: mode.id,
    variables: variables ?? {},
    tokenBudget: ORCHESTRATOR_PANCODE_BUDGET,
  };

  // Compile PanCode fragments into content blocks.
  const compiled = compilePrompt(ALL_FRAGMENTS, context);
  lastCompilation = compiled;

  // Split compiled text into main content (identity through tool-guidance)
  // and footer content (output-contract, operational) that goes before the date.
  const lines = compiled.text.split("\n\n");
  const footerCategories = new Set(["output-contract", "operational"]);
  const mainLines: string[] = [];
  const footerLines: string[] = [];

  // Use fragment order to determine which text blocks are footer content.
  // The compiled text joins fragments with \n\n, and fragments are ordered by category.
  // Footer fragments are the last ones (output-contract, operational).
  let footerStartIdx = -1;
  for (let i = compiled.includedFragments.length - 1; i >= 0; i--) {
    const frag = ALL_FRAGMENTS.find((f) => f.id === compiled.includedFragments[i]);
    if (frag && footerCategories.has(frag.category)) {
      footerStartIdx = i;
    } else {
      break;
    }
  }

  if (footerStartIdx !== -1 && footerStartIdx < lines.length) {
    mainLines.push(...lines.slice(0, footerStartIdx));
    footerLines.push(...lines.slice(footerStartIdx));
  } else {
    mainLines.push(...lines);
  }

  const mainContent = mainLines.join("\n\n");
  const footerContent = footerLines.join("\n\n");

  // Perform Pi SDK prompt surgery: replace identity, remove Pi docs, inject footer.
  return surgePiPrompt(piBasePrompt, mainContent, footerContent);
}

/**
 * Returns the last orchestrator compilation metadata for debugging.
 * Used by the /prompt-debug command.
 */
export function getLastOrchestratorCompilation(): CompiledPrompt | null {
  return lastCompilation;
}

/**
 * Resolve model tier from a profile slice.
 */
function resolveOrchestratorTier(profile: ModelProfileSlice | null): ModelTier {
  if (!profile) return "mid"; // Default to mid when profile unknown
  const providerHint = deriveProviderHint(profile.providerId ?? null);
  return classifyModelTier(profile.capabilities ?? null, providerHint, profile.family);
}
