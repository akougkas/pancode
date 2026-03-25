import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { SafetyLevel } from "./config";
import { atomicWriteJsonSync } from "./config-writer";
import { DEFAULT_REASONING_PREFERENCE, DEFAULT_SAFETY, DEFAULT_THEME } from "./defaults";
import { type PanCodeReasoningPreference, parseReasoningPreference } from "./thinking";
import { getDataDir } from "./xdg";

// ---------------------------------------------------------------------------
// New versioned settings schema (PanCodeGlobalSettings)
// ---------------------------------------------------------------------------

export interface PanCodeGlobalSettings {
  version: 1;

  onboarding: {
    completedAt: string | null;
    skippedAt: string | null;
    version: number;
  };

  models: {
    activePackId: string | null;
    modeDefaults: {
      admin: string | null;
      plan: string | null;
      build: string | null;
      review: string | null;
    };
    workerDefault: string | null;
    scoutDefault: string | null;
  };

  preferences: {
    theme: string;
    safetyMode: SafetyLevel;
    reasoningPreference: PanCodeReasoningPreference;
    budgetCeiling: number | null;
    intelligence: boolean;
  };

  providers: {
    discoveryEnabled: boolean;
    discoveryIntervalMs: number;
    discoveryTargets: string[];
  };

  modelUseCounts: Record<string, number>;
}

// ---------------------------------------------------------------------------
// Backward-compatible alias
//
// Legacy flat fields are populated by loadPanCodeSettings() so existing
// consumers (config.ts, config-service.ts) continue to compile and work.
// These flat fields will be removed in a future wave when all consumers
// migrate to nested access.
// ---------------------------------------------------------------------------

export type PanCodeSettings = PanCodeGlobalSettings & {
  preferredProvider: string | null;
  preferredModel: string | null;
  theme: string;
  reasoningPreference: PanCodeReasoningPreference;
  safetyMode: string | null;
  workerModel: string | null;
  budgetCeiling: number | null;
  intelligence: boolean | null;
};

// ---------------------------------------------------------------------------
// PANCODE_HOME (kept for backward compatibility with loader.ts and env readers)
// ---------------------------------------------------------------------------

function resolvePancodeHome(): string {
  const fromEnv = process.env.PANCODE_HOME?.trim();
  if (fromEnv && fromEnv.length > 0) return fromEnv;
  const fallback = join(homedir(), ".pancode");
  process.stderr.write(`[pancode:settings] PANCODE_HOME not set. Defaulting to ${fallback}\n`);
  process.env.PANCODE_HOME = fallback;
  return fallback;
}

// Must run before getDataDir() so the PANCODE_HOME env fallback is set.
export const PANCODE_HOME = resolvePancodeHome();
export const PANCODE_SETTINGS_PATH = join(getDataDir(), "settings.json");

// ---------------------------------------------------------------------------
// Normalization helpers
// ---------------------------------------------------------------------------

function normalizeOptionalString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeTheme(value: unknown): string {
  let raw = normalizeOptionalString(value) ?? DEFAULT_THEME;
  // Migrate old "pancode-dark" / "pancode-light" names to "dark" / "light".
  if (raw.startsWith("pancode-")) {
    raw = raw.slice("pancode-".length);
  }
  return raw;
}

function normalizeReasoningPreference(value: unknown): PanCodeReasoningPreference {
  if (typeof value !== "string") return DEFAULT_REASONING_PREFERENCE;
  return parseReasoningPreference(value) ?? DEFAULT_REASONING_PREFERENCE;
}

function normalizeOptionalNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  return null;
}

function normalizeOptionalBoolean(value: unknown): boolean | null {
  if (typeof value === "boolean") return value;
  return null;
}

function asSafetyLevel(value: unknown): SafetyLevel {
  if (value === "suggest" || value === "auto-edit" || value === "full-auto") return value;
  return DEFAULT_SAFETY;
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value != null ? (value as Record<string, unknown>) : {};
}

// ---------------------------------------------------------------------------
// Default settings factory
// ---------------------------------------------------------------------------

