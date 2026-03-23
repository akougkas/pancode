/**
 * Path-level locking for concurrent mutable dispatch workers.
 *
 * Prevents two workers from editing the same file simultaneously.
 * Lock acquisition happens before spawning a mutable worker;
 * release happens on worker completion (success or failure).
 *
 * The merge gate creates pre-merge snapshot tags so worktree merges
 * can be rolled back with /undo.
 */

export interface PathLockConflict {
  path: string;
  holderRunId: string;
}

export interface MergeGateResult {
  success: boolean;
  tagName: string | null;
  error?: string;
}

/** In-memory lock table: file path to the run ID that holds the lock. */
const pathLocks = new Map<string, string>();

/**
 * Attempt to acquire locks on the given file paths for a run.
 * Returns an empty array on success. Returns conflict details on failure.
 * Acquisition is atomic: either all paths lock or none do.
 */
export function acquirePathLocks(paths: string[], runId: string): PathLockConflict[] {
  const conflicts: PathLockConflict[] = [];

  for (const path of paths) {
    const normalized = normalizePath(path);
    const holder = pathLocks.get(normalized);
    if (holder && holder !== runId) {
      conflicts.push({ path: normalized, holderRunId: holder });
    }
  }

  if (conflicts.length > 0) {
    return conflicts;
  }

  // All clear: acquire all locks atomically.
  for (const path of paths) {
    pathLocks.set(normalizePath(path), runId);
  }

  return [];
}

/**
 * Release all locks held by a given run ID.
 * Call this in the finally block after worker completion.
 */
export function releasePathLocks(runId: string): number {
  let released = 0;
  for (const [path, holder] of pathLocks) {
    if (holder === runId) {
      pathLocks.delete(path);
      released++;
    }
  }
  return released;
}

/**
 * Get all currently held locks.
 * Useful for diagnostics and the /locks slash command.
 */
export function getActiveLocks(): ReadonlyMap<string, string> {
  return pathLocks;
}

/**
 * Get all paths locked by a specific run.
 */
export function getLocksForRun(runId: string): string[] {
  const paths: string[] = [];
  for (const [path, holder] of pathLocks) {
    if (holder === runId) {
      paths.push(path);
    }
  }
  return paths;
}

/**
 * Force-release all locks. Used during session shutdown.
 */
export function releaseAllLocks(): void {
  pathLocks.clear();
}

/**
 * Extract file paths referenced in a task prompt using heuristics.
 *
 * This is intentionally conservative: it looks for patterns that resemble
 * file paths (containing "/" or "\" with file extensions). False negatives
 * are acceptable because they just mean less lock coverage. False positives
 * are acceptable because they just mean slightly more contention.
 */
export function extractPathsFromTask(task: string): string[] {
  const paths = new Set<string>();

  // Match quoted paths: "src/foo/bar.ts" or 'src/foo/bar.ts'
  const quotedPattern = /["'`]((?:[a-zA-Z0-9_\-./\\]+\.[\w]+))["'`]/g;
  let match: RegExpExecArray | null;
  match = quotedPattern.exec(task);
  while (match !== null) {
    paths.add(normalizePath(match[1]));
    match = quotedPattern.exec(task);
  }

  // Match unquoted paths that look like file references: contain / and have an extension
  const unquotedPattern = /(?:^|\s)((?:[a-zA-Z0-9_\-.]+\/)+[a-zA-Z0-9_\-.]+\.[\w]+)/g;
  match = unquotedPattern.exec(task);
  while (match !== null) {
    paths.add(normalizePath(match[1]));
    match = unquotedPattern.exec(task);
  }

  return [...paths];
}

/** Normalize a path for consistent lock table lookups. */
function normalizePath(p: string): string {
  // Remove leading ./ and normalize separators
  return p.replace(/\\/g, "/").replace(/^\.\//, "").replace(/\/+/g, "/");
}

/** Pre-merge tag prefix for rollback support. */
export const PRE_MERGE_TAG_PREFIX = "pancode/pre-merge/";

/**
 * Generate the pre-merge tag name for a given run ID.
 * The orchestrator creates this tag before merging worktree changes.
 */
export function preMergeTagName(runId: string): string {
  return `${PRE_MERGE_TAG_PREFIX}${runId}`;
}
