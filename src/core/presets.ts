/**
 * Named boot presets stored in ~/.pancode/panpresets.yaml.
 *
 * Each preset defines orchestrator model, worker model, reasoning level,
 * and safety mode. The CLI flag --preset <name> applies a preset at boot.
 * The /preset command switches at runtime.
 *
 * The file is seeded with sensible defaults on first run and never
 * overwritten after that. Users edit it directly.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import YAML from "yaml";
import type { SafetyLevel } from "./config";
import { atomicWriteTextSync } from "./config-writer";
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
 * Build default presets from the three core model env vars. The local
 * preset seeds from PANCODE_MODEL/WORKER_MODEL/SCOUT_MODEL. OpenAI
 * presets seed as stubs (no model) because PanCode cannot guess the
 * user's API provider IDs. Users fill them in by editing panpresets.yaml.
 *
 * This function runs exactly once per install (when panpresets.yaml does
 * not exist). After seeding, panpresets.yaml is the source of truth.
 */
function buildDefaultPresets(): PresetFile {
  const model = process.env.PANCODE_MODEL ?? undefined;
  const worker = process.env.PANCODE_WORKER_MODEL ?? null;
  const scout = process.env.PANCODE_SCOUT_MODEL ?? null;

  return {
    local: {
      description: "Local inference via homelab engines",
      model,
      workerModel: worker,
      scoutModel: scout,
      reasoning: "medium",
      safety: "auto-edit",
    },
    openai: {
      description: "OpenAI (edit model IDs to match your subscription)",
      model: undefined,
      workerModel: null,
      scoutModel: null,
      reasoning: "medium",
      safety: "auto-edit",
    },
    "openai-max": {
      description: "OpenAI high reasoning (edit model IDs to match your subscription)",
      model: undefined,
      workerModel: null,
      scoutModel: null,
      reasoning: "high",
      safety: "full-auto",
    },
    hybrid: {
      description: "Local orchestrator with remote workers (edit worker model)",
      model,
      workerModel: null,
      scoutModel: scout,
      reasoning: "medium",
      safety: "auto-edit",
    },
  };
}

function presetsPath(pancodeHome: string): string {
  return join(pancodeHome, "panpresets.yaml");
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
 * Ensure panpresets.yaml exists. Seeds the default file on first run.
 * Never overwrites an existing file.
 */
export function ensurePresetsFile(pancodeHome: string): void {
  const filePath = presetsPath(pancodeHome);
  if (existsSync(filePath)) return;
  const header =
    "# PanCode boot presets. Use: pancode --preset <name>\n" +
    "# Edit freely. PanCode never overwrites this file after creation.\n\n";
  atomicWriteTextSync(filePath, header + YAML.stringify(buildDefaultPresets()));
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
    const trimmed = content.trim();
    if (!trimmed) return result;
    const raw = YAML.parse(trimmed) as PresetFile;
    if (typeof raw !== "object" || raw === null) return result;

    for (const [name, entry] of Object.entries(raw)) {
      if (typeof entry !== "object" || entry === null) continue;
      const parsed = parseEntry(name, entry as PresetFileEntry);
      if (parsed) result.set(name, parsed);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`[pancode:presets] Failed to parse ${filePath}: ${message}. Using empty preset list.\n`);
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
