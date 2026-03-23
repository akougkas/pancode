/**
 * Persistent dispatch ledger stored as NDJSON.
 *
 * Every completed dispatch appends one JSON line to
 * `.pancode/dispatch-ledger.ndjson`. The ledger is bounded by
 * PANCODE_LEDGER_MAX (default 5000). When the count exceeds the cap,
 * the oldest 20% of entries are pruned on the next write.
 *
 * The existing runs.json and metrics.json continue serving their
 * purposes (quick lookups for /runs and /cost). This ledger is the
 * comprehensive, persistent record for historical analysis.
 */

import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

const DEFAULT_LEDGER_MAX = 5000;

export interface DispatchLedgerEntry {
  ts: string;
  runId: string;
  agent: string;
  runtime: string;
  model: string | null;
  task: string;
  status: string;
  exitCode: number;
  wallMs: number;
  tokens: {
    in: number | null;
    out: number | null;
    cacheRead: number | null;
    cacheWrite: number | null;
  };
  cost: number | null;
  turns: number | null;
  error: string | null;
}

export class DispatchLedger {
  private readonly filePath: string;
  private readonly maxEntries: number;
  private entryCount: number;

  constructor(runtimeRoot: string, maxEntries?: number) {
    this.filePath = join(runtimeRoot, "dispatch-ledger.ndjson");
    const envMax = Number.parseInt(process.env.PANCODE_LEDGER_MAX ?? "", 10);
    this.maxEntries = maxEntries ?? (Number.isFinite(envMax) && envMax > 0 ? envMax : DEFAULT_LEDGER_MAX);
    this.entryCount = this.countEntries();
  }

  private countEntries(): number {
    if (!existsSync(this.filePath)) return 0;
    try {
      const content = readFileSync(this.filePath, "utf8");
      return content.split("\n").filter((line) => line.trim().length > 0).length;
    } catch {
      return 0;
    }
  }

  append(entry: DispatchLedgerEntry): void {
    const dir = dirname(this.filePath);
    mkdirSync(dir, { recursive: true });

    const line = `${JSON.stringify(entry)}\n`;
    appendFileSync(this.filePath, line, "utf8");
    this.entryCount++;

    if (this.entryCount > this.maxEntries) {
      this.prune();
    }
  }

  /**
   * Remove the oldest 20% of entries via atomic temp-file-then-rename.
   */
  private prune(): void {
    if (!existsSync(this.filePath)) return;
    try {
      const content = readFileSync(this.filePath, "utf8");
      const lines = content.split("\n").filter((line) => line.trim().length > 0);
      const pruneCount = Math.ceil(lines.length * 0.2);
      const remaining = lines.slice(pruneCount);
      const tmpPath = `${this.filePath}.tmp`;
      writeFileSync(tmpPath, `${remaining.join("\n")}\n`, "utf8");
      renameSync(tmpPath, this.filePath);
      this.entryCount = remaining.length;
    } catch (err) {
      console.error(
        `[pancode:observability] Dispatch ledger prune failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  getPath(): string {
    return this.filePath;
  }
}
