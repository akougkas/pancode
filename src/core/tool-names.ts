/**
 * Canonical tool name constants shared across domains.
 *
 * Dispatch registers tools using these names. Intelligence, modes, and other
 * domains reference them for filtering, gating, and observation. A rename in
 * one place breaks at compile time everywhere, instead of silently at runtime.
 */
export const ToolName = {
  // Dispatch tools (registered by dispatch/extension.ts)
  DISPATCH_AGENT: "dispatch_agent",
  BATCH_DISPATCH: "batch_dispatch",
  DISPATCH_CHAIN: "dispatch_chain",

  // Shadow tools (registered by agents/shadow-explore.ts)
  SHADOW_EXPLORE: "shadow_explore",

  // Task tools (registered by dispatch/extension.ts)
  TASK_WRITE: "task_write",
  TASK_CHECK: "task_check",
  TASK_UPDATE: "task_update",
  TASK_LIST: "task_list",

  // Config tools (registered by panconfigure/extension.ts)
  PAN_READ_CONFIG: "pan_read_config",
  PAN_APPLY_CONFIG: "pan_apply_config",

  // Pi SDK built-in tools (referenced by mode gating)
  READ: "read",
  BASH: "bash",
  GREP: "grep",
  FIND: "find",
  LS: "ls",
  EDIT: "edit",
  WRITE: "write",
} as const;

export type ToolNameValue = (typeof ToolName)[keyof typeof ToolName];
