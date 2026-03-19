import {
  resolvePackageRoot
} from "./chunk-RRR3VFYK.js";

// src/core/defaults.ts
var DEFAULT_PROMPT = "list files in the current directory";
var DEFAULT_TOOLS = "read,bash,grep,find,ls";
var DEFAULT_TIMEOUT_MS = 12e4;
var DEFAULT_PROFILE = "standard";
var DEFAULT_THEME = "pancode-dark";
var DEFAULT_SAFETY = "auto-edit";
var DEFAULT_REASONING_PREFERENCE = "on";
var DEFAULT_THINKING_LEVEL = "low";
var DEFAULT_ENABLED_DOMAINS = ["safety", "session", "agents", "dispatch", "observability", "scheduling", "ui"];

// src/core/thinking.ts
var THINKING_LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh"];
function parseThinkingLevel(value) {
  switch (value) {
    case "off":
    case "minimal":
    case "low":
    case "medium":
    case "high":
    case "xhigh":
      return value;
    default:
      return void 0;
  }
}
function parseReasoningPreference(value) {
  switch (value) {
    case "off":
    case "on":
      return value;
    default:
      return void 0;
  }
}
function reasoningPreferenceFromThinking(value) {
  const thinkingLevel = parseThinkingLevel(value);
  if (!thinkingLevel) return void 0;
  return thinkingLevel === "off" ? "off" : "on";
}
function getModelReasoningControl(model) {
  if (!model?.reasoning) return "none";
  if (model.compat?.supportsReasoningEffort === false) {
    if (model.compat.thinkingFormat === "qwen" || model.compat.thinkingFormat === "qwen-chat-template" || model.compat.thinkingFormat === "zai") {
      return "toggle";
    }
    return "none";
  }
  return "levels";
}
function resolveThinkingLevelForPreference(model, reasoningPreference) {
  if (reasoningPreference === "off") return "off";
  const control = getModelReasoningControl(model);
  if (control === "none") return "off";
  return DEFAULT_THINKING_LEVEL;
}

// src/core/config.ts
import { existsSync as existsSync2, readFileSync as readFileSync2 } from "fs";
import { resolve, join as join2 } from "path";

// src/core/settings-state.ts
import { existsSync, readFileSync } from "fs";
import { join } from "path";

// src/core/config-writer.ts
import { mkdirSync, renameSync, writeFileSync } from "fs";
import { dirname } from "path";
function writeTempFile(path, contents) {
  mkdirSync(dirname(path), { recursive: true });
  const tempPath = `${path}.tmp-${process.pid}-${Date.now()}`;
  writeFileSync(tempPath, contents, "utf8");
  return tempPath;
}
function atomicWriteTextSync(path, contents) {
  const tempPath = writeTempFile(path, contents);
  renameSync(tempPath, path);
}
function atomicWriteJsonSync(path, value) {
  atomicWriteTextSync(path, `${JSON.stringify(value, null, 2)}
`);
}

// src/core/settings-state.ts
var PANCODE_HOME = process.env.PANCODE_HOME;
var PANCODE_SETTINGS_PATH = join(PANCODE_HOME, "settings.json");
function normalizeOptionalString(value) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}
function normalizeTheme(value) {
  return normalizeOptionalString(value) ?? DEFAULT_THEME;
}
function normalizeReasoningPreference(value) {
  if (typeof value !== "string") return DEFAULT_REASONING_PREFERENCE;
  return parseReasoningPreference(value) ?? DEFAULT_REASONING_PREFERENCE;
}
function normalizeSettings(value) {
  const object = typeof value === "object" && value != null ? value : {};
  return {
    preferredProvider: normalizeOptionalString(object.preferredProvider),
    preferredModel: normalizeOptionalString(object.preferredModel),
    theme: normalizeTheme(object.theme),
    reasoningPreference: normalizeReasoningPreference(object.reasoningPreference)
  };
}
function loadPanCodeSettings() {
  if (!existsSync(PANCODE_SETTINGS_PATH)) {
    return normalizeSettings({});
  }
  try {
    const content = readFileSync(PANCODE_SETTINGS_PATH, "utf8");
    return normalizeSettings(JSON.parse(content));
  } catch {
    return normalizeSettings({});
  }
}
function writePanCodeSettings(settings) {
  const next = normalizeSettings({ ...loadPanCodeSettings(), ...settings });
  atomicWriteJsonSync(PANCODE_SETTINGS_PATH, next);
  return next;
}
function updatePanCodeSettings(settings) {
  return writePanCodeSettings(settings);
}

// src/core/config.ts
function normalizeEnvValue(value) {
  const trimmed = value?.trim() ?? "";
  return trimmed.length > 0 ? trimmed : null;
}
function getFirstEnvValue(...names) {
  for (const name of names) {
    const value = normalizeEnvValue(process.env[name]);
    if (value) return value;
  }
  return null;
}
function parseSafetyLevel(value) {
  switch (value) {
    case "suggest":
    case "auto-edit":
    case "full-auto":
      return value;
    default:
      return void 0;
  }
}
function parseTimeoutMs(value) {
  if (value == null || value === "") return DEFAULT_TIMEOUT_MS;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_TIMEOUT_MS;
  return parsed;
}
function readDefaultModelFile(packageRoot) {
  const defaultModelPath = join2(packageRoot, ".pancode", "default-model");
  if (!existsSync2(defaultModelPath)) return null;
  const value = readFileSync2(defaultModelPath, "utf8").split(/\r?\n/, 1)[0]?.trim() ?? "";
  return value.length > 0 ? value : null;
}
function loadConfig(overrides = {}) {
  const packageRoot = resolvePackageRoot(import.meta.url);
  const runtimeRoot = join2(packageRoot, ".pancode", "runtime");
  const settings = loadPanCodeSettings();
  const defaultModel = getFirstEnvValue("PANCODE_MODEL", "PANCODE_DEFAULT_MODEL") ?? readDefaultModelFile(packageRoot);
  const domains = [...overrides.domains ?? overrides.extensions ?? DEFAULT_ENABLED_DOMAINS];
  const reasoningPreference = overrides.reasoningPreference ?? parseReasoningPreference(getFirstEnvValue("PANCODE_REASONING")) ?? reasoningPreferenceFromThinking(getFirstEnvValue("PANCODE_THINKING")) ?? settings.reasoningPreference ?? DEFAULT_REASONING_PREFERENCE;
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
    timeoutMs: overrides.timeoutMs ?? parseTimeoutMs(process.env.PANCODE_TIMEOUT_MS ?? process.env.PANCODE_PHASE0_TIMEOUT_MS),
    runtimeRoot,
    resultsDir: join2(runtimeRoot, "results")
  };
}

// src/core/init.ts
import { mkdirSync as mkdirSync2 } from "fs";
function ensureProjectRuntime(config) {
  mkdirSync2(config.runtimeRoot, { recursive: true });
  mkdirSync2(config.resultsDir, { recursive: true });
}

export {
  DEFAULT_REASONING_PREFERENCE,
  atomicWriteJsonSync,
  THINKING_LEVELS,
  parseThinkingLevel,
  parseReasoningPreference,
  getModelReasoningControl,
  resolveThinkingLevelForPreference,
  updatePanCodeSettings,
  loadConfig,
  ensureProjectRuntime
};
//# sourceMappingURL=chunk-EN4IKIU3.js.map