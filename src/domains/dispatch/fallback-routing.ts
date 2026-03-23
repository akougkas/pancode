/**
 * Fallback provider routing for dispatch resilience.
 *
 * When a provider's circuit breaker opens (consecutive 5xx errors),
 * the dispatcher reroutes to the next provider in the fallback chain.
 * Configuration comes from PANCODE_PROVIDER_FALLBACKS env var or
 * inline in panpresets.yaml (future).
 */

export interface FallbackChain {
  provider: string;
  fallbacks: string[];
}

/**
 * Parse fallback chains from the PANCODE_PROVIDER_FALLBACKS env var.
 *
 * Format: provider:fallback1,fallback2;provider2:fallback3,fallback4
 * Example: anthropic:openai,local-lmstudio;openai:anthropic,local-lmstudio
 */
export function parseFallbackChains(): FallbackChain[] {
  const raw = process.env.PANCODE_PROVIDER_FALLBACKS?.trim();
  if (!raw) return [];

  const chains: FallbackChain[] = [];
  for (const entry of raw.split(";")) {
    const trimmed = entry.trim();
    if (!trimmed) continue;

    const colonIdx = trimmed.indexOf(":");
    if (colonIdx === -1) continue;

    const provider = trimmed.slice(0, colonIdx).trim();
    const fallbackStr = trimmed.slice(colonIdx + 1).trim();
    const fallbacks = fallbackStr
      .split(",")
      .map((f) => f.trim())
      .filter((f) => f.length > 0);

    if (provider && fallbacks.length > 0) {
      chains.push({ provider, fallbacks });
    }
  }

  return chains;
}

/** Cached chains, parsed once at first access. */
let cachedChains: FallbackChain[] | null = null;

function getChains(): FallbackChain[] {
  if (cachedChains === null) {
    cachedChains = parseFallbackChains();
  }
  return cachedChains;
}

/**
 * Get the fallback providers for a given primary provider.
 * Returns an empty array if no fallbacks are configured.
 */
export function getFallbacksFor(provider: string): string[] {
  const chain = getChains().find((c) => c.provider === provider);
  return chain?.fallbacks ?? [];
}

/**
 * Resolve the best available provider from a primary + fallback chain.
 * Takes a health checker function that returns true if the provider is usable.
 *
 * Returns the primary provider if healthy, otherwise the first healthy fallback.
 * Returns null if all providers in the chain are unhealthy.
 */
export function resolveProviderWithFallback(primary: string, isUsable: (provider: string) => boolean): string | null {
  if (isUsable(primary)) return primary;

  const fallbacks = getFallbacksFor(primary);
  for (const fallback of fallbacks) {
    if (isUsable(fallback)) return fallback;
  }

  return null;
}

/** Reset the cached chains. Useful for testing or config reload. */
export function resetFallbackCache(): void {
  cachedChains = null;
}
