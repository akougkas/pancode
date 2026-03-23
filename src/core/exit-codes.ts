/**
 * Deterministic exit code taxonomy for headless and CI use.
 *
 * Every PanCode process (orchestrator, worker, CLI command) should use
 * these constants instead of magic numbers. This enables reliable
 * scripting and CI pipeline integration.
 */

export const ExitCode = {
  /** Task completed successfully. */
  SUCCESS: 0,
  /** Task failure (agent error, non-zero worker exit). */
  TASK_FAILURE: 1,
  /** Configuration or authentication error. */
  CONFIG_ERROR: 2,
  /** Safety scope violation (blocked by safety rules). */
  SCOPE_VIOLATION: 3,
  /** Budget exhausted (token or cost ceiling reached). */
  BUDGET_EXHAUSTED: 4,
  /** Timeout (worker or dispatch exceeded time limit). */
  TIMEOUT: 5,
  /** Required binary not found (pi, claude, codex, etc.). */
  BINARY_NOT_FOUND: 126,
  /** Unknown or unclassified error. */
  UNKNOWN: 127,
} as const;

export type ExitCodeValue = (typeof ExitCode)[keyof typeof ExitCode];

/** Human-readable description for each exit code. */
export function describeExitCode(code: number): string {
  switch (code) {
    case ExitCode.SUCCESS:
      return "Success";
    case ExitCode.TASK_FAILURE:
      return "Task failure";
    case ExitCode.CONFIG_ERROR:
      return "Configuration or authentication error";
    case ExitCode.SCOPE_VIOLATION:
      return "Safety scope violation";
    case ExitCode.BUDGET_EXHAUSTED:
      return "Budget exhausted";
    case ExitCode.TIMEOUT:
      return "Timeout exceeded";
    case ExitCode.BINARY_NOT_FOUND:
      return "Required binary not found";
    case ExitCode.UNKNOWN:
      return "Unknown error";
    default:
      return `Exit code ${code}`;
  }
}

/**
 * JSON envelope schema for consistent --json output across all commands.
 */
export interface JsonEnvelope<T = unknown> {
  command: string;
  status: "ok" | "error";
  data: T;
  timestamp: string;
  exitCode: number;
}

/** Create a success JSON envelope. */
export function jsonSuccess<T>(command: string, data: T): JsonEnvelope<T> {
  return {
    command,
    status: "ok",
    data,
    timestamp: new Date().toISOString(),
    exitCode: ExitCode.SUCCESS,
  };
}

/** Create an error JSON envelope. */
export function jsonError(
  command: string,
  message: string,
  exitCode: ExitCodeValue = ExitCode.TASK_FAILURE,
): JsonEnvelope<{ error: string }> {
  return {
    command,
    status: "error",
    data: { error: message },
    timestamp: new Date().toISOString(),
    exitCode,
  };
}
