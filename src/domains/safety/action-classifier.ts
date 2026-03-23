import { ToolName } from "../../core/tool-names";
import type { ActionClass, AutonomyMode } from "./scope";
import { lookupTier } from "./scope";

const TOOL_TO_ACTION: Record<string, ActionClass> = {
  // Pi SDK built-in tools
  read: "file_read",
  grep: "file_read",
  find: "file_read",
  ls: "file_read",
  glob: "file_read",
  write: "file_write",
  edit: "file_write",
  notebook_edit: "file_write",
  bash: "bash_exec",
  shell: "bash_exec",
  web_fetch: "network",
  web_search: "network",

  // Dispatch tools
  [ToolName.DISPATCH_AGENT]: "agent_dispatch",
  [ToolName.BATCH_DISPATCH]: "agent_dispatch",
  [ToolName.DISPATCH_CHAIN]: "agent_dispatch",

  // Task tools (task_write and task_update mutate task state on disk)
  [ToolName.TASK_WRITE]: "file_write",
  [ToolName.TASK_CHECK]: "file_read",
  [ToolName.TASK_UPDATE]: "file_write",
  [ToolName.TASK_LIST]: "file_read",

  // Shadow explore dispatches scout agents
  [ToolName.SHADOW_EXPLORE]: "agent_dispatch",
};

export function classifyAction(toolName: string): ActionClass {
  const normalized = toolName.toLowerCase().replace(/-/g, "_");
  return TOOL_TO_ACTION[normalized] ?? "file_read";
}

export function isActionAllowed(mode: AutonomyMode, action: ActionClass): boolean {
  return lookupTier(mode, action) === "allow";
}

// Detect destructive bash patterns for elevated classification
const DESTRUCTIVE_BASH_PATTERNS = [
  /rm\s+(-rf|-fr|--force)/,
  /git\s+reset\s+--hard/,
  /git\s+push\s+.*--force/,
  /git\s+clean\s+-[dfx]/,
  /chmod\s+777/,
  /sudo\s/,
];

export function classifyBashCommand(command: string): ActionClass {
  for (const pattern of DESTRUCTIVE_BASH_PATTERNS) {
    if (pattern.test(command)) return "bash_destructive";
  }
  if (/git\s+push/.test(command)) return "git_push";
  if (/git\s+(reset|rebase|cherry-pick|merge)/.test(command)) return "git_destructive";
  if (/rm\s/.test(command)) return "file_delete";
  return "bash_exec";
}
