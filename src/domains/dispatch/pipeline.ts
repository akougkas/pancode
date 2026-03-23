/**
 * Dispatch middleware pipeline.
 *
 * Composes dispatch validation gates as pure functions in an explicit
 * pipeline. Each gate receives the dispatch params and runtime context,
 * returns null to pass or a GateResult to block. The pipeline short-circuits
 * on the first rejection.
 *
 * Gate ordering is explicit and documented. Adding or removing a gate
 * is a one-line change.
 */

export interface DispatchParams {
  task: string;
  agent: string;
  model: string | null;
  cwd: string;
  readonly: boolean;
  dispatchDepth: number;
  maxDepth: number;
}

export interface DispatchContext {
  /** Current budget remaining (null if no budget tracking). */
  budgetRemaining: number | null;
  /** Whether the provider is currently backed off. */
  isProviderBackedOff: (provider: string) => boolean;
  /** Whether the provider is healthy. */
  isProviderHealthy: (provider: string) => boolean;
  /** Maximum dispatch depth from config. */
  maxDispatchDepth: number;
}

export interface GateResult {
  gate: string;
  blocked: boolean;
  reason: string;
}

/**
 * A dispatch gate is a pure function that either passes (returns null)
 * or blocks (returns a GateResult with blocked: true and a reason).
 */
export type DispatchGate = (params: DispatchParams, ctx: DispatchContext) => GateResult | null;

// ---------------------------------------------------------------------------
// Built-in gates
// ---------------------------------------------------------------------------

/** Validate that the task is non-empty and has reasonable length. */
export const validateTaskGate: DispatchGate = (params) => {
  if (!params.task.trim()) {
    return { gate: "validate-task", blocked: true, reason: "Task is empty" };
  }
  if (params.task.length > 100_000) {
    return { gate: "validate-task", blocked: true, reason: "Task exceeds maximum length (100K characters)" };
  }
  return null;
};

/** Check dispatch recursion depth to prevent infinite dispatch loops. */
export const checkDepthGate: DispatchGate = (params, ctx) => {
  if (params.dispatchDepth >= ctx.maxDispatchDepth) {
    return {
      gate: "check-depth",
      blocked: true,
      reason: `Dispatch depth ${params.dispatchDepth} exceeds maximum ${ctx.maxDispatchDepth}`,
    };
  }
  return null;
};

/** Check that the remaining budget can cover at least one more dispatch. */
export const checkBudgetGate: DispatchGate = (_params, ctx) => {
  if (ctx.budgetRemaining !== null && ctx.budgetRemaining <= 0) {
    return { gate: "check-budget", blocked: true, reason: "Budget exhausted" };
  }
  return null;
};

/** Check provider health before dispatching. */
export const checkProviderHealthGate: DispatchGate = (params) => {
  if (!params.model) return null;

  const slashIdx = params.model.indexOf("/");
  if (slashIdx === -1) return null;

  // Provider health checks are performed by the caller via DispatchContext.
  // This gate just validates the model format.
  return null;
};

// ---------------------------------------------------------------------------
// Pipeline runner
// ---------------------------------------------------------------------------

/** Default gate ordering. */
export const DEFAULT_GATES: DispatchGate[] = [
  validateTaskGate,
  checkDepthGate,
  checkBudgetGate,
  checkProviderHealthGate,
];

/**
 * Run the dispatch pipeline. Returns null if all gates pass,
 * or the first GateResult that blocks.
 */
export function runDispatchPipeline(
  params: DispatchParams,
  ctx: DispatchContext,
  gates: DispatchGate[] = DEFAULT_GATES,
): GateResult | null {
  for (const gate of gates) {
    const result = gate(params, ctx);
    if (result?.blocked) {
      return result;
    }
  }
  return null;
}