export function createDefaultSettings(): PanCodeGlobalSettings {
  return {
    version: 1,
    onboarding: { completedAt: null, skippedAt: null, version: 0 },
    models: {
      activePackId: null,
      modeDefaults: { admin: null, plan: null, build: null, review: null },
      workerDefault: null,
      scoutDefault: null,
    },
    preferences: {
      theme: DEFAULT_THEME,
      safetyMode: DEFAULT_SAFETY,
      reasoningPreference: DEFAULT_REASONING_PREFERENCE,
      budgetCeiling: null,
      intelligence: false,
    },
    providers: {
      discoveryEnabled: true,
      discoveryIntervalMs: 300_000,
      discoveryTargets: [],
    },
    modelUseCounts: {},
  };
}

// ---------------------------------------------------------------------------
// Normalize raw JSON into PanCodeSettings (nested + legacy flat fields)
// ---------------------------------------------------------------------------

function normalizeSettings(value: unknown): PanCodeSettings {
  const obj = typeof value === "object" && value != null ? (value as Record<string, unknown>) : {};
  if (obj.version === 1) return normalizeNewFormat(obj);
  return normalizeOldFormat(obj);
}

/** Normalize a version-1 (nested) settings object. Reads from nested sections only. */
function normalizeNewFormat(obj: Record<string, unknown>): PanCodeSettings {
  const defaults = createDefaultSettings();
  const onb = asRecord(obj.onboarding);
  const mdl = asRecord(obj.models);
  const md = asRecord(mdl.modeDefaults);
  const prefs = asRecord(obj.preferences);
  const prov = asRecord(obj.providers);

  const theme = normalizeTheme(prefs.theme);
  const safetyMode = asSafetyLevel(prefs.safetyMode);
  const reasoningPreference = normalizeReasoningPreference(prefs.reasoningPreference);
  const budgetCeiling = normalizeOptionalNumber(prefs.budgetCeiling);
  const intelligence = typeof prefs.intelligence === "boolean" ? prefs.intelligence : defaults.preferences.intelligence;

  const adminModel = normalizeOptionalString(md.admin);
  const workerDefault = normalizeOptionalString(mdl.workerDefault);

  return {
    version: 1,
    onboarding: {
      completedAt: typeof onb.completedAt === "string" ? onb.completedAt : null,
      skippedAt: typeof onb.skippedAt === "string" ? onb.skippedAt : null,
      version: typeof onb.version === "number" ? onb.version : 0,
    },
    models: {
      activePackId: normalizeOptionalString(mdl.activePackId),
      modeDefaults: {
        admin: adminModel,
        plan: normalizeOptionalString(md.plan),
        build: normalizeOptionalString(md.build),
        review: normalizeOptionalString(md.review),
      },
      workerDefault,
      scoutDefault: normalizeOptionalString(mdl.scoutDefault),
    },
    preferences: { theme, safetyMode, reasoningPreference, budgetCeiling, intelligence },
    providers: {
      discoveryEnabled:
        typeof prov.discoveryEnabled === "boolean" ? prov.discoveryEnabled : defaults.providers.discoveryEnabled,
      discoveryIntervalMs:
        typeof prov.discoveryIntervalMs === "number"
          ? prov.discoveryIntervalMs
          : defaults.providers.discoveryIntervalMs,
      discoveryTargets: Array.isArray(prov.discoveryTargets)
        ? prov.discoveryTargets
        : defaults.providers.discoveryTargets,
    },
    modelUseCounts:
      typeof obj.modelUseCounts === "object" && obj.modelUseCounts != null
        ? (obj.modelUseCounts as Record<string, number>)
        : {},
    // Legacy flat fields (mirrored from nested for backward compatibility)
    preferredProvider: normalizeOptionalString(obj.preferredProvider),
    preferredModel: adminModel,
    theme,
    reasoningPreference,
    safetyMode,
    workerModel: workerDefault,
    budgetCeiling,
    intelligence: normalizeOptionalBoolean(prefs.intelligence),
  };
}

