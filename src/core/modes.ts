// Orchestrator behavior mode definitions and state management.
// Modes control what the orchestrator DOES with user input. They are orthogonal
// to safety modes (suggest/auto-edit/full-auto) which control what is ALLOWED.

import type { PanCodeThinkingLevel } from "./thinking";
import { ToolName } from "./tool-names";

export type OrchestratorMode = "admin" | "plan" | "build" | "review";

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
    id: "admin",
    name: "Admin",
    color: "#3b82f6",
    description: "PanCode God Mode. Full system management, configuration, and diagnostic dispatch.",
    dispatchEnabled: true,
    shadowEnabled: true,
    mutationsAllowed: false,
    reasoningLevel: "xhigh",
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

/** Full set of modes including admin. Used for lookup and /modes command. */
export const MODE_ORDER: OrchestratorMode[] = ["admin", "plan", "build", "review"];

/** Shift+tab cycle excludes admin (Alt+A only). */
export const CYCLE_ORDER: OrchestratorMode[] = ["plan", "build", "review"];

let currentMode: OrchestratorMode = "build";

export function getCurrentMode(): OrchestratorMode {
  return currentMode;
}

export function setCurrentMode(mode: OrchestratorMode): void {
  currentMode = mode;
}

/**
 * Returns the tool names that should be active for a given mode.
 * Called by the UI extension when mode changes to gate tool visibility.
 *
 * Built-in tools: read, bash, grep, find, ls, edit, write
 * Extension tools: shadow_explore, dispatch_agent, batch_dispatch,
 *   dispatch_chain, task_write, task_check, task_update, task_list,
 *   pan_read_config, pan_apply_config
 */
export function getToolsetForMode(mode: OrchestratorMode): string[] {
  const readonly = [ToolName.READ, ToolName.BASH, ToolName.GREP, ToolName.FIND, ToolName.LS];
  const mutable = [...readonly, ToolName.EDIT, ToolName.WRITE];
  const shadow = [ToolName.SHADOW_EXPLORE];
  const tasks = [ToolName.TASK_WRITE, ToolName.TASK_CHECK, ToolName.TASK_UPDATE, ToolName.TASK_LIST];
  const dispatch = [ToolName.DISPATCH_AGENT, ToolName.BATCH_DISPATCH, ToolName.DISPATCH_CHAIN];
  const config = [ToolName.PAN_READ_CONFIG, ToolName.PAN_APPLY_CONFIG];

  // Read-only config access (view settings without mutation capability).
  const configReadOnly = [ToolName.PAN_READ_CONFIG];

  switch (mode) {
    case "admin":
      // NOTE: Admin disables file mutations at the orchestrator level, but
      // dispatched workers run as separate processes with their own safety
      // level. A worker spawned from admin mode may still have edit/write
      // access if the worker's safety permits it. This is an accepted
      // trade-off: admin controls orchestrator behavior, not worker behavior.
      return [...readonly, ...shadow, ...tasks, ...dispatch, ...config];
    case "plan":
      return [...readonly, ...shadow, ...tasks, ...config];
    case "build":
      return [...mutable, ...shadow, ...tasks, ...dispatch, ...config];
    case "review":
      // Review mode is read-only. Config mutations (pan_apply_config) are
      // excluded to prevent reviewers from changing runtime configuration.
      return [...readonly, ...shadow, ...dispatch, ...configReadOnly];
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
