/**
 * ConfigService: read, validate, apply, and undo PanCode configuration.
 *
 * Reads live state from process.env and settings-state. Writes to process.env
 * for hot-reload params and persists to ~/.pancode/settings.json for durable changes.
 *
 * After each successful apply, the service calls subsystem-specific handlers
 * (budget, mode, safety, reasoning, models) and emits CONFIG_CHANGED on the
 * shared bus so the UI extension and other subscribers can react.
 */

import { BusChannel } from "../../core/bus-events";
import { type OrchestratorMode, getCurrentMode, getModeDefinition, setCurrentMode } from "../../core/modes";
import type { PanCodeSettings } from "../../core/settings-state";
import { writePanCodeSettings } from "../../core/settings-state";
import { sharedBus } from "../../core/shared-bus";
import { type PanCodeReasoningPreference, resolveThinkingLevelForPreference } from "../../core/thinking";
import { getBudgetTracker } from "../scheduling";
import { CONFIG_SCHEMA, type ConfigParamDef, getParamDef } from "./config-schema";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface ConfigParam {
  key: string;
  currentValue: unknown;
  defaultValue: unknown;
  type: "string" | "number" | "boolean" | "enum" | "array";
  options?: string[];
  description: string;
  hotReload: boolean;
  adminOnly: boolean;
  domain: string;
}

export interface ConfigChangeResult {
  success: boolean;
  key: string;
  previousValue: unknown;
  newValue: unknown;
  requiresRestart: boolean;
  message: string;
}

// ---------------------------------------------------------------------------
// Value resolution: read current value from process.env or mode state
// ---------------------------------------------------------------------------

function readCurrentValue(def: ConfigParamDef): unknown {
  if (def.key === "runtime.mode") {
    return getCurrentMode();
  }

  if (!def.envVar) return def.defaultValue;

  const raw = process.env[def.envVar];

  if (def.type === "boolean") {
    if (raw === "true" || raw === "enabled") return true;
    if (raw === "false" || raw === "disabled") return false;
    return def.defaultValue;
  }

  if (def.type === "number") {
    if (raw != null) {
      const num = Number.parseFloat(raw);
      if (Number.isFinite(num)) return num;
    }
    return def.defaultValue;
  }

  // String and enum params
  const trimmed = raw?.trim();
  if (trimmed != null && trimmed.length > 0) return trimmed;
  return def.defaultValue;
}

