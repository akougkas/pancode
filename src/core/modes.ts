// Orchestrator behavior mode definitions and state management.
// Modes control what the orchestrator DOES with user input. They are orthogonal
// to safety modes (suggest/auto-edit/full-auto) which control what is ALLOWED.

export type OrchestratorMode = "capture" | "plan" | "build" | "ask" | "review";

export interface ModeDefinition {
  id: OrchestratorMode;
  name: string;
  color: string;
  description: string;
  dispatchEnabled: boolean;
  shadowEnabled: boolean;
  mutationsAllowed: boolean;
}

export const MODE_DEFINITIONS: ModeDefinition[] = [
  {
    id: "capture",
    name: "Capture",
    color: "#3b82f6",
    description: "Log tasks and ideas. No dispatch, no planning.",
    dispatchEnabled: false,
    shadowEnabled: false,
    mutationsAllowed: false,
  },
  {
    id: "plan",
    name: "Plan",
    color: "#7f45e0",
    description: "Analyze and plan. Shadow agents explore. No dispatch yet.",
    dispatchEnabled: false,
    shadowEnabled: true,
    mutationsAllowed: false,
  },
  {
    id: "build",
    name: "Build",
    color: "#16c858",
    description: "Full dispatch. Workers implement, test, review.",
    dispatchEnabled: true,
    shadowEnabled: true,
    mutationsAllowed: true,
  },
  {
    id: "ask",
    name: "Ask",
    color: "#fdac53",
    description: "Questions and research. Readonly workers only.",
    dispatchEnabled: true,
    shadowEnabled: true,
    mutationsAllowed: false,
  },
  {
    id: "review",
    name: "Review",
    color: "#dc5663",
    description: "Quality checks. Readonly reviewers analyze code.",
    dispatchEnabled: true,
    shadowEnabled: true,
    mutationsAllowed: false,
  },
];

export const MODE_ORDER: OrchestratorMode[] = ["capture", "plan", "build", "ask", "review"];

let currentMode: OrchestratorMode = "build";

export function getCurrentMode(): OrchestratorMode {
  return currentMode;
}

export function setCurrentMode(mode: OrchestratorMode): void {
  currentMode = mode;
}

export function cycleMode(direction: 1 | -1 = 1): OrchestratorMode {
  const idx = MODE_ORDER.indexOf(currentMode);
  const next = (idx + direction + MODE_ORDER.length) % MODE_ORDER.length;
  currentMode = MODE_ORDER[next];
  return currentMode;
}

export function getModeDefinition(mode?: OrchestratorMode): ModeDefinition {
  const target = mode ?? currentMode;
  return MODE_DEFINITIONS.find((m) => m.id === target)!;
}
