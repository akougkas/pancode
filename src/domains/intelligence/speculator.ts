/**
 * Speculative execution for dispatch pre-work.
 *
 * Inspired by CPU pipeline speculative execution and branch prediction
 * in HPC workloads. While the solver analyzes a task and generates a
 * dispatch plan, the speculator runs in parallel to perform pre-work:
 *
 * 1. Context prep: pre-read files likely relevant to the task
 * 2. Path analysis: resolve file paths mentioned in the task prompt
 * 3. Dependency scan: identify related files
 *
 * If the solver's plan matches the speculator's guess, the pre-work
 * provides a zero-cost head start. If not, speculative work is discarded.
 *
 * Cost: wasted compute on misprediction.
 * Benefit: latency reduction on correct prediction.
 */

import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

export interface SpeculativeResult {
  /** File contents that were pre-read. */
  preReadFiles: Map<string, string>;
  /** Files that were mentioned but do not exist. */
  missingFiles: string[];
  /** Total bytes of pre-read content. */
  totalBytes: number;
  /** Whether the speculation was used by the final plan. */
  used: boolean;
  /** Time spent on speculative pre-work in milliseconds. */
  durationMs: number;
}

/** Maximum file size to pre-read (64 KB). Larger files are skipped. */
const MAX_FILE_SIZE = 64 * 1024;

/** Maximum number of files to pre-read. */
const MAX_FILES = 20;

/**
 * Perform speculative pre-work for a task.
 * Reads files mentioned in the task to provide context.
 */
export function speculate(mentionedPaths: string[], cwd: string): SpeculativeResult {
  const start = Date.now();
  const preReadFiles = new Map<string, string>();
  const missingFiles: string[] = [];
  let totalBytes = 0;

  const paths = mentionedPaths.slice(0, MAX_FILES);

  for (const path of paths) {
    const fullPath = join(cwd, path);

    if (!existsSync(fullPath)) {
      missingFiles.push(path);
      continue;
    }

    try {
      const stat = statSync(fullPath);
      if (!stat.isFile() || stat.size > MAX_FILE_SIZE) continue;

      const content = readFileSync(fullPath, "utf8");
      preReadFiles.set(path, content);
      totalBytes += content.length;
    } catch {
      // Skip unreadable files silently
    }
  }

  return {
    preReadFiles,
    missingFiles,
    totalBytes,
    used: false,
    durationMs: Date.now() - start,
  };
}

/**
 * Reconcile speculative results with the solver's authoritative plan.
 * Packages speculator findings as dispatch context when relevant.
 *
 * Returns additional context text to append to the dispatch task,
 * or null if speculative work is not applicable.
 */
export function reconcile(speculation: SpeculativeResult, planAgent: string, _planTask: string): string | null {
  if (speculation.preReadFiles.size === 0 && speculation.missingFiles.length === 0) {
    return null;
  }

  const lines: string[] = [];

  // Report missing files so the agent does not waste time looking for them
  if (speculation.missingFiles.length > 0) {
    lines.push(`Files not found: ${speculation.missingFiles.join(", ")}`);
  }

  // For scout and reviewer agents, include file summaries
  if (planAgent === "scout" || planAgent === "reviewer" || planAgent === "planner") {
    for (const [path, content] of speculation.preReadFiles) {
      const lineCount = content.split("\n").length;
      lines.push(`${path}: ${lineCount} lines`);
    }
  }

  if (lines.length === 0) return null;

  speculation.used = true;
  return `\n--- Pre-read context ---\n${lines.join("\n")}\n---`;
}