function toConfigParam(def: ConfigParamDef): ConfigParam {
  return {
    key: def.key,
    currentValue: readCurrentValue(def),
    defaultValue: def.defaultValue,
    type: def.type,
    ...(def.options && { options: def.options }),
    description: def.description,
    hotReload: def.hotReload,
    adminOnly: def.adminOnly,
    domain: def.domain,
  };
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

function validateValue(def: ConfigParamDef, value: unknown): string | null {
  switch (def.type) {
    case "enum": {
      if (typeof value !== "string") return `Expected a string, got ${typeof value}.`;
      if (def.options && !def.options.includes(value)) {
        return `Invalid value "${value}". Valid options: ${def.options.join(", ")}.`;
      }
      return null;
    }
    case "boolean": {
      if (typeof value !== "boolean" && typeof value !== "string") {
        return `Expected boolean, got ${typeof value}.`;
      }
      return null;
    }
    case "number": {
      const num = typeof value === "number" ? value : Number.parseFloat(String(value));
      if (!Number.isFinite(num)) return `Expected a finite number, got "${value}".`;
      if (num < 0) return "Value must be non-negative.";
      return null;
    }
    case "string": {
      if (typeof value !== "string") return `Expected a string, got ${typeof value}.`;
      return null;
    }
    case "array": {
      if (!Array.isArray(value)) return `Expected an array, got ${typeof value}.`;
      return null;
    }
    default:
      return null;
  }
}

/** Normalize input to the param's expected type. */
function coerceValue(def: ConfigParamDef, value: unknown): unknown {
  if (def.type === "number") {
    return typeof value === "number" ? value : Number.parseFloat(String(value));
  }
  if (def.type === "boolean") {
    if (typeof value === "boolean") return value;
    const s = String(value).toLowerCase();
    return s === "true" || s === "on" || s === "enabled" || s === "1";
  }
  return value;
}

// ---------------------------------------------------------------------------
// Apply logic: write to env and optionally persist to settings.json
// ---------------------------------------------------------------------------

function applyToEnv(def: ConfigParamDef, coerced: unknown): void {
  if (def.key === "runtime.mode") {
    setCurrentMode(coerced as OrchestratorMode);
    return;
  }

  if (def.envVar) {
    process.env[def.envVar] = String(coerced);
  }
}

function persistToDisk(def: ConfigParamDef, coerced: unknown): void {
  if (!def.settingsKey) return;
  const patch: Partial<PanCodeSettings> = {};
  (patch as Record<string, unknown>)[def.settingsKey] = coerced;
  writePanCodeSettings(patch);
}

function safePersist(def: ConfigParamDef, coerced: unknown, context: string): void {
  try {
    persistToDisk(def, coerced);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[pancode:panconfigure] Failed to persist ${context}: ${msg}`);
  }
}

// ---------------------------------------------------------------------------
// Subsystem apply handlers
//
// Each handler performs the subsystem-specific side effects that go beyond
// setting an env var. The generic applyToEnv/persistToDisk always runs first;
// these handlers run after to propagate changes to live subsystems.
// ---------------------------------------------------------------------------

function applyMode(value: string): void {
  // setCurrentMode is already called by applyToEnv.
  // Validate the mode definition exists (guards against future mismatches).
  getModeDefinition(value as OrchestratorMode);
  // The UI extension subscribes to CONFIG_CHANGED to call pi.setActiveTools()
  // and emitModeTransition(). ConfigService cannot call Pi SDK methods directly.
}

function applyReasoning(value: string): void {
  // process.env.PANCODE_REASONING is set by applyToEnv.
  // Also compute and set the effective thinking level for downstream consumers.
  // The model reference is not available here, so pass null (uses capability defaults).
  const effective = resolveThinkingLevelForPreference(null, value as PanCodeReasoningPreference);
  process.env.PANCODE_EFFECTIVE_THINKING = effective;
  // The UI extension subscribes to CONFIG_CHANGED to call pi.setThinkingLevel()
  // with the actual model reference for accurate clamping.
}

function applyBudgetCeiling(value: number): void {
  const tracker = getBudgetTracker();
  if (tracker) {
    tracker.setCeiling(value);
    // Publish updated budget state on the bus so the footer refreshes.
    const state = tracker.getState();
    sharedBus.emit(BusChannel.BUDGET_UPDATED, {
      totalCost: state.totalCost,
      ceiling: state.ceiling,
      runsCount: state.runsCount,
      totalInputTokens: state.totalInputTokens,
      totalOutputTokens: state.totalOutputTokens,
    });
  }
}

/** Map of config keys to subsystem apply handlers. */
const applyHandlers: Record<string, (value: unknown) => void> = {
  "runtime.safety": () => {
    // process.env.PANCODE_SAFETY is set by applyToEnv.
    // UI extension subscribes to CONFIG_CHANGED to sync editor display.
  },
  "runtime.mode": (v) => applyMode(v as string),
  "runtime.reasoning": (v) => applyReasoning(v as string),
  "budget.ceiling": (v) => applyBudgetCeiling(v as number),
  // models.orchestrator: hotReload=false, handled by requiresRestart flag
  // models.worker: env var set by applyToEnv, takes effect on next dispatch
  // models.scout: env var set by applyToEnv, takes effect on next scout spawn
  // runtime.theme: env var set by applyToEnv, UI subscribes to CONFIG_CHANGED
  // dispatch.*: env vars set by applyToEnv, take effect on next worker spawn
};

// ---------------------------------------------------------------------------
// Undo state
// ---------------------------------------------------------------------------

interface UndoRecord {
  def: ConfigParamDef;
  previousValue: unknown;
}

let lastChange: UndoRecord | null = null;

// ---------------------------------------------------------------------------
// ConfigService
// ---------------------------------------------------------------------------

function failResult(key: string, message: string, previousValue?: unknown, newValue?: unknown): ConfigChangeResult {
  return { success: false, key, previousValue, newValue, requiresRestart: false, message };
}

export class ConfigService {
  /** Read config state, optionally filtered by domain. */
  read(domain?: string): ConfigParam[] {
    const defs = domain ? CONFIG_SCHEMA.filter((d) => d.domain === domain) : CONFIG_SCHEMA;
    return defs.map(toConfigParam);
  }

  /** Apply a config change with validation and subsystem wiring. */
  apply(key: string, value: unknown): ConfigChangeResult {
    const def = getParamDef(key);
    if (!def) {
      return failResult(key, `Unknown config key: "${key}".`, undefined, value);
    }

    const validationError = validateValue(def, value);
    if (validationError) {
      return failResult(key, validationError, readCurrentValue(def), value);
    }

    const previousValue = readCurrentValue(def);
    const coerced = coerceValue(def, value);

    // Write to env / in-memory state
    applyToEnv(def, coerced);

    // Persist to disk
    safePersist(def, coerced, key);

    // Run subsystem-specific handler if one exists
    const handler = applyHandlers[key];
    if (handler) {
      handler(coerced);
    }

    // Store undo record
    lastChange = { def, previousValue };

    // Emit CONFIG_CHANGED so UI and other domains can react
    sharedBus.emit(BusChannel.CONFIG_CHANGED, { key, previousValue, newValue: coerced });

    const requiresRestart = !def.hotReload;
    const restartNote = requiresRestart ? " (restart required to take full effect)" : "";
    return {
      success: true,
      key,
      previousValue,
      newValue: coerced,
      requiresRestart,
      message: `${key} changed from ${JSON.stringify(previousValue)} to ${JSON.stringify(coerced)}${restartNote}.`,
    };
  }

  /** Undo the last config change. Returns null if no change to undo. */
  undo(): ConfigChangeResult | null {
    if (!lastChange) return null;

    const { def, previousValue } = lastChange;
    const currentValue = readCurrentValue(def);
    lastChange = null;

    applyToEnv(def, previousValue);
    safePersist(def, previousValue, `undo for ${def.key}`);

    // Run subsystem handler for the reverted value
    const handler = applyHandlers[def.key];
    if (handler) {
      handler(previousValue);
    }

    // Emit CONFIG_CHANGED for the revert
    sharedBus.emit(BusChannel.CONFIG_CHANGED, { key: def.key, previousValue: currentValue, newValue: previousValue });

    return {
      success: true,
      key: def.key,
      previousValue: currentValue,
      newValue: previousValue,
      requiresRestart: !def.hotReload,
      message: `Reverted ${def.key} to ${JSON.stringify(previousValue)}.`,
    };
  }

  /** Get a single param's full metadata. */
  get(key: string): ConfigParam | null {
    const def = getParamDef(key);
    if (!def) return null;
    return toConfigParam(def);
  }
}

/** Singleton instance. */
export const configService = new ConfigService();
