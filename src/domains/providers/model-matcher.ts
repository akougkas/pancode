import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import YAML from "yaml";
import type { DiscoveredModel, ModelCapabilities } from "./engines/types";

export interface ModelFamilyProfile {
  family: string;
  base: string;
  license: string;
  architecture: {
    total_params: string;
    active_params: string;
    type: string;
    experts: number;
    experts_per_token: number;
    context_native: number;
  };
  capabilities: {
    tool_calling: boolean;
    reasoning: boolean;
    thinking_default: boolean;
    thinking_format: string;
    vision: boolean;
  };
  sampling: Record<string, SamplingPreset>;
  quantizations: Record<string, { size_gb: number; vram_gb: number }>;
  distributions: Record<string, Array<{ repo: string }>>;
  variants: Array<{
    id: string;
    repo: string;
    gguf?: string;
    distilled_from?: string;
  }>;
}

export interface SamplingPreset {
  temperature: number;
  top_p: number;
  top_k: number;
  presence_penalty: number;
}

export interface MergedModelProfile {
  modelId: string;
  providerId: string;
  engine: string;
  baseUrl: string;
  family: string | null;
  matchType: "variant" | "family" | "unmatched";
  capabilities: ModelCapabilities;
  sampling: Record<string, SamplingPreset> | null;
  thinkingFormat: string | null;
  compat: ModelCompat;
}

export interface ModelCompat {
  supportsDeveloperRole: boolean;
  supportsReasoningEffort: boolean;
  supportsUsageInStreaming: boolean;
  maxTokensField: "max_completion_tokens" | "max_tokens";
  thinkingFormat: string | null;
}

