import type { ScopeContract, AutonomyMode } from "./scope";
import { scopeLevelIndex, resolveEffectiveMode } from "./scope";

export interface AdmissionResult {
  admitted: boolean;
  reason?: string;
}

export function enforceScopeSubset(worker: ScopeContract, orchestrator: ScopeContract): AdmissionResult {
  // Worker max level cannot exceed orchestrator max level
  if (scopeLevelIndex(worker.maxLevel) > scopeLevelIndex(orchestrator.maxLevel)) {
    return {
      admitted: false,
      reason: `Worker scope level ${worker.maxLevel} exceeds orchestrator ${orchestrator.maxLevel}`,
    };
  }

  // Every worker action must be allowed by orchestrator
  for (const [action, tier] of worker.allowedActions) {
    const orchTier = orchestrator.allowedActions.get(action);
    if (tier === "allow" && orchTier !== "allow") {
      return {
        admitted: false,
        reason: `Worker allows ${action} but orchestrator blocks it`,
      };
    }
  }

  return { admitted: true };
}

export function checkDispatchAdmission(
  workerMode: AutonomyMode,
  orchestratorMode: AutonomyMode,
): AdmissionResult {
  const effectiveMode = resolveEffectiveMode(workerMode, orchestratorMode);
  if (effectiveMode !== workerMode) {
    return {
      admitted: false,
      reason: `Worker mode ${workerMode} exceeds orchestrator mode ${orchestratorMode}. Effective: ${effectiveMode}`,
    };
  }
  return { admitted: true };
}

export function capWorkerMode(workerMode: AutonomyMode, orchestratorMode: AutonomyMode): AutonomyMode {
  return resolveEffectiveMode(workerMode, orchestratorMode);
}
