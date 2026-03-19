import type { ModelRegistry } from "../../engine/session";
import type { MergedModelProfile } from "./model-matcher";

function deriveMaxTokens(contextWindow: number): number {
  const envCap = parseInt(process.env.PANCODE_MAX_OUTPUT_TOKENS ?? "", 10);
  const cap = Number.isFinite(envCap) && envCap > 0 ? envCap : 131_072;
  return Math.max(4_096, Math.min(Math.floor(contextWindow / 2), cap));
}

export function registerDiscoveredModels(
  modelRegistry: InstanceType<typeof ModelRegistry>,
  profiles: MergedModelProfile[],
): string[] {
  const registered = new Set<string>();

  const byProvider = new Map<string, MergedModelProfile[]>();
  for (const profile of profiles) {
    const existing = byProvider.get(profile.providerId) ?? [];
    existing.push(profile);
    byProvider.set(profile.providerId, existing);
  }

  for (const [providerId, providerProfiles] of byProvider.entries()) {
    const firstProfile = providerProfiles[0];
    // Invariant: all models under a provider share the same baseUrl because they originate
    // from a single engine connection. Warn loudly if that invariant is ever violated.
    if (providerProfiles.some((p) => p.baseUrl !== firstProfile.baseUrl)) {
      console.warn(
        `[pancode:providers] Provider "${providerId}" has models with different baseUrls. ` +
        `Using first: ${firstProfile.baseUrl}`,
      );
    }
    const baseUrl = `${firstProfile.baseUrl}/v1`;

    modelRegistry.registerProvider(providerId, {
      baseUrl,
      apiKey: "local",
      api: "openai-completions",
      models: providerProfiles.map((profile) => {
        const rawContextWindow = profile.capabilities.contextWindow;
        if (!rawContextWindow && profile.matchType === "unmatched") {
          // The model wasn't found in the knowledge base and the engine didn't report a
          // context window. The 8192 fallback will significantly limit usefulness.
          // Add a YAML entry under models/ to specify the correct value.
          console.warn(
            `[pancode:providers] Model "${profile.modelId}" has no context window. ` +
            `Defaulting to 8192 tokens. Add a models/ YAML entry to fix this.`,
          );
        }
        const contextWindow = rawContextWindow ?? 8_192;
        const maxTokens = deriveMaxTokens(contextWindow);
        const reasoning = profile.capabilities.reasoning ?? false;
        const vision = profile.capabilities.vision ?? false;

        return {
          id: profile.modelId,
          name: profile.modelId,
          reasoning,
          input: vision
            ? (["text", "image"] as ("text" | "image")[])
            : (["text"] as ("text" | "image")[]),
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
          contextWindow,
          maxTokens,
          compat: profile.compat,
        };
      }),
    });

    registered.add(providerId);
  }

  return [...registered];
}