export function loadModelKnowledgeBase(modelsDir: string): ModelFamilyProfile[] {
  let files: string[];
  try {
    files = readdirSync(modelsDir).filter((f) => f.endsWith(".yaml") || f.endsWith(".yml"));
  } catch {
    return [];
  }

  const profiles: ModelFamilyProfile[] = [];
  for (const file of files) {
    const filePath = join(modelsDir, file);
    try {
      const content = readFileSync(filePath, "utf8");
      const parsed = YAML.parse(content) as ModelFamilyProfile;
      if (parsed?.family) profiles.push(parsed);
    } catch (err) {
      // Log parse errors but continue loading other profiles
      console.error(`[pancode:models] Failed to load ${file}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return profiles;
}

// ---------------------------------------------------------------------------
// Registry metadata: avoid lists, recommendations, context caps, and quirks.
// Loaded from models/registry-metadata.yaml alongside the family profiles.
// ---------------------------------------------------------------------------

export interface AvoidEntry {
  pattern: string;
  reason: string;
}

export interface RecommendedEntry {
  family: string;
  variant: string;
  reason: string;
}

export interface ContextCapEntry {
  pattern: string;
  max_context: number;
  reason: string;
}

export interface RegistryMetadata {
  avoid: AvoidEntry[];
  recommended: Record<string, RecommendedEntry[]>;
  context_caps: ContextCapEntry[];
}

const EMPTY_REGISTRY: RegistryMetadata = { avoid: [], recommended: {}, context_caps: [] };

export function loadRegistryMetadata(modelsDir: string): RegistryMetadata {
  const filePath = join(modelsDir, "registry-metadata.yaml");
  if (!existsSync(filePath)) return EMPTY_REGISTRY;

  try {
    const content = readFileSync(filePath, "utf8");
    const parsed = YAML.parse(content) as Partial<RegistryMetadata>;
    return {
      avoid: Array.isArray(parsed.avoid) ? parsed.avoid : [],
      recommended: parsed.recommended && typeof parsed.recommended === "object" ? parsed.recommended : {},
      context_caps: Array.isArray(parsed.context_caps) ? parsed.context_caps : [],
    };
  } catch (err) {
    console.error(
      `[pancode:models] Failed to load registry-metadata.yaml: ${err instanceof Error ? err.message : String(err)}`,
    );
    return EMPTY_REGISTRY;
  }
}

/**
 * Check whether a model ID matches any pattern in the avoid list.
 * Returns the avoid entry if matched, or null if the model is safe to use.
 */
export function checkModelAvoided(modelId: string, registry: RegistryMetadata): AvoidEntry | null {
  const lower = modelId.toLowerCase().replace(/[.\-_\s]/g, "");
  for (const entry of registry.avoid) {
    const pattern = entry.pattern.toLowerCase().replace(/[.\-_\s]/g, "");
    if (lower.includes(pattern)) return entry;
  }
  return null;
}

/**
 * Get recommended models for a given agent role (orchestrator, worker, scout).
 */
export function getRecommendedModels(role: string, registry: RegistryMetadata): RecommendedEntry[] {
  return registry.recommended[role] ?? [];
}

/**
 * Apply context window caps from the registry. If the model's reported or
 * profile-based context window exceeds a known-accurate cap, clamp it.
 * Prevents models that over-report their context from causing OOM or truncation.
 */
function applyContextCap(modelId: string, contextWindow: number | null, registry: RegistryMetadata): number | null {
  if (contextWindow === null) return null;
  const lower = modelId.toLowerCase().replace(/[.\-_\s]/g, "");
  for (const cap of registry.context_caps) {
    const pattern = cap.pattern.toLowerCase().replace(/[.\-_\s]/g, "");
    if (lower.includes(pattern) && contextWindow > cap.max_context) {
      return cap.max_context;
    }
  }
  return contextWindow;
}

/**
 * Apply model-specific quirks after profile merging.
 *
 * Current quirks:
 * 1. Qwen thinking format on LM Studio: disable enable_thinking (locked decision #52).
 *    LM Studio does not correctly pass enable_thinking to Qwen models, causing
 *    infinite thinking token loops.
 * 2. Unverified tool-calling: if a model is unmatched and has no confirmed
 *    tool_calling capability, set toolCalling to false.
 */
function applyQuirks(profile: MergedModelProfile): MergedModelProfile {
  const result = { ...profile, capabilities: { ...profile.capabilities }, compat: { ...profile.compat } };

  // Quirk 1: Qwen thinking format on LM Studio disables thinking.
  // The LM Studio engine cannot properly handle the enable_thinking parameter
  // for Qwen-family models, resulting in infinite thinking token loops.
  if (result.compat.thinkingFormat === "qwen" && result.engine === "lmstudio") {
    result.compat.thinkingFormat = null;
    result.thinkingFormat = null;
    result.capabilities.thinkingFormat = null;
  }

  // Quirk 2: Unmatched models without verified tool-calling get it disabled.
  if (result.matchType === "unmatched" && result.capabilities.toolCalling === null) {
    result.capabilities.toolCalling = false;
  }

  return result;
}

// Module-level registry metadata, set during discovery alongside the knowledge base.
let registryMetadataCache: RegistryMetadata = EMPTY_REGISTRY;

export function setRegistryMetadata(metadata: RegistryMetadata): void {
  registryMetadataCache = metadata;
}

export function getRegistryMetadata(): RegistryMetadata {
  return registryMetadataCache;
}

export function matchModel(discovered: DiscoveredModel, knowledgeBase: ModelFamilyProfile[]): MergedModelProfile {
  const modelIdLower = discovered.id.toLowerCase();

  // Pass 1: exact variant match
  for (const profile of knowledgeBase) {
    for (const variant of profile.variants ?? []) {
      const variantId = variant.id.toLowerCase();
      if (modelIdLower.includes(variantId)) {
        return mergeProfile(discovered, profile, "variant");
      }
    }
  }

  // Pass 2: family match by parsing model name patterns
  for (const profile of knowledgeBase) {
    const familyLower = profile.family.toLowerCase().replace(/[.\s]/g, "");
    const normalizedModelId = modelIdLower.replace(/[.\-_\s]/g, "");

    if (normalizedModelId.includes(familyLower)) {
      return mergeProfile(discovered, profile, "family");
    }
  }

  // Pass 3: no match, use only engine-reported capabilities
  return {
    modelId: discovered.id,
    providerId: discovered.providerId,
    engine: discovered.engine,
    baseUrl: discovered.baseUrl,
    family: discovered.capabilities.family,
    matchType: "unmatched",
    capabilities: { ...discovered.capabilities },
    sampling: null,
    thinkingFormat: discovered.capabilities.thinkingFormat,
    compat: buildCompat(discovered.engine, null),
  };
}

function mergeProfile(
  discovered: DiscoveredModel,
  profile: ModelFamilyProfile,
  matchType: "variant" | "family",
): MergedModelProfile {
  // Engine-reported values take precedence over knowledge base when not null
  const caps = discovered.capabilities;
  const merged: ModelCapabilities = {
    contextWindow: caps.contextWindow ?? profile.architecture.context_native ?? null,
    maxOutputTokens: caps.maxOutputTokens,
    temperature: caps.temperature,
    topK: caps.topK,
    topP: caps.topP,
    toolCalling: caps.toolCalling ?? profile.capabilities.tool_calling ?? null,
    reasoning: caps.reasoning ?? profile.capabilities.reasoning ?? null,
    thinkingFormat: caps.thinkingFormat ?? profile.capabilities.thinking_format ?? null,
    vision: caps.vision ?? profile.capabilities.vision ?? null,
    parameterCount: caps.parameterCount,
    quantization: caps.quantization,
    family: profile.family,
  };

  return {
    modelId: discovered.id,
    providerId: discovered.providerId,
    engine: discovered.engine,
    baseUrl: discovered.baseUrl,
    family: profile.family,
    matchType,
    capabilities: merged,
    sampling: profile.sampling ?? null,
    thinkingFormat: merged.thinkingFormat,
    compat: buildCompat(discovered.engine, merged.thinkingFormat),
  };
}

function buildCompat(engine: string, thinkingFormat: string | null): ModelCompat {
  return {
    supportsDeveloperRole: false,
    supportsReasoningEffort: false,
    supportsUsageInStreaming: engine !== "llamacpp",
    maxTokensField: "max_tokens",
    thinkingFormat,
  };
}

export function matchAllModels(
  discovered: DiscoveredModel[],
  knowledgeBase: ModelFamilyProfile[],
  registry?: RegistryMetadata,
): MergedModelProfile[] {
  const reg = registry ?? EMPTY_REGISTRY;
  return discovered.map((model) => {
    let profile = matchModel(model, knowledgeBase);

    // Apply context window caps from the registry
    profile = {
      ...profile,
      capabilities: {
        ...profile.capabilities,
        contextWindow: applyContextCap(profile.modelId, profile.capabilities.contextWindow, reg),
      },
    };

    // Apply model-specific quirks
    profile = applyQuirks(profile);

    return profile;
  });
}

export function writeModelCacheYaml(profiles: MergedModelProfile[], pancodeHome: string): void {
  const serializable = {
    cachedAt: new Date().toISOString(),
    models: profiles.map((p) => ({
      modelId: p.modelId,
      providerId: p.providerId,
      engine: p.engine,
      baseUrl: p.baseUrl,
      family: p.family,
      matchType: p.matchType,
      capabilities: p.capabilities,
      sampling: p.sampling,
      thinkingFormat: p.thinkingFormat,
      compat: p.compat,
    })),
  };

  const filePath = join(pancodeHome, "model-cache.yaml");
  const tempPath = `${filePath}.tmp`;
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(tempPath, YAML.stringify(serializable), "utf8");
  renameSync(tempPath, filePath);
}

// Default cache TTL: 4 hours. Fresh homelab configs rarely change mid-session.
// Override with PANCODE_CACHE_TTL_HOURS env var.
const DEFAULT_CACHE_TTL_MS = 4 * 60 * 60 * 1000;

interface CachedModelFile {
  cachedAt?: string;
  models?: Array<{
    modelId: string;
    providerId: string;
    engine: string;
    baseUrl: string;
    family: string | null;
    matchType: "variant" | "family" | "unmatched";
    capabilities: ModelCapabilities;
    sampling: Record<string, SamplingPreset> | null;
    thinkingFormat: string | null;
    compat: ModelCompat;
  }>;
}

function resolveCacheTtlMs(): number {
  const envHours = Number.parseFloat(process.env.PANCODE_CACHE_TTL_HOURS ?? "");
  if (Number.isFinite(envHours) && envHours > 0) return envHours * 60 * 60 * 1000;
  return DEFAULT_CACHE_TTL_MS;
}

/**
 * Read cached model profiles from model-cache.yaml. Returns null if the
 * cache is missing, empty, corrupt, or stale (older than the configured TTL).
 * Used for cache-first warm boot that skips network discovery.
 */
export function readModelCacheYaml(pancodeHome: string): MergedModelProfile[] | null {
  const filePath = join(pancodeHome, "model-cache.yaml");
  try {
    const content = readFileSync(filePath, "utf8");
    const parsed = YAML.parse(content) as CachedModelFile;

    if (!parsed?.cachedAt || !Array.isArray(parsed.models) || parsed.models.length === 0) {
      return null;
    }

    const cachedAt = new Date(parsed.cachedAt).getTime();
    if (!Number.isFinite(cachedAt) || Date.now() - cachedAt > resolveCacheTtlMs()) {
      return null;
    }

    return parsed.models.map((m) => ({
      modelId: m.modelId,
      providerId: m.providerId,
      engine: m.engine,
      baseUrl: m.baseUrl,
      family: m.family,
      matchType: m.matchType,
      capabilities: m.capabilities,
      sampling: m.sampling,
      thinkingFormat: m.thinkingFormat,
      compat: m.compat ?? buildCompat(m.engine, m.thinkingFormat),
    }));
  } catch {
    return null;
  }
}

let cachedProfiles: MergedModelProfile[] = [];

export function setModelProfileCache(profiles: MergedModelProfile[]): void {
  cachedProfiles = profiles;
}

export function getModelProfileCache(): MergedModelProfile[] {
  return cachedProfiles;
}

export function findModelProfile(providerId: string, modelId: string): MergedModelProfile | undefined {
  return cachedProfiles.find((p) => p.providerId === providerId && p.modelId === modelId);
}

export function getSamplingPreset(providerId: string, modelId: string, presetName: string): SamplingPreset | undefined {
  const profile = findModelProfile(providerId, modelId);
  return profile?.sampling?.[presetName];
}
