// Scope contract types for PanCode safety enforcement.
// Two layers: formal model (dispatch admission) + YAML rules (tool-call blocking).

export type ScopeLevel = "read" | "suggest" | "write" | "admin";

export type ActionClass =
  | "file_read"
  | "file_write"
  | "file_delete"
  | "bash_exec"
  | "bash_destructive"
  | "git_push"
  | "git_destructive"
  | "network"
  | "agent_dispatch"
  | "system_modify";

export type AutonomyMode = "suggest" | "auto-edit" | "full-auto";
export type SafetyTier = "block" | "allow";
// "ask" tier deferred to Phase C (requires approval broker)

export interface ScopeContract {
  maxLevel: ScopeLevel;
  autonomyMode: AutonomyMode;
  allowedActions: Map<ActionClass, SafetyTier>;
}

// Policy matrix: autonomyMode x ActionClass -> SafetyTier
// This is the ground truth for admission gating.
export const DEFAULT_MODE_POLICIES: Record<AutonomyMode, Record<ActionClass, SafetyTier>> = {
  suggest: {
    file_read: "allow",
    file_write: "block",
    file_delete: "block",
    bash_exec: "block",
    bash_destructive: "block",
    git_push: "block",
    git_destructive: "block",
    network: "allow",
    agent_dispatch: "block",
    system_modify: "block",
  },
  "auto-edit": {
    file_read: "allow",
    file_write: "allow",
    file_delete: "block",
    bash_exec: "allow",
    bash_destructive: "block",
    git_push: "block",
    git_destructive: "block",
    network: "allow",
    agent_dispatch: "allow",
    system_modify: "block",
  },
  "full-auto": {
    file_read: "allow",
    file_write: "allow",
    file_delete: "allow",
    bash_exec: "allow",
    bash_destructive: "allow",
    git_push: "allow",
    git_destructive: "block",
    network: "allow",
    agent_dispatch: "allow",
    system_modify: "block",
  },
};

export function lookupTier(mode: AutonomyMode, action: ActionClass): SafetyTier {
  return DEFAULT_MODE_POLICIES[mode]?.[action] ?? "block";
}

export function resolveEffectiveMode(...modes: AutonomyMode[]): AutonomyMode {
  const order: AutonomyMode[] = ["suggest", "auto-edit", "full-auto"];
  let minIndex = order.length - 1;
  for (const mode of modes) {
    const idx = order.indexOf(mode);
    if (idx >= 0 && idx < minIndex) minIndex = idx;
  }
  return order[minIndex];
}

export function parseAutonomyMode(value: string | undefined | null): AutonomyMode {
  switch (value) {
    case "suggest":
      return "suggest";
    case "auto-edit":
      return "auto-edit";
    case "full-auto":
      return "full-auto";
    default:
      return "auto-edit";
  }
}

export const SCOPE_LEVEL_ORDER: ScopeLevel[] = ["read", "suggest", "write", "admin"];

export function scopeLevelIndex(level: ScopeLevel): number {
  return SCOPE_LEVEL_ORDER.indexOf(level);
}
