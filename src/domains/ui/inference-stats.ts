/**
 * Live inference statistics overlay.
 *
 * Tracks per-request streaming metrics during active inference:
 * - Time-to-first-token (TTFT)
 * - Tokens per second (rolling average)
 * - Think time (for reasoning models)
 *
 * These metrics are computed from Pi SDK message_update events
 * streamed by the NDJSON path in worker-spawn.ts.
 */

export interface InferenceStats {
  /** Run ID this stat belongs to. */
  runId: string;
  /** Time from prompt submission to first token event, in milliseconds. */
  ttftMs: number | null;
  /** Rolling average tokens per second. */
  tokensPerSec: number;
  /** Time between prompt and first non-thinking token, in milliseconds. */
  thinkTimeMs: number | null;
  /** Whether inference is currently active. */
  active: boolean;
  /** When inference started (epoch ms). */
  startedAt: number;
  /** Total tokens received so far. */
  totalTokens: number;
}

export class InferenceStatsTracker {
  private readonly stats = new Map<string, InferenceStats>();

  /**
   * Mark the start of inference for a run.
   */
  startInference(runId: string): void {
    this.stats.set(runId, {
      runId,
      ttftMs: null,
      tokensPerSec: 0,
      thinkTimeMs: null,
      active: true,
      startedAt: Date.now(),
      totalTokens: 0,
    });
  }

  /**
   * Record a token event during streaming inference.
   * Called on each message_update event from the NDJSON stream.
   */
  recordTokenEvent(runId: string, tokenCount: number, isThinking: boolean): void {
    const stat = this.stats.get(runId);
    if (!stat || !stat.active) return;

    const now = Date.now();

    // TTFT: time from start to first token
    if (stat.ttftMs === null && tokenCount > 0) {
      stat.ttftMs = now - stat.startedAt;
    }

    // Think time: time from start to first non-thinking token
    if (stat.thinkTimeMs === null && !isThinking && tokenCount > 0) {
      stat.thinkTimeMs = now - stat.startedAt;
    }

    // Accumulate tokens and compute rolling tokens/sec
    stat.totalTokens += tokenCount;
    const elapsedSec = (now - stat.startedAt) / 1000;
    if (elapsedSec > 0) {
      stat.tokensPerSec = Math.round(stat.totalTokens / elapsedSec);
    }
  }

  /**
   * Mark the end of inference for a run.
   */
  endInference(runId: string): void {
    const stat = this.stats.get(runId);
    if (stat) {
      stat.active = false;
    }
  }

  /**
   * Get current stats for a run.
   */
  getStats(runId: string): InferenceStats | null {
    return this.stats.get(runId) ?? null;
  }

  /**
   * Get all active inference stats.
   */
  getActiveStats(): InferenceStats[] {
    return [...this.stats.values()].filter((s) => s.active);
  }

  /**
   * Format stats as a compact display string for the footer overlay.
   * Example: "TTFT: 450ms | 32 tok/s | thinking..."
   */
  formatOverlay(runId: string): string | null {
    const stat = this.stats.get(runId);
    if (!stat || !stat.active) return null;

    const parts: string[] = [];

    if (stat.ttftMs !== null) {
      parts.push(`TTFT: ${stat.ttftMs}ms`);
    }

    if (stat.tokensPerSec > 0) {
      parts.push(`${stat.tokensPerSec} tok/s`);
    }

    if (stat.thinkTimeMs === null && stat.ttftMs !== null) {
      parts.push("thinking...");
    }

    if (parts.length === 0) {
      parts.push("inference...");
    }

    return parts.join(" | ");
  }

  /**
   * Clean up completed inference stats older than the given age.
   */
  pruneOlderThan(maxAgeMs: number): void {
    const cutoff = Date.now() - maxAgeMs;
    for (const [runId, stat] of this.stats) {
      if (!stat.active && stat.startedAt < cutoff) {
        this.stats.delete(runId);
      }
    }
  }

  clear(): void {
    this.stats.clear();
  }
}

export const inferenceStatsTracker = new InferenceStatsTracker();
