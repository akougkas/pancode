/**
 * Headless execution mode for PanCode.
 *
 * Provides single-shot task execution without the TUI, for use in
 * CI/CD pipelines, git hooks, and automation scripts.
 *
 * Usage:
 *   pancode run --headless --task "Review src/core/config.ts"
 *   pancode run --headless --task-file tasks.yaml --json
 *
 * Architecture:
 *   The AgentSession is mode-agnostic. Headless mode replaces
 *   PanCodeInteractiveShell with a print/RPC mode session that
 *   feeds the task via CLI args instead of TUI input.
 *
 * This file defines the headless infrastructure. Integration with
 * the orchestrator boot sequence is a separate change.
 */

import { readFileSync } from "node:fs";
import { ExitCode, type ExitCodeValue, jsonError, jsonSuccess } from "../core/exit-codes";

export interface HeadlessConfig {
  task: string;
  /** Output structured JSON instead of plain text. */
  json: boolean;
  /** Maximum time to wait for task completion in milliseconds. */
  timeoutMs: number;
  /** Exit immediately if the task would require user interaction. */
  exitOnBlock: boolean;
  /** Maximum concurrent dispatches for batch mode. */
  concurrency: number;
}

export interface HeadlessResult {
  status: "done" | "failed" | "blocked" | "timeout";
  result: string;
  exitCode: ExitCodeValue;
  tokens: { in: number; out: number };
  cost: number;
  runtime: string;
  wallMs: number;
}

/**
 * Parse headless execution arguments from the CLI.
 * Returns null if the invocation is not a headless run.
 */
export function parseHeadlessArgs(argv: string[]): HeadlessConfig | null {
  let headless = false;
  let task: string | null = null;
  let taskFile: string | null = null;
  let json = false;
  let timeoutMs = 300_000; // 5 minutes default
  let exitOnBlock = false;
  let concurrency = 1;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--headless") {
      headless = true;
      continue;
    }
    if (arg === "--task") {
      task = argv[++i] ?? null;
      continue;
    }
    if (arg === "--task-file") {
      taskFile = argv[++i] ?? null;
      continue;
    }
    if (arg === "--json") {
      json = true;
      continue;
    }
    if (arg === "--timeout") {
      timeoutMs = Number.parseInt(argv[++i] ?? "300000", 10) || 300_000;
      continue;
    }
    if (arg === "--exit-on-block") {
      exitOnBlock = true;
      continue;
    }
    if (arg === "--concurrency") {
      concurrency = Number.parseInt(argv[++i] ?? "1", 10) || 1;
    }
  }

  if (!headless) return null;

  // Resolve task from --task or --task-file
  if (!task && taskFile) {
    try {
      task = readFileSync(taskFile, "utf8").trim();
    } catch {
      // Task file read failure is a config error
      return null;
    }
  }

  if (!task) return null;

  return { task, json, timeoutMs, exitOnBlock, concurrency };
}

/**
 * Format a headless result for output.
 * Returns JSON string if json mode is enabled, plain text otherwise.
 */
export function formatHeadlessResult(result: HeadlessResult, json: boolean): string {
  if (json) {
    if (result.status === "done") {
      return JSON.stringify(jsonSuccess("run", result));
    }
    return JSON.stringify(jsonError("run", result.result, result.exitCode));
  }

  // Plain text output
  if (result.status === "done") {
    return result.result;
  }

  return `Error (${result.status}): ${result.result}`;
}

/**
 * Map a headless result status to a process exit code.
 */
export function headlessExitCode(result: HeadlessResult): ExitCodeValue {
  switch (result.status) {
    case "done":
      return ExitCode.SUCCESS;
    case "failed":
      return ExitCode.TASK_FAILURE;
    case "blocked":
      return ExitCode.SCOPE_VIOLATION;
    case "timeout":
      return ExitCode.TIMEOUT;
    default:
      return ExitCode.UNKNOWN;
  }
}
