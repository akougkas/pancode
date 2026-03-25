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
// XDG dirs hold user configuration that survives reinstall:
//   $DATA_DIR/settings.json, $CONFIG_DIR/panpresets.yaml, panagents.yaml,
//   $CACHE_DIR/panproviders.yaml, panmodels.yaml, $DATA_DIR/agent-engine/.
//
// <project>/.pancode/ holds per-project state, config, and results:
//   config/settings.json        Project-level overrides
//   state/                      board, runs, metrics, budget, tasks
//   results/                    worker-*.result.json
//
// $DATA_DIR/agent-engine/sessions/ holds Pi SDK session history.
//
// "pancode reset" or the "--fresh" boot flag clears state/ and results/
// while preserving config/ and user configuration.
//
// Config resolution order (highest priority first):
//   runtime overrides (/settings) > env vars (PANCODE_*) >
//   project config (.pancode/config/settings.json) > global config
//   ($DATA_DIR/settings.json) > defaults (src/core/defaults.ts)
// ---------------------------------------------------------------------------

/**
 * Load project-level settings from <cwd>/.pancode/config/settings.json.
 * Returns an empty object if the file is missing, empty, or corrupt.
 * Corrupt files produce a warning on stderr.
 */
function loadProjectSettingsFile(projectRoot: string): Record<string, unknown> {
  const settingsPath = join(projectRoot, ".pancode", "config", "settings.json");
  if (!existsSync(settingsPath)) return {};

  try {
    const content = readFileSync(settingsPath, "utf8").trim();
    if (!content) return {};
    const parsed = JSON.parse(content);
    if (typeof parsed !== "object" || parsed === null) return {};
    return parsed as Record<string, unknown>;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`[pancode:config] Failed to parse project settings ${settingsPath}: ${message}. Skipping.\n`);
    return {};
  }
}

export function loadConfig(overrides: ConfigOverrides = {}): PanCodeConfig {
  const packageRoot = resolvePackageRoot(import.meta.url);
  const globalSettings = loadPanCodeSettings();
  const cwd = resolve(packageRoot, overrides.cwd ?? getFirstEnvValue("PANCODE_PROJECT") ?? ".");
  if (!existsSync(cwd)) {
    process.stderr.write(`[pancode] Fatal: Working directory "${cwd}" does not exist.\n`);
    process.exit(1);
  }
  const runtimeRoot = join(cwd, ".pancode", "state");
  const projectSettings = loadProjectSettingsFile(cwd);
  const defaultModel = getFirstEnvValue("PANCODE_MODEL", "PANCODE_DEFAULT_MODEL") ?? readDefaultModelFile(packageRoot);
  const domains = [...(overrides.domains ?? overrides.extensions ?? DEFAULT_ENABLED_DOMAINS)];

  // Extract project-level overrides (typed).
  const projectTheme =
    typeof projectSettings.theme === "string" && projectSettings.theme.trim()
      ? projectSettings.theme.trim()
      : undefined;
  const projectSafetyMode = parseSafetyLevel(
    typeof projectSettings.safetyMode === "string" ? projectSettings.safetyMode : undefined,
  );
  const projectReasoningPreference =
    typeof projectSettings.reasoningPreference === "string"
      ? parseReasoningPreference(projectSettings.reasoningPreference)
      : undefined;
  const projectPreferredProvider =
    typeof projectSettings.preferredProvider === "string" ? projectSettings.preferredProvider : undefined;
  const projectPreferredModel =
    typeof projectSettings.preferredModel === "string" ? projectSettings.preferredModel : undefined;

  // Resolution order: overrides > env > project > global > defaults
  const reasoningPreference =
    overrides.reasoningPreference ??
    parseReasoningPreference(getFirstEnvValue("PANCODE_REASONING")) ??
    reasoningPreferenceFromThinking(getFirstEnvValue("PANCODE_THINKING")) ??
    projectReasoningPreference ??
    globalSettings.reasoningPreference ??
    DEFAULT_REASONING_PREFERENCE;

  return {
    packageRoot,
    cwd,
    profile: overrides.profile ?? getFirstEnvValue("PANCODE_PROFILE") ?? DEFAULT_PROFILE,
    domains,
    extensions: [...domains],
    safety:
      overrides.safety ??
      parseSafetyLevel(getFirstEnvValue("PANCODE_SAFETY")) ??
      projectSafetyMode ??
      parseSafetyLevel(globalSettings.safetyMode) ??
      DEFAULT_SAFETY,
    reasoningPreference,
    theme:
      overrides.theme ?? getFirstEnvValue("PANCODE_THEME") ?? projectTheme ?? globalSettings.theme ?? DEFAULT_THEME,
    prompt: overrides.prompt ?? getFirstEnvValue("PANCODE_PROMPT", "PANCODE_PHASE0_PROMPT") ?? DEFAULT_PROMPT,
    provider: overrides.provider ?? getFirstEnvValue("PANCODE_PROVIDER"),
    model: overrides.model ?? getFirstEnvValue("PANCODE_MODEL", "PANCODE_DEFAULT_MODEL") ?? defaultModel ?? null,
    preferredProvider: projectPreferredProvider ?? globalSettings.preferredProvider,
    preferredModel: projectPreferredModel ?? globalSettings.preferredModel,
    tools: overrides.tools ?? getFirstEnvValue("PANCODE_TOOLS", "PANCODE_PHASE0_TOOLS") ?? DEFAULT_TOOLS,
    timeoutMs: overrides.timeoutMs ?? parseTimeoutMs(process.env.PANCODE_TIMEOUT_MS),
    runtimeRoot,
    resultsDir: join(cwd, ".pancode", "results"),
  };
}
