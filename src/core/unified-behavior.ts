/**
 * Unified behavior descriptor combining orchestrator mode and safety level.
 *
 * Users should learn one concept for "how PanCode behaves right now." This
 * module provides a single-axis view that merges the mode (what PanCode does)
 * with the safety level (what PanCode is allowed to do), producing a
 * human-readable behavior label for display and API output.
 *
 * The mode and safety axes remain orthogonal internally. This module is a
 * presentation layer that collapses the 5x3 matrix into a meaningful
 * summary for users who do not need the full granularity.
 */

import type { AutonomyMode } from "../domains/safety/scope";
import { type OrchestratorMode, getModeDefinition, getToolsetForMode } from "./modes";

export interface UnifiedBehavior {
  /** Human-readable label combining mode and safety. */
  label: string;
  /** The underlying orchestrator mode. */
  mode: OrchestratorMode;
  /** The underlying safety/autonomy level. */
  safety: AutonomyMode;
  /** Whether file mutations are possible in this combination. */
  canMutate: boolean;
  /** Whether dispatch is enabled. */
  canDispatch: boolean;
  /** Active tool count for this combination. */
  activeToolCount: number;
  /** Short description for status bars and API output. */
  summary: string;
}

/**
 * Resolve the unified behavior from the current mode and safety level.
 * This is the single source of truth for "what is PanCode doing right now?"
 */
export function resolveUnifiedBehavior(mode: OrchestratorMode, safety: AutonomyMode): UnifiedBehavior {
  const modeDef = getModeDefinition(mode);
  const tools = getToolsetForMode(mode);

  // Effective mutation capability requires both mode permission and safety permission
  const canMutate = modeDef.mutationsAllowed && safety !== "suggest";
  const canDispatch = modeDef.dispatchEnabled && safety !== "suggest";

  const label = composeBehaviorLabel(mode, safety);
  const summary = composeBehaviorSummary(modeDef.name, safety, canMutate, canDispatch);

  return {
    label,
    mode,
    safety,
    canMutate,
    canDispatch,
    activeToolCount: tools.length,
    summary,
  };
}

function composeBehaviorLabel(mode: OrchestratorMode, safety: AutonomyMode): string {
  // Collapse obvious combinations into simple labels
  if (mode === "capture") return "Capture";
  if (mode === "ask") return "Ask";
  if (mode === "review" && safety === "suggest") return "Review (read-only)";
  if (mode === "review") return "Review";
  if (mode === "plan" && safety === "suggest") return "Plan (read-only)";
  if (mode === "plan") return "Plan";
  if (mode === "build" && safety === "full-auto") return "Build (full-auto)";
  if (mode === "build" && safety === "auto-edit") return "Build";
  if (mode === "build" && safety === "suggest") return "Build (suggest-only)";
  return `${modeCap(mode)} / ${safety}`;
}

function modeCap(mode: string): string {
  return mode.charAt(0).toUpperCase() + mode.slice(1);
}

function composeBehaviorSummary(
  modeName: string,
  safety: AutonomyMode,
  canMutate: boolean,
  canDispatch: boolean,
): string {
  const parts: string[] = [modeName];
  if (canMutate) parts.push("writes enabled");
  else parts.push("read-only");
  if (canDispatch) parts.push("dispatch active");
  parts.push(`safety: ${safety}`);
  return parts.join(", ");
}

/**
 * All valid combinations for documentation or testing.
 * Returns the 15 entries in the 5-mode x 3-safety matrix.
 */
export function allBehaviorCombinations(): UnifiedBehavior[] {
  const modes: OrchestratorMode[] = ["capture", "plan", "build", "ask", "review"];
  const safetyLevels: AutonomyMode[] = ["suggest", "auto-edit", "full-auto"];
  const results: UnifiedBehavior[] = [];
  for (const mode of modes) {
    for (const safety of safetyLevels) {
      results.push(resolveUnifiedBehavior(mode, safety));
    }
  }
  return results;
}
