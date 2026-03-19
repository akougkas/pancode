import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { PanCodeConfig } from "../../core/config";
import { AuthStorage, ModelRegistry } from "../../engine/session";
import type { Api, Model } from "../../engine/types";

export interface SharedAuth {
  agentDir: string;
  authStorage: ReturnType<typeof AuthStorage.create>;
  modelRegistry: InstanceType<typeof ModelRegistry>;
}

// Set by loader.ts at boot
const pancodeHome = process.env.PANCODE_HOME;
if (!pancodeHome) {
  throw new Error("PANCODE_HOME must be set before loading providers/shared");
}

export const PANCODE_HOME = pancodeHome;
export const PANCODE_AGENT_DIR = join(PANCODE_HOME, "agent-engine");

function copyLegacyFileIfMissing(fileName: string): void {
  const legacyPiDir = join(homedir(), ".pi", "agent");
  const sourcePath = join(legacyPiDir, fileName);
  const targetPath = join(PANCODE_AGENT_DIR, fileName);
  if (existsSync(sourcePath) && !existsSync(targetPath)) {
    copyFileSync(sourcePath, targetPath);
  }
}

export async function createSharedAuth(): Promise<SharedAuth> {
  mkdirSync(PANCODE_AGENT_DIR, { recursive: true });
  copyLegacyFileIfMissing("auth.json");
  copyLegacyFileIfMissing("models.json");
  copyLegacyFileIfMissing("settings.json");

  process.env.PI_CODING_AGENT_DIR = PANCODE_AGENT_DIR;

  const authStorage = AuthStorage.create(join(PANCODE_AGENT_DIR, "auth.json"));
  const modelRegistry = new ModelRegistry(authStorage, join(PANCODE_AGENT_DIR, "models.json"));

  return {
    agentDir: PANCODE_AGENT_DIR,
    authStorage,
    modelRegistry,
  };
}

export function buildModelArgs(config: Pick<PanCodeConfig, "provider" | "model">): string[] {
  const args: string[] = [];
  if (config.provider) args.push("--provider", config.provider);
  if (config.model) args.push("--model", config.model);
  return args;
}

const TIER1_HINTS: RegExp[] = [/\bopus\b/i, /\bo[3-9]\b/i];
const TIER2_HINTS: RegExp[] = [/\b(pro|max|ultra|sonnet|reasoning|large|turbo)\b/i, /\bgpt-(5|4\.1)\b/i, /\bo[1-2]\b/i];
const LOW_CAPABILITY_HINTS: RegExp[] = [/\b(flash|haiku|mini|nano|lite|small|fast|economy|instant|quick)\b/i];
const UNSTABLE_HINTS: RegExp[] = [/\b(preview|beta|experimental|exp)\b/i];
const PREFERRED_PROVIDERS = ["anthropic", "openai", "openai-responses", "openai-codex"];

function normalizeModelRef(model: string | null | undefined, provider: string | null | undefined): string | undefined {
  if (!model) return undefined;
  if (model.includes("/")) return model;
  return provider ? `${provider}/${model}` : undefined;
}

function modelCapabilityScore(provider: string, id: string): number {
  const label = `${provider}/${id}`;
  let score = 0;

  if (TIER1_HINTS.some((hint) => hint.test(label))) score = 30;
  else if (TIER2_HINTS.some((hint) => hint.test(label))) score = 20;

  for (const hint of LOW_CAPABILITY_HINTS) {
    if (hint.test(label)) score -= 25;
  }
  for (const hint of UNSTABLE_HINTS) {
    if (hint.test(label)) score -= 6;
  }
  if (PREFERRED_PROVIDERS.includes(provider)) score += 2;

  return score;
}

function modelVersionVector(id: string): number[] {
  const matches = id.match(/\d+/g);
  if (!matches) return [];
  return matches
    .map((value) => Number.parseInt(value, 10))
    .filter((value) => Number.isFinite(value))
    .slice(0, 6);
}

function compareVersionVectorsDesc(a: number[], b: number[]): number {
  const maxLength = Math.max(a.length, b.length);
  for (let index = 0; index < maxLength; index += 1) {
    const left = a[index] ?? -1;
    const right = b[index] ?? -1;
    if (left !== right) return right - left;
  }
  return 0;
}

function comparePreferredModels(a: Model<Api>, b: Model<Api>): number {
  const capabilityDiff = modelCapabilityScore(b.provider, b.id) - modelCapabilityScore(a.provider, a.id);
  if (capabilityDiff !== 0) return capabilityDiff;

  const versionDiff = compareVersionVectorsDesc(modelVersionVector(a.id), modelVersionVector(b.id));
  if (versionDiff !== 0) return versionDiff;

  return `${a.provider}/${a.id}`.localeCompare(`${b.provider}/${b.id}`);
}

function selectPreferredModel(available: Array<Model<Api>>): Model<Api> {
  if (available.length === 0) {
    throw new Error("No authenticated models are available. Authenticate a provider or set an explicit model.");
  }
  return [...available].sort(comparePreferredModels)[0];
}

export function resolveModel(
  modelRegistry: InstanceType<typeof ModelRegistry>,
  options: { provider?: string | null; model?: string | null } = {},
): Model<Api> {
  const modelRef = normalizeModelRef(options.model, options.provider);

  if (modelRef) {
    const slashIndex = modelRef.indexOf("/");
    if (slashIndex === -1) {
      throw new Error(`Invalid model "${modelRef}". Expected "provider/model-id".`);
    }

    const provider = modelRef.slice(0, slashIndex);
    const modelId = modelRef.slice(slashIndex + 1);
    const allModels = modelRegistry.getAll();
    const exists = allModels.some((model) => model.provider === provider && model.id === modelId);
    if (!exists) {
      throw new Error(`Model "${modelRef}" was not found in the registry.`);
    }

    const resolved = modelRegistry.find(provider, modelId);
    if (resolved) return resolved;

    const providerHasAuth = modelRegistry.getAvailable().some((model) => model.provider === provider);
    if (!providerHasAuth) {
      throw new Error(`Model "${modelRef}" exists but provider "${provider}" has no authentication.`);
    }
    throw new Error(`Model "${modelRef}" exists but is not currently available.`);
  }

  if (options.provider) {
    const providerModels = modelRegistry.getAvailable().filter((model) => model.provider === options.provider);
    if (providerModels.length > 0) return selectPreferredModel(providerModels);

    const providerExists = modelRegistry.getAll().some((model) => model.provider === options.provider);
    if (!providerExists) {
      throw new Error(`Provider "${options.provider}" is not registered.`);
    }
    throw new Error(`Provider "${options.provider}" has no authenticated models.`);
  }

  return selectPreferredModel(modelRegistry.getAvailable());
}

export function resolveConfiguredModel(
  modelRegistry: InstanceType<typeof ModelRegistry>,
  options: {
    provider?: string | null;
    model?: string | null;
    preferredProvider?: string | null;
    preferredModel?: string | null;
  } = {},
): Model<Api> {
  if (options.provider || options.model) {
    return resolveModel(modelRegistry, {
      provider: options.provider,
      model: options.model,
    });
  }

  if (options.preferredProvider || options.preferredModel) {
    try {
      return resolveModel(modelRegistry, {
        provider: options.preferredProvider,
        model: options.preferredModel,
      });
    } catch {
      // Fall back to auto-selection when persisted preferences no longer exist.
    }
  }

  return resolveModel(modelRegistry, {});
}
