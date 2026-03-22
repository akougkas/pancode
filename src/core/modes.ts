// Orchestrator behavior mode definitions and state management.
// Modes control what the orchestrator DOES with user input. They are orthogonal
// to safety modes (suggest/auto-edit/full-auto) which control what is ALLOWED.

import type { PanCodeThinkingLevel } from "./thinking";
import { ToolName } from "./tool-names";

export type OrchestratorMode = "capture" | "plan" | "build" | "ask" | "review";

export interface ModeDefinition {
  id: OrchestratorMode;
  name: string;
  color: string;
  description: string;
  dispatchEnabled: boolean;
  shadowEnabled: boolean;
  mutationsAllowed: boolean;
  /** Preferred reasoning level for this mode. Clamped to model capabilities at runtime. */
  reasoningLevel: PanCodeThinkingLevel;
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
    reasoningLevel: "medium",
  },
  {
    id: "plan",
    name: "Plan",
    color: "#7f45e0",
    description: "Analyze and plan. Shadow agents explore. No dispatch yet.",
    dispatchEnabled: false,
    shadowEnabled: true,
    mutationsAllowed: false,
    reasoningLevel: "high",
  },
  {
    id: "build",
    name: "Build",
    color: "#16c858",
    description: "Full dispatch. Workers implement, test, review.",
    dispatchEnabled: true,
    shadowEnabled: true,
    mutationsAllowed: true,
    reasoningLevel: "medium",
  },
  {
    id: "ask",
    name: "Ask",
    color: "#fdac53",
    description: "Questions and research. Readonly workers only.",
    dispatchEnabled: true,
    shadowEnabled: true,
    mutationsAllowed: false,
    reasoningLevel: "low",
  },
  {
    id: "review",
    name: "Review",
    color: "#dc5663",
    description: "Quality checks. Readonly reviewers analyze code.",
    dispatchEnabled: true,
    shadowEnabled: true,
    mutationsAllowed: false,
    reasoningLevel: "xhigh",
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

/**
 * Returns the tool names that should be active for a given mode.
 * Called by the UI extension when mode changes to gate tool visibility.
 *
 * Built-in tools: read, bash, grep, find, ls, edit, write
 * Extension tools: shadow_explore, dispatch_agent, batch_dispatch,
 *   dispatch_chain, task_write, task_check, task_update, task_list
 */
export function getToolsetForMode(mode: OrchestratorMode): string[] {
  const readonly = [ToolName.READ, ToolName.BASH, ToolName.GREP, ToolName.FIND, ToolName.LS];
  const mutable = [...readonly, ToolName.EDIT, ToolName.WRITE];
  const shadow = [ToolName.SHADOW_EXPLORE];
  const tasks = [ToolName.TASK_WRITE, ToolName.TASK_CHECK, ToolName.TASK_UPDATE, ToolName.TASK_LIST];
  const dispatch = [ToolName.DISPATCH_AGENT, ToolName.BATCH_DISPATCH, ToolName.DISPATCH_CHAIN];

  switch (mode) {
    case "capture":
      return [...tasks];
    case "plan":
      return [...readonly, ...shadow, ...tasks];
    case "build":
      return [...mutable, ...shadow, ...tasks, ...dispatch];
    case "ask":
      return [...readonly, ...shadow];
    case "review":
      return [...readonly, ...shadow, ...dispatch];
  }
}

export function getModeDefinition(mode?: OrchestratorMode): ModeDefinition {
  const target = mode ?? currentMode;
  const definition = MODE_DEFINITIONS.find((m) => m.id === target);
  if (!definition) {
    throw new Error(`Unknown mode: ${target}`);
  }
  return definition;
}
