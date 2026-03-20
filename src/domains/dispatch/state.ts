import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { RuntimeUsage } from "../../engine/runtimes";

export type RunStatus = "pending" | "running" | "done" | "error" | "timeout" | "cancelled" | "interrupted";

export type RunUsage = RuntimeUsage;

export interface RunEnvelope {
  id: string;
  task: string;
  agent: string;
  model: string | null;
  runtime: string; // Runtime ID: "pi", "cli:claude-code", "cli:codex", etc.
  status: RunStatus;
  result: string;
  error: string;
  usage: RunUsage;
  startedAt: string;
  completedAt: string | null;
  batchId: string | null;
  cwd: string;
}

export function createRunEnvelope(
  task: string,
  agent: string,
  cwd: string,
  batchId?: string,
  runtime?: string,
): RunEnvelope {
  return {
    id: randomUUID().slice(0, 8),
    task,
    agent,
    model: null,
    runtime: runtime ?? "pi",
    status: "pending",
    result: "",
    error: "",
    usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, cost: 0, turns: 0 },
    startedAt: new Date().toISOString(),
    completedAt: null,
    batchId: batchId ?? null,
    cwd,
  };
}

export class RunLedger {
  private runs: RunEnvelope[] = [];
  private readonly persistPath: string;

  constructor(runtimeRoot: string) {
    this.persistPath = join(runtimeRoot, "runs.json");
    this.load();
  }

  private load(): void {
    if (!existsSync(this.persistPath)) return;
    try {
      const raw = readFileSync(this.persistPath, "utf8");
      this.runs = JSON.parse(raw) as RunEnvelope[];
    } catch {
      this.runs = [];
    }
  }

  persist(): void {
    const dir = dirname(this.persistPath);
    try {
      mkdirSync(dir, { recursive: true });
      writeFileSync(this.persistPath, JSON.stringify(this.runs, null, 2), "utf8");
    } catch (err) {
      console.error(
        `[pancode:dispatch] Failed to persist run ledger: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  add(run: RunEnvelope): void {
    this.runs.push(run);
    this.persist();
  }

  update(id: string, patch: Partial<RunEnvelope>): void {
    const run = this.runs.find((r) => r.id === id);
    if (run) {
      Object.assign(run, patch);
      this.persist();
    }
  }

  get(id: string): RunEnvelope | undefined {
    return this.runs.find((r) => r.id === id);
  }

  getAll(): RunEnvelope[] {
    return [...this.runs];
  }

  getActive(): RunEnvelope[] {
    return this.runs.filter((r) => r.status === "running" || r.status === "pending");
  }

  getRecent(count: number): RunEnvelope[] {
    return this.runs.slice(-count);
  }

  markInterrupted(): void {
    for (const run of this.runs) {
      if (run.status === "running" || run.status === "pending") {
        run.status = "interrupted";
        run.completedAt = new Date().toISOString();
      }
    }
    this.persist();
  }

  toJSON(): RunEnvelope[] {
    return this.runs;
  }

  fromJSON(data: RunEnvelope[]): void {
    this.runs = data;
  }
}
