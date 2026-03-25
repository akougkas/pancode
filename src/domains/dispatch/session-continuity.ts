/**
 * Session continuity store for CLI and SDK runtime adapters.
 *
 * Stores session metadata (taskId, sessionId) from completed dispatches and
 * generates continuation args for follow-up dispatches to the same agent+runtime.
 *
 * Memory is in-process only. No persistence across PanCode restarts, which is
 * correct because agent sessions are process-bound.
 */

const DEFAULT_TTL_MS = 30 * 60 * 1000; // 30 minutes

interface SessionEntry {
  taskId?: string;
  sessionId?: string;
  timestamp: number;
}

const store = new Map<string, SessionEntry>();

function makeKey(agentName: string, runtimeId: string): string {
  return `${agentName}:${runtimeId}`;
}

function ttlMs(): number {
  const env = Number.parseInt(process.env.PANCODE_SESSION_TTL_MS ?? "", 10);
  return Number.isFinite(env) && env > 0 ? env : DEFAULT_TTL_MS;
}

/**
 * Store session metadata from a completed dispatch.
 * Overwrites any existing entry for the same agent+runtime pair.
 */
export function storeSessionMeta(
  agentName: string,
  runtimeId: string,
  meta: { taskId?: string; sessionId?: string },
): void {
  if (!meta.taskId && !meta.sessionId) return;
  store.set(makeKey(agentName, runtimeId), {
    taskId: meta.taskId,
    sessionId: meta.sessionId,
    timestamp: Date.now(),
  });
}

/**
 * Generate runtime-specific continuation args for a follow-up dispatch.
 *
 * Returns an empty array if no session metadata exists, the entry has expired,
 * or the user already specified continuation flags in runtimeArgs.
 *
 * Runtime-specific arg generation:
 *   cli:opencode    -> ["--continue", "--session", sessionId]
 *   cli:claude-code -> ["--resume", sessionId]
 *   sdk:claude-code -> ["--resume", sessionId]
 */
export function getContinuationArgs(agentName: string, runtimeId: string, existingRuntimeArgs: string[]): string[] {
  const entry = store.get(makeKey(agentName, runtimeId));
  if (!entry) return [];

  if (Date.now() - entry.timestamp > ttlMs()) {
    store.delete(makeKey(agentName, runtimeId));
    return [];
  }

  // Do not override user-specified continuation flags.
  if (
    existingRuntimeArgs.includes("--continue") ||
    existingRuntimeArgs.includes("-T") ||
    existingRuntimeArgs.includes("--session") ||
    existingRuntimeArgs.includes("--resume")
  ) {
    return [];
  }

  switch (runtimeId) {
    case "cli:opencode":
      if (entry.sessionId) return ["--continue", "--session", entry.sessionId];
      break;
    case "cli:claude-code":
    case "sdk:claude-code":
      if (entry.sessionId) return ["--resume", entry.sessionId];
      break;
  }

  return [];
}

/** Clear all stored sessions. Called on session reset. */
export function clearSessionStore(): void {
  store.clear();
}

/** Number of stored sessions (for diagnostics). */
export function sessionStoreSize(): number {
  return store.size;
}
