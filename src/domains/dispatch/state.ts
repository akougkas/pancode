import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { type SessionBoundary, isSessionBoundary } from "../../core/ledger-types";
import type { RuntimeUsage } from "../../engine/runtimes";

export { type SessionBoundary, isSessionBoundary } from "../../core/ledger-types";

export const MAX_RUN_ENTRIES = 500;

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

export type LedgerEntry = RunEnvelope | SessionBoundary;

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
    usage: {
      inputTokens: null,
      outputTokens: null,
      cacheReadTokens: null,
      cacheWriteTokens: null,
      cost: null,
      turns: null,
    },
    startedAt: new Date().toISOString(),
    completedAt: null,
    batchId: batchId ?? null,
    cwd,
  };
}

export class RunLedger {
  private entries: LedgerEntry[] = [];
  private readonly persistPath: string;

  constructor(runtimeRoot: string) {
    this.persistPath = join(runtimeRoot, "runs.json");
    this.load();
    this.trim();
  }

  private load(): void {
    if (!existsSync(this.persistPath)) return;
    try {
      const raw = readFileSync(this.persistPath, "utf8");
      this.entries = JSON.parse(raw) as LedgerEntry[];
    } catch {
      this.entries = [];
    }
  }

  private trim(): void {
    const runs = this.getRuns();
    if (runs.length <= MAX_RUN_ENTRIES) return;

    const activeRuns = runs.filter((r) => r.status === "running" || r.status === "pending");
    const completedRuns = runs.filter((r) => r.status !== "running" && r.status !== "pending");
    const completedSlots = Math.max(0, MAX_RUN_ENTRIES - activeRuns.length);
    const keepIds = new Set([...activeRuns.map((r) => r.id), ...completedRuns.slice(-completedSlots).map((r) => r.id)]);

    this.entries = this.entries.filter((entry) => {
      if (isSessionBoundary(entry)) return true;
      return keepIds.has((entry as RunEnvelope).id);
    });
  }

  persist(): void {
    const dir = dirname(this.persistPath);
    try {
      mkdirSync(dir, { recursive: true });
      writeFileSync(this.persistPath, JSON.stringify(this.entries, null, 2), "utf8");
    } catch (err) {
      console.error(
        `[pancode:dispatch] Failed to persist run ledger: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  add(run: RunEnvelope): void {
    this.entries.push(run);
    this.trim();
    this.persist();
  }

  addSessionMarker(marker: SessionBoundary): void {
    this.entries.push(marker);
    this.persist();
  }

  private getRuns(): RunEnvelope[] {
    return this.entries.filter((e): e is RunEnvelope => !isSessionBoundary(e));
  }

  update(id: string, patch: Partial<RunEnvelope>): void {
    const run = this.getRuns().find((r) => r.id === id);
    if (run) {
      Object.assign(run, patch);
      this.persist();
    }
  }

  get(id: string): RunEnvelope | undefined {
    return this.getRuns().find((r) => r.id === id);
  }

  getAll(): RunEnvelope[] {
    return [...this.getRuns()];
  }

  getActive(): RunEnvelope[] {
    return this.getRuns().filter((r) => r.status === "running" || r.status === "pending");
  }

  getRecent(count: number): RunEnvelope[] {
    return this.getRuns().slice(-count);
  }

  markInterrupted(): void {
    for (const entry of this.entries) {
      if (isSessionBoundary(entry)) continue;
      if (entry.status === "running" || entry.status === "pending") {
        entry.status = "interrupted";
        entry.completedAt = new Date().toISOString();
      }
    }
    this.persist();
  }

  toJSON(): RunEnvelope[] {
    return this.getRuns();
  }

  fromJSON(data: RunEnvelope[]): void {
    const markers = this.entries.filter(isSessionBoundary);
    this.entries = [...markers, ...data];
  }
}
