import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { atomicWriteJsonSync } from "../../core/config-writer";
import { DEFAULT_MAX_METRICS } from "../../core/defaults";
import { type SessionBoundary, isSessionBoundary } from "../../core/ledger-types";

export const MAX_METRIC_ENTRIES = Number(process.env.PANCODE_MAX_METRICS) || DEFAULT_MAX_METRICS;

export interface RunMetric {
  runId: string;
  agent: string;
  status: string;
  runtime: string; // Runtime ID: "pi", "cli:claude-code", "cli:codex", etc.
  inputTokens: number | null;
  outputTokens: number | null;
  cacheReadTokens: number | null;
  cacheWriteTokens: number | null;
  cost: number | null;
  turns: number | null;
  durationMs: number;
  timestamp: string;
}

export type MetricLedgerEntry = RunMetric | SessionBoundary;

export interface SessionMetrics {
  totalRuns: number;
  /** Null when no run reported cost data. */
  totalCost: number | null;
  /** Null when no run reported input token data. */
  totalInputTokens: number | null;
  /** Null when no run reported output token data. */
  totalOutputTokens: number | null;
  runs: RunMetric[];
}

export class MetricsLedger {
  private entries: MetricLedgerEntry[] = [];
  private readonly persistPath: string;

  constructor(runtimeRoot: string) {
    this.persistPath = join(runtimeRoot, "metrics.json");
    this.load();
    this.trim();
  }

  private load(): void {
    if (!existsSync(this.persistPath)) return;
    try {
      const raw = readFileSync(this.persistPath, "utf8");
      this.entries = JSON.parse(raw) as MetricLedgerEntry[];
    } catch {
      this.entries = [];
    }
  }

  // SessionBoundary markers are exempt from the entry count.
  // Physical array size may exceed MAX_METRIC_ENTRIES by the number of session markers.
  // This is intentional: markers are lightweight and provide session attribution.
  private trim(): void {
    const metrics = this.getMetrics();
    if (metrics.length <= MAX_METRIC_ENTRIES) return;

    let toRemove = metrics.length - MAX_METRIC_ENTRIES;
    this.entries = this.entries.filter((entry) => {
      if (isSessionBoundary(entry)) return true;
      if (toRemove > 0) {
        toRemove--;
        return false;
      }
      return true;
    });
  }

  persist(): void {
    try {
      atomicWriteJsonSync(this.persistPath, this.entries);
    } catch (err) {
      console.error(`[pancode:metrics] Failed to persist metrics: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  record(metric: RunMetric): void {
    this.entries.push(metric);
    this.trim();
    this.persist();
  }

  addSessionMarker(marker: SessionBoundary): void {
    this.entries.push(marker);
    this.persist();
  }

  private getMetrics(): RunMetric[] {
    return this.entries.filter((e): e is RunMetric => !isSessionBoundary(e));
  }

  getSummary(): SessionMetrics {
    const metrics = this.getMetrics();
    let totalCost: number | null = null;
    let totalInputTokens: number | null = null;
    let totalOutputTokens: number | null = null;

    for (const m of metrics) {
      if (m.cost != null) totalCost = (totalCost ?? 0) + m.cost;
      if (m.inputTokens != null) totalInputTokens = (totalInputTokens ?? 0) + m.inputTokens;
      if (m.outputTokens != null) totalOutputTokens = (totalOutputTokens ?? 0) + m.outputTokens;
    }

    return {
      totalRuns: metrics.length,
      totalCost,
      totalInputTokens,
      totalOutputTokens,
      runs: [...metrics],
    };
  }

  getRecent(count: number): RunMetric[] {
    return this.getMetrics().slice(-count);
  }

  serialize(): RunMetric[] {
    return [...this.getMetrics()];
  }

  deserialize(data: RunMetric[]): void {
    const markers = this.entries.filter(isSessionBoundary);
    this.entries = [...markers, ...data];
  }
}
