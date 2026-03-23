/**
 * Dispatch verification gate.
 *
 * After a worker completes, the verification gate runs a validation
 * command in the worker's CWD to confirm the output is correct.
 * If verification fails and retry is enabled, the task is re-dispatched
 * with the error output appended to the original task.
 *
 * Configuration comes from the agent spec's verification field.
 */

import { execSync } from "node:child_process";

export interface VerificationConfig {
  /** Shell command to run for verification (e.g., "npm run typecheck"). */
  command: string;
  /** Expected exit code for success (default: 0). */
  expectedExit: number;
  /** Whether to retry the dispatch if verification fails. */
  retryOnFail: boolean;
  /** Maximum number of retry attempts. */
  maxRetries: number;
  /** Timeout for the verification command in milliseconds (default: 30000). */
  timeoutMs: number;
}

export interface VerificationResult {
  passed: boolean;
  exitCode: number;
  stdout: string;
  stderr: string;
  /** Duration of the verification command in milliseconds. */
  durationMs: number;
}

/** Default verification config values. */
export const DEFAULT_VERIFICATION: Omit<VerificationConfig, "command"> = {
  expectedExit: 0,
  retryOnFail: true,
  maxRetries: 2,
  timeoutMs: 30_000,
};

/**
 * Run the verification command in the specified working directory.
 * Returns a VerificationResult indicating whether verification passed.
 */
export function runVerification(config: VerificationConfig, cwd: string): VerificationResult {
  const start = Date.now();
  const timeout = Math.min(config.timeoutMs, 120_000); // Hard cap at 2 minutes

  try {
    const stdout = execSync(config.command, {
      cwd,
      timeout,
      stdio: "pipe",
      encoding: "utf8",
      maxBuffer: 1024 * 1024, // 1 MB
    });

    const durationMs = Date.now() - start;
    return {
      passed: true,
      exitCode: 0,
      stdout: typeof stdout === "string" ? stdout.slice(0, 2000) : "",
      stderr: "",
      durationMs,
    };
  } catch (err: unknown) {
    const durationMs = Date.now() - start;
    const execErr = err as { status?: number; stdout?: string; stderr?: string; message?: string };

    const exitCode = execErr.status ?? 1;
    const stdout = typeof execErr.stdout === "string" ? execErr.stdout.slice(0, 2000) : "";
    const stderr =
      typeof execErr.stderr === "string"
        ? execErr.stderr.slice(0, 2000)
        : (execErr.message ?? "Verification failed").slice(0, 2000);

    return {
      passed: exitCode === config.expectedExit,
      exitCode,
      stdout,
      stderr,
      durationMs,
    };
  }
}

/**
 * Build a retry task prompt that appends verification failure context
 * to the original task.
 */
export function buildRetryPrompt(
  originalTask: string,
  verificationResult: VerificationResult,
  attemptNumber: number,
): string {
  const failureContext =
    verificationResult.stderr.trim() || verificationResult.stdout.trim() || "Verification command failed";

  return [
    originalTask,
    "",
    `--- Verification failure (attempt ${attemptNumber}) ---`,
    `Command exit code: ${verificationResult.exitCode}`,
    failureContext,
    "---",
    "Fix the issues above and try again.",
  ].join("\n");
}

/**
 * Parse a verification config from a YAML agent entry.
 * Returns null if no verification is configured.
 */
export function parseVerificationConfig(entry: {
  verification?: {
    command?: string;
    expected_exit?: number;
    retry_on_fail?: boolean;
    max_retries?: number;
    timeout_ms?: number;
  };
}): VerificationConfig | null {
  if (!entry.verification?.command) return null;

  return {
    command: entry.verification.command,
    expectedExit: entry.verification.expected_exit ?? DEFAULT_VERIFICATION.expectedExit,
    retryOnFail: entry.verification.retry_on_fail ?? DEFAULT_VERIFICATION.retryOnFail,
    maxRetries: entry.verification.max_retries ?? DEFAULT_VERIFICATION.maxRetries,
    timeoutMs: entry.verification.timeout_ms ?? DEFAULT_VERIFICATION.timeoutMs,
  };
}
