/**
 * Pi SDK lifecycle event name constants.
 *
 * All domains subscribe to Pi SDK events using these constants instead of raw
 * string literals. If the Pi SDK renames an event, this is the single file to
 * update; the TypeScript compiler catches every stale reference.
 */
export const PiEvent = {
  SESSION_START: "session_start",
  SESSION_SHUTDOWN: "session_shutdown",
  BEFORE_AGENT_START: "before_agent_start",
  MESSAGE_END: "message_end",
  MODEL_SELECT: "model_select",
  CONTEXT: "context",
  TOOL_CALL: "tool_call",
  TOOL_EXECUTION_END: "tool_execution_end",
} as const;

export type PiEventName = (typeof PiEvent)[keyof typeof PiEvent];
