import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

/**
 * Per-model inference performance entry. Aggregated from individual run metrics
 * over time to track TTFT, TPS, tool-call success rate, and dispatch duration.
 */
export interface ModelPerfEntry {
  modelId: string;
  sampleCount: number;
  avgDurationMs: number;
  avgInputTokens: number;
  avgOutputTokens: number;
  toolCallSuccessRate: number | null;
  lastUpdated: string;
}

export interface ModelPerfStore {
  version: 1;
  models: Record<string, ModelPerfEntry>;
}

const EMPTY_STORE: ModelPerfStore = { version: 1, models: {} };

/**
 * Read the model performance store from disk. Returns an empty store if
 * the file is missing, corrupt, or uses an incompatible version.
 */
export function readModelPerfStore(pancodeHome: string): ModelPerfStore {
  const filePath = join(pancodeHome, "model-perf.json");
  if (!existsSync(filePath)) return { ...EMPTY_STORE, models: {} };

  try {
    const raw = readFileSync(filePath, "utf8");
    const parsed = JSON.parse(raw) as ModelPerfStore;
    if (parsed.version !== 1 || typeof parsed.models !== "object") {
      return { ...EMPTY_STORE, models: {} };
    }
    return parsed;
  } catch {
    return { ...EMPTY_STORE, models: {} };
  }
}

/**
 * Write the model performance store to disk using atomic temp+rename.
 */
export function writeModelPerfStore(pancodeHome: string, store: ModelPerfStore): void {
  const filePath = join(pancodeHome, "model-perf.json");
  const tempPath = `${filePath}.tmp`;
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(tempPath, JSON.stringify(store, null, 2), "utf8");
  renameSync(tempPath, filePath);
}

/**
 * Record a single inference run's metrics into the performance store.
 * Uses exponential moving average to avoid unbounded storage growth.
 * The smoothing factor (alpha) weights recent observations more heavily.
 */
export function recordModelRun(
  store: ModelPerfStore,
  modelId: string,
  metrics: {
    durationMs: number;
    inputTokens: number;
    outputTokens: number;
    toolCallSuccess: boolean | null;
  },
): void {
  const existing = store.models[modelId];
  const alpha = 0.3; // EMA smoothing factor

  if (!existing) {
    store.models[modelId] = {
      modelId,
      sampleCount: 1,
      avgDurationMs: metrics.durationMs,
      avgInputTokens: metrics.inputTokens,
      avgOutputTokens: metrics.outputTokens,
      toolCallSuccessRate: metrics.toolCallSuccess !== null ? (metrics.toolCallSuccess ? 1.0 : 0.0) : null,
      lastUpdated: new Date().toISOString(),
    };
    return;
  }

  existing.sampleCount += 1;
  existing.avgDurationMs = ema(existing.avgDurationMs, metrics.durationMs, alpha);
  existing.avgInputTokens = ema(existing.avgInputTokens, metrics.inputTokens, alpha);
  existing.avgOutputTokens = ema(existing.avgOutputTokens, metrics.outputTokens, alpha);

  if (metrics.toolCallSuccess !== null) {
    const successValue = metrics.toolCallSuccess ? 1.0 : 0.0;
    existing.toolCallSuccessRate =
      existing.toolCallSuccessRate !== null ? ema(existing.toolCallSuccessRate, successValue, alpha) : successValue;
  }

  existing.lastUpdated = new Date().toISOString();
}

/**
 * Get performance summary for a specific model. Returns null if no data exists.
 */
export function getModelPerf(store: ModelPerfStore, modelId: string): ModelPerfEntry | null {
  return store.models[modelId] ?? null;
}

/**
 * Get all model performance entries sorted by sample count (most data first).
 */
export function getAllModelPerf(store: ModelPerfStore): ModelPerfEntry[] {
  return Object.values(store.models).sort((a, b) => b.sampleCount - a.sampleCount);
}

/** Exponential moving average: blends the old value with the new observation. */
function ema(oldValue: number, newValue: number, alpha: number): number {
  return alpha * newValue + (1 - alpha) * oldValue;
}
