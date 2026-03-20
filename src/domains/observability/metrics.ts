import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

export interface RunMetric {
  runId: string;
  agent: string;
  status: string;
  runtime: string; // Runtime ID: "pi", "cli:claude-code", "cli:codex", etc.
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  cost: number;
  turns: number;
  durationMs: number;
  timestamp: string;
}

export interface SessionMetrics {
  totalRuns: number;
  totalCost: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  runs: RunMetric[];
}

export class MetricsLedger {
  private metrics: RunMetric[] = [];
  private readonly persistPath: string;

  constructor(runtimeRoot: string) {
    this.persistPath = join(runtimeRoot, "metrics.json");
    this.load();
  }

  private load(): void {
    if (!existsSync(this.persistPath)) return;
    try {
      const raw = readFileSync(this.persistPath, "utf8");
      this.metrics = JSON.parse(raw) as RunMetric[];
    } catch {
      this.metrics = [];
    }
  }

  persist(): void {
    const dir = dirname(this.persistPath);
    mkdirSync(dir, { recursive: true });
    writeFileSync(this.persistPath, JSON.stringify(this.metrics, null, 2), "utf8");
  }

  record(metric: RunMetric): void {
    this.metrics.push(metric);
    this.persist();
  }

  getSummary(): SessionMetrics {
    let totalCost = 0;
    let totalInputTokens = 0;
    let totalOutputTokens = 0;

    for (const m of this.metrics) {
      totalCost += m.cost;
      totalInputTokens += m.inputTokens;
      totalOutputTokens += m.outputTokens;
    }

    return {
      totalRuns: this.metrics.length,
      totalCost,
      totalInputTokens,
      totalOutputTokens,
      runs: [...this.metrics],
    };
  }

  getRecent(count: number): RunMetric[] {
    return this.metrics.slice(-count);
  }

  serialize(): RunMetric[] {
    return [...this.metrics];
  }

  deserialize(data: RunMetric[]): void {
    this.metrics = data;
  }
}
