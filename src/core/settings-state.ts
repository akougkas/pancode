import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { atomicWriteJsonSync } from "./config-writer";
import { DEFAULT_REASONING_PREFERENCE, DEFAULT_THEME } from "./defaults";
import { type PanCodeReasoningPreference, parseReasoningPreference } from "./thinking";

export interface PanCodeSettings {
  preferredProvider: string | null;
  preferredModel: string | null;
  theme: string;
  reasoningPreference: PanCodeReasoningPreference;
  safetyMode: string | null;
  workerModel: string | null;
  budgetCeiling: number | null;
  intelligence: boolean | null;
}

// Set by loader.ts at boot
const pancodeHome = process.env.PANCODE_HOME;
if (!pancodeHome) {
  throw new Error("PANCODE_HOME must be set before loading settings-state");
}

export const PANCODE_HOME = pancodeHome;
export const PANCODE_SETTINGS_PATH = join(PANCODE_HOME, "settings.json");

function normalizeOptionalString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeTheme(value: unknown): string {
  return normalizeOptionalString(value) ?? DEFAULT_THEME;
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

function normalizeSettings(value: unknown): PanCodeSettings {
  const object = typeof value === "object" && value != null ? (value as Record<string, unknown>) : {};

  return {
    preferredProvider: normalizeOptionalString(object.preferredProvider),
    preferredModel: normalizeOptionalString(object.preferredModel),
    theme: normalizeTheme(object.theme),
    reasoningPreference: normalizeReasoningPreference(object.reasoningPreference),
    safetyMode: normalizeOptionalString(object.safetyMode),
    workerModel: normalizeOptionalString(object.workerModel),
    budgetCeiling: normalizeOptionalNumber(object.budgetCeiling),
    intelligence: normalizeOptionalBoolean(object.intelligence),
  };
}

export function loadPanCodeSettings(): PanCodeSettings {
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

export function writePanCodeSettings(settings: Partial<PanCodeSettings>): PanCodeSettings {
  const next = normalizeSettings({ ...loadPanCodeSettings(), ...settings });
  atomicWriteJsonSync(PANCODE_SETTINGS_PATH, next);
  return next;
}

export function updatePanCodeSettings(settings: Partial<PanCodeSettings>): PanCodeSettings {
  return writePanCodeSettings(settings);
}
