// Model tier classification for prompt density selection.
// Classifies models into frontier/mid/small based on capabilities metadata.

import type { ModelTier } from "./types";

/**
 * Minimal capability subset needed for tier classification.
 * Accepts MergedModelProfile.capabilities or any object with these fields.
 */
export interface TierableCapabilities {
  contextWindow?: number | null;
  parameterCount?: number | null;
  reasoning?: boolean | null;
}

/**
 * Provider classification hint. Cloud providers are assumed frontier-capable
 * when combined with reasoning support.
 */
export type ProviderHint = "local" | "cloud" | "unknown";

/** Known frontier model family prefixes. */
const FRONTIER_FAMILIES = new Set(["claude-4", "claude-3.5", "gpt-4", "gpt-5", "gemini-2", "gemini-3"]);

/** Known mid-range model family prefixes. */
const MID_FAMILIES = new Set(["qwen3", "qwen2.5", "llama4", "llama3", "deepseek-v3", "deepseek-r1", "mistral-large"]);

/**
 * Classify a model into a prompt tier based on its capabilities.
 *
 * Frontier: contextWindow >= 100K OR parameterCount >= 30B OR (reasoning + cloud) OR known frontier family
 * Mid: contextWindow >= 16K OR parameterCount >= 7B OR known mid family
 * Small: everything else, including null/unknown capabilities
 */
export function classifyModelTier(
  capabilities: TierableCapabilities | null,
  providerHint: ProviderHint = "unknown",
  family?: string | null,
): ModelTier {
  // Check family match first (fastest path)
  if (family) {
    const normalized = family.toLowerCase();
    for (const prefix of FRONTIER_FAMILIES) {
      if (normalized.startsWith(prefix)) return "frontier";
    }
    for (const prefix of MID_FAMILIES) {
      if (normalized.startsWith(prefix)) return "mid";
    }
  }

  if (!capabilities) return "small";

  const ctx = capabilities.contextWindow ?? 0;
  const params = capabilities.parameterCount ?? 0;

  // Frontier thresholds
  if (ctx >= 100_000) return "frontier";
  if (params >= 30_000_000_000) return "frontier";
  if (capabilities.reasoning && providerHint === "cloud") return "frontier";

  // Mid thresholds
  if (ctx >= 16_000) return "mid";
  if (params >= 7_000_000_000) return "mid";

  return "small";
}

/**
 * Derive a provider hint from a provider ID string.
 * Provider IDs containing engine prefixes like "lmstudio-", "ollama-", "llamacpp-"
 * are classified as local. Everything else is unknown (conservative).
 */
export function deriveProviderHint(providerId: string | null): ProviderHint {
  if (!providerId) return "unknown";
  const lower = providerId.toLowerCase();
  if (lower.startsWith("lmstudio") || lower.startsWith("ollama") || lower.startsWith("llamacpp")) {
    return "local";
  }
  if (lower.startsWith("anthropic") || lower.startsWith("openai") || lower.startsWith("google")) {
    return "cloud";
  }
  return "unknown";
}