/** Normalize a pre-v1 (flat) settings object. Maps flat fields into nested structure. */
function normalizeOldFormat(obj: Record<string, unknown>): PanCodeSettings {
  const preferredProvider = normalizeOptionalString(obj.preferredProvider);
  const preferredModel = normalizeOptionalString(obj.preferredModel);
  const theme = normalizeTheme(obj.theme);
  const reasoningPreference = normalizeReasoningPreference(obj.reasoningPreference);
  const safetyMode = asSafetyLevel(obj.safetyMode);
  const workerModel = normalizeOptionalString(obj.workerModel);
  const budgetCeiling = normalizeOptionalNumber(obj.budgetCeiling);
  const intelligence = normalizeOptionalBoolean(obj.intelligence);

  return {
    version: 1,
    onboarding: { completedAt: null, skippedAt: null, version: 0 },
    models: {
      activePackId: null,
      modeDefaults: { admin: preferredModel, plan: preferredModel, build: preferredModel, review: preferredModel },
      workerDefault: workerModel,
      scoutDefault: null,
    },
    preferences: {
      theme,
      safetyMode,
      reasoningPreference,
      budgetCeiling,
      intelligence: intelligence ?? false,
    },
    providers: { discoveryEnabled: true, discoveryIntervalMs: 300_000, discoveryTargets: [] },
    modelUseCounts: {},
    // Legacy flat fields
    preferredProvider,
    preferredModel,
    theme,
    reasoningPreference,
    safetyMode: normalizeOptionalString(obj.safetyMode),
    workerModel,
    budgetCeiling,
    intelligence,
  };
}

// ---------------------------------------------------------------------------
// Load / write
// ---------------------------------------------------------------------------

export function loadPanCodeSettings(): PanCodeSettings {
  if (!existsSync(PANCODE_SETTINGS_PATH)) {
    return normalizeSettings({});
  }

  try {
    const content = readFileSync(PANCODE_SETTINGS_PATH, "utf8");
    const trimmed = content.trim();
    if (!trimmed) return normalizeSettings({});
    return normalizeSettings(JSON.parse(trimmed));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`[pancode:settings] Failed to parse ${PANCODE_SETTINGS_PATH}: ${message}. Using defaults.\n`);
    return normalizeSettings({});
  }
}

export function writePanCodeSettings(settings: Partial<PanCodeSettings>): PanCodeSettings {
  const current = loadPanCodeSettings();

  // Deep-merge nested sections from current state.
  const onboarding = { ...current.onboarding, ...(settings.onboarding ?? {}) };
  const currentModeDefaults = { ...current.models.modeDefaults, ...(settings.models?.modeDefaults ?? {}) };
  const models = {
    ...current.models,
    ...(settings.models ?? {}),
    modeDefaults: currentModeDefaults,
  };
  const preferences = { ...current.preferences, ...(settings.preferences ?? {}) };
  const providers = { ...current.providers, ...(settings.providers ?? {}) };
  const modelUseCounts = { ...current.modelUseCounts, ...(settings.modelUseCounts ?? {}) };
  let preferredProvider = current.preferredProvider;

  // Apply legacy flat field patches to the nested structure so that existing
  // config-service callers (which pass flat keys) produce correct results.
  if ("theme" in settings) preferences.theme = normalizeTheme(settings.theme);
  if ("safetyMode" in settings) preferences.safetyMode = asSafetyLevel(settings.safetyMode);
  if ("reasoningPreference" in settings) {
    preferences.reasoningPreference = normalizeReasoningPreference(settings.reasoningPreference);
  }
  if ("budgetCeiling" in settings) preferences.budgetCeiling = normalizeOptionalNumber(settings.budgetCeiling);
  if ("intelligence" in settings && settings.intelligence != null) preferences.intelligence = settings.intelligence;
  if ("preferredModel" in settings) {
    const m = normalizeOptionalString(settings.preferredModel);
    models.modeDefaults = { admin: m, plan: m, build: m, review: m };
  }
  if ("workerModel" in settings) models.workerDefault = normalizeOptionalString(settings.workerModel);
  if ("preferredProvider" in settings) preferredProvider = normalizeOptionalString(settings.preferredProvider);

  const raw = { version: 1, onboarding, models, preferences, providers, modelUseCounts, preferredProvider };
  const next = normalizeSettings(raw);
  atomicWriteJsonSync(PANCODE_SETTINGS_PATH, next);
  return next;
}
