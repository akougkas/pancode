/**
 * Intelligence subsystem contracts.
 * These types are always compiled but the intelligence domain
 * is disabled by default. When enabled, it subscribes to dispatch
 * events and can override declarative rules with learned routing.
 */

export interface Intent {
  task: string;
  category: "coding" | "review" | "research" | "testing" | "refactoring" | "unknown";
  complexity: "simple" | "moderate" | "complex";
  estimatedTokens: number;
}

export interface DispatchPlan {
  intent: Intent;
  agent: string;
  model: string | null;
  parallel: boolean;
  estimatedCost: number;
  confidence: number;
}

export interface DispatchOutcome {
  runId: string;
  plan: DispatchPlan;
  success: boolean;
  actualCost: number;
  actualTokens: number;
  durationMs: number;
}
