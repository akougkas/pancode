import { availableParallelism, cpus, freemem } from "node:os";

/**
 * Concurrency detection and adaptive scaling.
 *
 * Two modes controlled by PANCODE_CONCURRENCY_MODE:
 *   "fixed"  - use PANCODE_NODE_CONCURRENCY or core count (default)
 *   "auto"   - compute effective concurrency from the minimum of:
 *              compute cores, inference capacity, memory budget, and cost headroom
 */

export type ConcurrencyMode = "auto" | "fixed";

export interface ConcurrencyReport {
  mode: ConcurrencyMode;
  effective: number;
  computeCores: number;
  inferenceCapacity: number | null;
  memorySlots: number | null;
  budgetSlots: number | null;
}

/** Estimated memory footprint per worker subprocess in bytes (256 MB). */
const WORKER_MEMORY_FOOTPRINT = 256 * 1024 * 1024;

/**
 * Detect concurrency using the original fixed algorithm.
 * Respects PANCODE_NODE_CONCURRENCY env var if set.
 */
export function detectConcurrency(limit = 8): number {
  const envConcurrency = Number.parseInt(process.env.PANCODE_NODE_CONCURRENCY ?? "", 10);
  if (Number.isFinite(envConcurrency) && envConcurrency > 0) {
    return Math.max(1, Math.min(envConcurrency, limit));
  }
  const cores = typeof availableParallelism === "function" ? availableParallelism() : cpus().length;
  return Math.max(1, Math.min(limit, cores));
}

/**
 * Detect the concurrency mode from env var.
 */
export function getConcurrencyMode(): ConcurrencyMode {
  const mode = process.env.PANCODE_CONCURRENCY_MODE?.trim().toLowerCase();
  if (mode === "auto") return "auto";
  return "fixed";
}

/**
 * Compute the number of worker slots available based on free memory.
 * Returns the number of workers that can fit in available RAM,
 * with a minimum of 1.
 */
export function computeMemorySlots(): number {
  const free = freemem();
  // Reserve 512 MB for the orchestrator and OS
  const available = Math.max(0, free - 512 * 1024 * 1024);
  return Math.max(1, Math.floor(available / WORKER_MEMORY_FOOTPRINT));
}

/**
 * Compute the number of available inference slots from environment configuration.
 *
 * Reads PANCODE_INFERENCE_SLOTS env var directly. In a future version,
 * this will probe local inference endpoints at boot to determine capacity.
 *
 * Returns null if inference capacity is unknown (not configured).
 */
export function computeInferenceCapacity(): number | null {
  const raw = process.env.PANCODE_INFERENCE_SLOTS?.trim();
  if (!raw) return null;
  const slots = Number.parseInt(raw, 10);
  return Number.isFinite(slots) && slots > 0 ? slots : null;
}

/**
 * Compute cost-based slot limit from remaining budget.
 *
 * Given a remaining budget and estimated cost per dispatch,
 * returns the number of dispatches that can run before exhausting the budget.
 * Returns null if budget tracking is not active.
 */
export function computeBudgetSlots(remainingBudget: number | null, costPerDispatch: number | null): number | null {
  if (remainingBudget === null || costPerDispatch === null || costPerDispatch <= 0) {
    return null;
  }
  return Math.max(1, Math.floor(remainingBudget / costPerDispatch));
}

/**
 * Compute adaptive concurrency using the minimum of all available dimensions.
 *
 * effective_concurrency = min(
 *   compute_cores,
 *   inference_capacity,    (if known)
 *   memory_slots,          (if auto mode)
 *   budget_slots,          (if budget tracking active)
 * )
 */
export function computeAdaptiveConcurrency(options?: {
  remainingBudget?: number | null;
  costPerDispatch?: number | null;
  maxLimit?: number;
}): ConcurrencyReport {
  const mode = getConcurrencyMode();
  const maxLimit = options?.maxLimit ?? 32;

  if (mode === "fixed") {
    const effective = detectConcurrency(maxLimit);
    return {
      mode: "fixed",
      effective,
      computeCores: effective,
      inferenceCapacity: null,
      memorySlots: null,
      budgetSlots: null,
    };
  }

  // Auto mode: compute from all dimensions
  const cores = typeof availableParallelism === "function" ? availableParallelism() : cpus().length;
  const computeCores = Math.max(1, Math.min(cores, maxLimit));

  const inferenceCapacity = computeInferenceCapacity();
  const memorySlots = computeMemorySlots();
  const budgetSlots = computeBudgetSlots(options?.remainingBudget ?? null, options?.costPerDispatch ?? null);

  // Effective concurrency is the minimum of all known dimensions
  let effective = computeCores;
  if (inferenceCapacity !== null) effective = Math.min(effective, inferenceCapacity);
  effective = Math.min(effective, memorySlots);
  if (budgetSlots !== null) effective = Math.min(effective, budgetSlots);

  effective = Math.max(1, Math.min(effective, maxLimit));

  return {
    mode: "auto",
    effective,
    computeCores,
    inferenceCapacity,
    memorySlots,
    budgetSlots,
  };
}
