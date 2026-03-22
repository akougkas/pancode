import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  DEFAULT_ENABLED_DOMAINS,
  DEFAULT_PROFILE,
  DEFAULT_PROMPT,
  DEFAULT_REASONING_PREFERENCE,
  DEFAULT_SAFETY,
  DEFAULT_THEME,
  DEFAULT_TIMEOUT_MS,
  DEFAULT_TOOLS,
} from "./defaults";
import { resolvePackageRoot } from "./package-root";
import { loadPanCodeSettings } from "./settings-state";
import { type PanCodeReasoningPreference, parseReasoningPreference, reasoningPreferenceFromThinking } from "./thinking";

export type SafetyLevel = "suggest" | "auto-edit" | "full-auto";

function normalizeEnvValue(value: string | undefined): string | null {
  const trimmed = value?.trim() ?? "";
  return trimmed.length > 0 ? trimmed : null;
}

function getFirstEnvValue(...names: string[]): string | null {
  for (const name of names) {
    const value = normalizeEnvValue(process.env[name]);
    if (value) return value;
  }
  return null;
}

function parseSafetyLevel(value: string | null | undefined): SafetyLevel | undefined {
  switch (value) {
    case "suggest":
    case "auto-edit":
    case "full-auto":
      return value;
    default:
      return undefined;
  }
}

export interface PanCodeConfig {
  packageRoot: string;
  cwd: string;
  profile: string;
  // Enabled PanCode domain names. The domain loader resolves them to inline Pi extensions.
  domains: string[];
  // Backward-compatible alias for earlier config shape. Kept equal to domains for now.
  extensions: string[];
  safety: SafetyLevel;
  reasoningPreference: PanCodeReasoningPreference;
  theme: string;
  prompt: string;
  provider: string | null;
  model: string | null;
  preferredProvider: string | null;
  preferredModel: string | null;
  tools: string;
  timeoutMs: number;
  runtimeRoot: string;
  resultsDir: string;
}

interface ConfigOverrides {
  cwd?: string;
  profile?: string;
  domains?: string[];
  extensions?: string[];
  safety?: SafetyLevel;
  reasoningPreference?: PanCodeReasoningPreference;
  theme?: string;
  prompt?: string;
  provider?: string | null;
  model?: string | null;
  tools?: string;
  timeoutMs?: number;
}

function parseTimeoutMs(value: string | undefined): number {
  if (value == null || value === "") return DEFAULT_TIMEOUT_MS;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_TIMEOUT_MS;
  return parsed;
}

function readDefaultModelFile(packageRoot: string): string | null {
  const defaultModelPath = join(packageRoot, ".pancode", "default-model");
  if (!existsSync(defaultModelPath)) return null;

  const value = readFileSync(defaultModelPath, "utf8").split(/\r?\n/, 1)[0]?.trim() ?? "";
  return value.length > 0 ? value : null;
}

// ---------------------------------------------------------------------------
// Persistence model
// ---------------------------------------------------------------------------
// ~/.pancode/ holds user configuration that survives reinstall:
//   panpresets.yaml, panagents.yaml, panproviders.yaml, settings.json,
//   model-cache.yaml, and agent-engine/auth.json.
//
// <project>/.pancode/ holds per-project runtime state:
//   runs.json, metrics.json, budget.json, tasks.json, and the runtime/
//   subdirectory (board.json, worker-*.result.json).
//
// ~/.pancode/agent-engine/sessions/ holds Pi SDK session history.
//
// "pancode reset" or the "--fresh" boot flag clears all runtime state
// (project-local and sessions) while preserving user configuration.
// ---------------------------------------------------------------------------

export function loadConfig(overrides: ConfigOverrides = {}): PanCodeConfig {
  const packageRoot = resolvePackageRoot(import.meta.url);
  const runtimeRoot = join(packageRoot, ".pancode", "runtime");
  const settings = loadPanCodeSettings();
  const defaultModel = getFirstEnvValue("PANCODE_MODEL", "PANCODE_DEFAULT_MODEL") ?? readDefaultModelFile(packageRoot);
  const domains = [...(overrides.domains ?? overrides.extensions ?? DEFAULT_ENABLED_DOMAINS)];
  const reasoningPreference =
    overrides.reasoningPreference ??
    parseReasoningPreference(getFirstEnvValue("PANCODE_REASONING")) ??
    reasoningPreferenceFromThinking(getFirstEnvValue("PANCODE_THINKING")) ??
    settings.reasoningPreference ??
    DEFAULT_REASONING_PREFERENCE;

  return {
    packageRoot,
    cwd: resolve(packageRoot, overrides.cwd ?? getFirstEnvValue("PANCODE_PROJECT") ?? "."),
    profile: overrides.profile ?? getFirstEnvValue("PANCODE_PROFILE") ?? DEFAULT_PROFILE,
    domains,
    extensions: [...domains],
    safety: overrides.safety ?? parseSafetyLevel(getFirstEnvValue("PANCODE_SAFETY")) ?? DEFAULT_SAFETY,
    reasoningPreference,
    theme: overrides.theme ?? getFirstEnvValue("PANCODE_THEME") ?? settings.theme ?? DEFAULT_THEME,
    prompt: overrides.prompt ?? getFirstEnvValue("PANCODE_PROMPT", "PANCODE_PHASE0_PROMPT") ?? DEFAULT_PROMPT,
    provider: overrides.provider ?? getFirstEnvValue("PANCODE_PROVIDER"),
    model: overrides.model ?? getFirstEnvValue("PANCODE_MODEL", "PANCODE_DEFAULT_MODEL") ?? defaultModel ?? null,
    preferredProvider: settings.preferredProvider,
    preferredModel: settings.preferredModel,
    tools: overrides.tools ?? getFirstEnvValue("PANCODE_TOOLS", "PANCODE_PHASE0_TOOLS") ?? DEFAULT_TOOLS,
    timeoutMs: overrides.timeoutMs ?? parseTimeoutMs(process.env.PANCODE_TIMEOUT_MS),
    runtimeRoot,
    resultsDir: join(runtimeRoot, "results"),
  };
}
