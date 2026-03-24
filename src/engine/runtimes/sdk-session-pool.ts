/**
 * Session pool for SDK runtime sessions.
 *
 * Tracks active and recently-completed SDK sessions with their accumulated
 * cost, turn count, and timing metadata. Supports session reuse within a
 * TTL window (default 30 minutes) and provides diagnostics for the TUI.
 *
 * This pool manages session metadata only. Actual Query objects are created
 * per-dispatch since the SDK's query() returns an async generator that
 * exhausts on completion. Session reuse works through the SDK's `resume`
 * option, which reconstructs the conversation from the stored session.
 */

const DEFAULT_TTL_MS = 30 * 60 * 1000; // 30 minutes
const MAX_POOL_SIZE = 64;

/** Resolve TTL from environment or default. */
function ttlMs(): number {
  const env = Number.parseInt(process.env.PANCODE_SESSION_TTL_MS ?? "", 10);
  return Number.isFinite(env) && env > 0 ? env : DEFAULT_TTL_MS;
}

export interface PooledSession {
  /** SDK session UUID from the result message. */
  sessionId: string;
  /** Agent name that owns this session. */
  agentName: string;
  /** Runtime ID (always "sdk:claude-code" for now). */
  runtimeId: string;
  /** Model used in this session. */
  model: string | null;
  /** Accumulated cost across all dispatches in this session. */
  totalCost: number;
  /** Total turns across all dispatches. */
  totalTurns: number;
  /** Total input tokens across all dispatches. */
  totalInputTokens: number;
  /** Total output tokens across all dispatches. */
  totalOutputTokens: number;
  /** Number of dispatches that used this session. */
  dispatchCount: number;
  /** Timestamp of the session's creation. */
  createdAt: number;
  /** Timestamp of the last dispatch to this session. */
  lastUsedAt: number;
  /** UUID of the last assistant message (for precise resume). */
  lastAssistantUuid: string | null;
}

export interface SessionPoolStats {
  active: number;
  totalCost: number;
  totalDispatches: number;
  evicted: number;
}

/**
 * In-memory session pool for SDK runtime sessions.
 * Sessions are keyed by agentName:runtimeId and evicted after TTL expiry.
 */
export class SdkSessionPool {
  private readonly sessions = new Map<string, PooledSession>();
  private evicted = 0;

  private makeKey(agentName: string, runtimeId: string): string {
    return `${agentName}:${runtimeId}`;
  }

  /**
   * Get an active session for the given agent and runtime.
   * Returns null if no session exists or the session has expired.
   */
  get(agentName: string, runtimeId: string): PooledSession | null {
    const key = this.makeKey(agentName, runtimeId);
    const session = this.sessions.get(key);
    if (!session) return null;

    if (Date.now() - session.lastUsedAt > ttlMs()) {
      this.sessions.delete(key);
      this.evicted++;
      return null;
    }

    return session;
  }

  /**
   * Store or update a session after a successful dispatch.
   * Merges usage from the latest dispatch into the session totals.
   */
  upsert(
    agentName: string,
    runtimeId: string,
    sessionId: string,
    update: {
      model?: string | null;
      cost?: number;
      turns?: number;
      inputTokens?: number;
      outputTokens?: number;
      lastAssistantUuid?: string | null;
    },
  ): PooledSession {
    const key = this.makeKey(agentName, runtimeId);
    const existing = this.sessions.get(key);
    const now = Date.now();

    if (existing && existing.sessionId === sessionId) {
      // Update existing session with new dispatch data.
      existing.totalCost += update.cost ?? 0;
      existing.totalTurns += update.turns ?? 0;
      existing.totalInputTokens += update.inputTokens ?? 0;
      existing.totalOutputTokens += update.outputTokens ?? 0;
      existing.dispatchCount++;
      existing.lastUsedAt = now;
      if (update.model) existing.model = update.model;
      if (update.lastAssistantUuid !== undefined) {
        existing.lastAssistantUuid = update.lastAssistantUuid;
      }
      return existing;
    }

    // Evict old session if it exists but has a different sessionId (new session).
    if (existing) {
      this.evicted++;
    }

    // Enforce pool size limit by evicting oldest session.
    if (this.sessions.size >= MAX_POOL_SIZE) {
      this.evictOldest();
    }

    const session: PooledSession = {
      sessionId,
      agentName,
      runtimeId,
      model: update.model ?? null,
      totalCost: update.cost ?? 0,
      totalTurns: update.turns ?? 0,
      totalInputTokens: update.inputTokens ?? 0,
      totalOutputTokens: update.outputTokens ?? 0,
      dispatchCount: 1,
      createdAt: now,
      lastUsedAt: now,
      lastAssistantUuid: update.lastAssistantUuid ?? null,
    };

    this.sessions.set(key, session);
    return session;
  }

  /** Remove a specific session. */
  remove(agentName: string, runtimeId: string): boolean {
    return this.sessions.delete(this.makeKey(agentName, runtimeId));
  }

  /** Clear all sessions. */
  clear(): void {
    this.sessions.clear();
  }

  /** Evict all expired sessions. Returns the number evicted. */
  evictExpired(): number {
    const ttl = ttlMs();
    const now = Date.now();
    let count = 0;

    for (const [key, session] of this.sessions) {
      if (now - session.lastUsedAt > ttl) {
        this.sessions.delete(key);
        count++;
      }
    }

    this.evicted += count;
    return count;
  }

  /** Pool diagnostics. */
  stats(): SessionPoolStats {
    return {
      active: this.sessions.size,
      totalCost: Array.from(this.sessions.values()).reduce((sum, s) => sum + s.totalCost, 0),
      totalDispatches: Array.from(this.sessions.values()).reduce((sum, s) => sum + s.dispatchCount, 0),
      evicted: this.evicted,
    };
  }

  /** All active sessions (for diagnostics display). */
  entries(): PooledSession[] {
    return Array.from(this.sessions.values());
  }

  private evictOldest(): void {
    let oldestKey: string | null = null;
    let oldestTime = Number.POSITIVE_INFINITY;

    for (const [key, session] of this.sessions) {
      if (session.lastUsedAt < oldestTime) {
        oldestTime = session.lastUsedAt;
        oldestKey = key;
      }
    }

    if (oldestKey) {
      this.sessions.delete(oldestKey);
      this.evicted++;
    }
  }
}

/**
 * Singleton session pool for SDK runtime sessions.
 * Used by the dispatch extension to track session state across dispatches.
 */
export const sdkSessionPool = new SdkSessionPool();
