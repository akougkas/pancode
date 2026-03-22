/**
 * Named boot presets stored in ~/.pancode/presets.yaml.
 *
 * Each preset defines orchestrator model, worker model, reasoning level,
 * and safety mode. The CLI flag --preset <name> applies a preset at boot.
 * The /preset command switches at runtime.
 *
 * The file is seeded with sensible defaults on first run and never
 * overwritten after that. Users edit it directly.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import YAML from "yaml";
import type { SafetyLevel } from "./config";
import type { PanCodeReasoningPreference } from "./thinking";

export interface Preset {
  name: string;
  description: string;
  model: string;
  workerModel: string | null;
  scoutModel: string | null;
  reasoning: PanCodeReasoningPreference;
  safety: SafetyLevel;
}

interface PresetFileEntry {
  description?: string;
  model?: string;
  workerModel?: string | null;
  scoutModel?: string | null;
  reasoning?: string;
  safety?: string;
}

type PresetFile = Record<string, PresetFileEntry>;

/**
 * Build default presets from environment variables. Model IDs are never
 * hardcoded in source. The .env file is the single source of truth for
 * all model assignments. Presets read from env at seed time so the
 * generated presets.yaml reflects the user's actual environment.
 */
function buildDefaultPresets(): PresetFile {
  const localModel = process.env.PANCODE_LOCAL_MODEL ?? process.env.PANCODE_MODEL ?? "";
  const localWorker = process.env.PANCODE_LOCAL_WORKER_MODEL ?? process.env.PANCODE_WORKER_MODEL ?? null;
  const localScout = process.env.PANCODE_LOCAL_SCOUT_MODEL ?? process.env.PANCODE_SCOUT_MODEL ?? null;
  const openaiModel = process.env.PANCODE_OPENAI_MODEL ?? "";
  const openaiWorker = process.env.PANCODE_OPENAI_WORKER_MODEL ?? null;
  const openaiScout = process.env.PANCODE_OPENAI_SCOUT_MODEL ?? null;
  const openaiMaxModel = process.env.PANCODE_OPENAI_MAX_MODEL ?? openaiModel;
  const openaiMaxWorker = process.env.PANCODE_OPENAI_MAX_WORKER_MODEL ?? null;
  const openaiMaxScout = process.env.PANCODE_OPENAI_MAX_SCOUT_MODEL ?? openaiScout;

  return {
    local: {
      description: "Local inference via homelab engines",
      model: localModel || undefined,
      workerModel: localWorker,
      scoutModel: localScout,
      reasoning: "medium",
      safety: "auto-edit",
    },
    openai: {
      description: "OpenAI Codex (orchestrator + workers)",
      model: openaiModel || undefined,
      workerModel: openaiWorker,
      scoutModel: openaiScout,
      reasoning: "medium",
      safety: "auto-edit",
    },
    "openai-max": {
      description: "OpenAI Codex with high reasoning for deep analysis",
      model: openaiMaxModel || undefined,
      workerModel: openaiMaxWorker,
      scoutModel: openaiMaxScout,
      reasoning: "high",
      safety: "full-auto",
    },
    hybrid: {
      description: "Local orchestrator with OpenAI workers",
      model: localModel || undefined,
      workerModel: openaiWorker,
      scoutModel: localScout,
      reasoning: "medium",
      safety: "auto-edit",
    },
  };
}

function presetsPath(pancodeHome: string): string {
  return join(pancodeHome, "presets.yaml");
}

function isValidSafety(value: unknown): value is SafetyLevel {
  return value === "suggest" || value === "auto-edit" || value === "full-auto";
}

function isValidReasoning(value: unknown): value is PanCodeReasoningPreference {
  return (
    value === "off" ||
    value === "minimal" ||
    value === "low" ||
    value === "medium" ||
    value === "high" ||
    value === "xhigh"
  );
}

function parseEntry(name: string, entry: PresetFileEntry): Preset | null {
  if (!entry.model || typeof entry.model !== "string") return null;
  return {
    name,
    description: entry.description ?? name,
    model: entry.model,
    workerModel: typeof entry.workerModel === "string" ? entry.workerModel : null,
    scoutModel: typeof entry.scoutModel === "string" ? entry.scoutModel : null,
    reasoning: isValidReasoning(entry.reasoning) ? entry.reasoning : "medium",
    safety: isValidSafety(entry.safety) ? entry.safety : "auto-edit",
  };
}

/**
 * Ensure presets.yaml exists. Seeds the default file on first run.
 * Never overwrites an existing file.
 */
export function ensurePresetsFile(pancodeHome: string): void {
  const filePath = presetsPath(pancodeHome);
  if (existsSync(filePath)) return;
  mkdirSync(dirname(filePath), { recursive: true });
  const header =
    "# PanCode boot presets. Use: pancode --preset <name>\n" +
    "# Edit freely. PanCode never overwrites this file after creation.\n\n";
  writeFileSync(filePath, header + YAML.stringify(buildDefaultPresets()), "utf8");
}

/**
 * Load all presets from disk. Returns an empty map if the file is missing or malformed.
 */
export function loadPresets(pancodeHome: string): Map<string, Preset> {
  const filePath = presetsPath(pancodeHome);
  const result = new Map<string, Preset>();
  if (!existsSync(filePath)) return result;

  try {
    const content = readFileSync(filePath, "utf8");
    const raw = YAML.parse(content) as PresetFile;
    if (typeof raw !== "object" || raw === null) return result;

    for (const [name, entry] of Object.entries(raw)) {
      if (typeof entry !== "object" || entry === null) continue;
      const parsed = parseEntry(name, entry as PresetFileEntry);
      if (parsed) result.set(name, parsed);
    }
  } catch {
    // Malformed YAML: return empty. User will see a boot warning.
  }

  return result;
}

/**
 * Load a single preset by name. Returns null if not found.
 */
export function loadPreset(pancodeHome: string, name: string): Preset | null {
  return loadPresets(pancodeHome).get(name) ?? null;
}

/**
 * List all available preset names.
 */
export function listPresetNames(pancodeHome: string): string[] {
  return [...loadPresets(pancodeHome).keys()];
}
