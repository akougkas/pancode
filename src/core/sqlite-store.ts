/**
 * SQLite persistence layer for PanCode.
 *
 * Phase 1 implementation: dual-write mode. SQLite runs alongside existing JSON
 * files. New data writes to both. Future phases will promote SQLite to source
 * of truth and demote JSON to ephemeral cache.
 *
 * Uses better-sqlite3 for synchronous, WAL-mode operation. The database file
 * lives at `<runtimeRoot>/pancode.db`.
 */

import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";

// ---------------------------------------------------------------------------
// Dynamic import guard
// ---------------------------------------------------------------------------
// better-sqlite3 is an optional native dependency. If unavailable, the store
// falls back to a no-op implementation so JSON persistence continues to work.

interface SqliteStatement {
  run(...params: unknown[]): { changes: number; lastInsertRowid: number | bigint };
  // biome-ignore lint/suspicious/noExplicitAny: SQLite returns untyped row objects
  get(...params: unknown[]): any;
  // biome-ignore lint/suspicious/noExplicitAny: SQLite returns untyped row arrays
  all(...params: unknown[]): any[];
}

interface SqliteDatabase {
  pragma(source: string): unknown;
  exec(source: string): void;
  prepare(source: string): SqliteStatement;
  close(): void;
}

type SqliteConstructor = new (filename: string, options?: Record<string, unknown>) => SqliteDatabase;

let DatabaseConstructor: SqliteConstructor | null = null;

async function loadBetterSqlite3(): Promise<SqliteConstructor | null> {
  try {
    // biome-ignore lint/suspicious/noExplicitAny: dynamic import of optional native module
    const mod: any = await import("better-sqlite3");
    return (mod.default ?? mod) as SqliteConstructor;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS dispatches (
  run_id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL DEFAULT '',
  agent TEXT NOT NULL,
  runtime TEXT NOT NULL,
  model TEXT,
  task TEXT,
  status TEXT NOT NULL,
  exit_code INTEGER,
  wall_ms INTEGER,
  tokens_in INTEGER,
  tokens_out INTEGER,
  cache_read INTEGER,
  cache_write INTEGER,
  cost REAL,
  turns INTEGER,
  error TEXT,
  cwd TEXT,
  batch_id TEXT,
  created_at TEXT NOT NULL,
  completed_at TEXT
);

CREATE TABLE IF NOT EXISTS receipts (
  receipt_id TEXT PRIMARY KEY,
  run_id TEXT REFERENCES dispatches(run_id),
  prompt_hash TEXT NOT NULL,
  task_hash TEXT NOT NULL,
  result_hash TEXT NOT NULL,
  receipt_hash TEXT NOT NULL,
  mode TEXT,
  safety_level TEXT,
  tools TEXT,
  actions_summary TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS audit_events (
  event_id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id TEXT,
  event_type TEXT NOT NULL,
  details TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  session_id TEXT PRIMARY KEY,
  started_at TEXT NOT NULL,
  ended_at TEXT,
  mode TEXT,
  safety_level TEXT,
  total_dispatches INTEGER DEFAULT 0,
  total_cost REAL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS metrics (
  metric_id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id TEXT NOT NULL,
  agent TEXT NOT NULL,
  status TEXT NOT NULL,
  runtime TEXT NOT NULL,
  input_tokens INTEGER,
  output_tokens INTEGER,
  cache_read_tokens INTEGER,
  cache_write_tokens INTEGER,
  cost REAL,
  turns INTEGER,
  duration_ms INTEGER NOT NULL,
  recorded_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_dispatches_session ON dispatches(session_id);
CREATE INDEX IF NOT EXISTS idx_dispatches_agent ON dispatches(agent);
CREATE INDEX IF NOT EXISTS idx_dispatches_status ON dispatches(status);
CREATE INDEX IF NOT EXISTS idx_dispatches_created ON dispatches(created_at);
CREATE INDEX IF NOT EXISTS idx_receipts_run ON receipts(run_id);
CREATE INDEX IF NOT EXISTS idx_audit_run ON audit_events(run_id);
CREATE INDEX IF NOT EXISTS idx_audit_type ON audit_events(event_type);
CREATE INDEX IF NOT EXISTS idx_metrics_agent ON metrics(agent);
CREATE INDEX IF NOT EXISTS idx_metrics_recorded ON metrics(recorded_at);
`;

// ---------------------------------------------------------------------------
// Row types
// ---------------------------------------------------------------------------

export interface DispatchRow {
  run_id: string;
  session_id: string;
  agent: string;
  runtime: string;
  model: string | null;
  task: string | null;
  status: string;
  exit_code: number | null;
  wall_ms: number | null;
  tokens_in: number | null;
  tokens_out: number | null;
  cache_read: number | null;
  cache_write: number | null;
  cost: number | null;
  turns: number | null;
  error: string | null;
  cwd: string | null;
  batch_id: string | null;
  created_at: string;
  completed_at: string | null;
}

export interface ReceiptRow {
  receipt_id: string;
  run_id: string;
  prompt_hash: string;
  task_hash: string;
  result_hash: string;
  receipt_hash: string;
  mode: string | null;
  safety_level: string | null;
  tools: string | null;
  actions_summary: string | null;
  created_at: string;
}

export interface AuditEventRow {
  event_id?: number;
  run_id: string | null;
  event_type: string;
  details: string;
  created_at: string;
}

export interface SessionRow {
  session_id: string;
  started_at: string;
  ended_at: string | null;
  mode: string | null;
  safety_level: string | null;
  total_dispatches: number;
  total_cost: number;
}

export interface MetricRow {
  metric_id?: number;
  run_id: string;
  agent: string;
  status: string;
  runtime: string;
  input_tokens: number | null;
  output_tokens: number | null;
  cache_read_tokens: number | null;
  cache_write_tokens: number | null;
  cost: number | null;
  turns: number | null;
  duration_ms: number;
  recorded_at: string;
}

export interface DispatchUsageUpdate {
  tokens_in: number | null;
  tokens_out: number | null;
  cache_read: number | null;
  cache_write: number | null;
  cost: number | null;
  turns: number | null;
  wall_ms: number | null;
}

// ---------------------------------------------------------------------------
// SQLite Store
// ---------------------------------------------------------------------------

export class SqliteStore {
  private db: SqliteDatabase | null = null;
  private readonly dbPath: string;
  private _available = false;

  constructor(runtimeRoot: string) {
    this.dbPath = join(runtimeRoot, "pancode.db");
  }

  /**
   * Initialize the store. Must be called once at startup.
   * Returns true if SQLite is available, false if falling back to JSON-only.
   */
  async initialize(): Promise<boolean> {
    try {
      if (!DatabaseConstructor) {
        DatabaseConstructor = await loadBetterSqlite3();
      }
      if (!DatabaseConstructor) {
        console.error("[pancode:sqlite] better-sqlite3 not available. Using JSON-only persistence.");
        return false;
      }

      mkdirSync(dirname(this.dbPath), { recursive: true });
      this.db = new DatabaseConstructor(this.dbPath);

      // WAL mode for concurrent read/write from orchestrator and observers.
      this.db.pragma("journal_mode = WAL");
      this.db.pragma("synchronous = NORMAL");
      this.db.pragma("foreign_keys = ON");

      // Create tables.
      this.db.exec(SCHEMA_SQL);

      this._available = true;
      console.error(`[pancode:sqlite] Database initialized at ${this.dbPath}`);
      return true;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[pancode:sqlite] Failed to initialize: ${msg}. Using JSON-only persistence.`);
      this._available = false;
      return false;
    }
  }

  /** Whether the SQLite store is operational. */
  get available(): boolean {
    return this._available && this.db !== null;
  }

  /** Close the database connection. */
  close(): void {
    if (this.db) {
      try {
        this.db.close();
      } catch {
        // Ignore close errors during shutdown.
      }
      this.db = null;
      this._available = false;
    }
  }

  // -------------------------------------------------------------------------
  // Dispatches
  // -------------------------------------------------------------------------

  insertDispatch(r: DispatchRow): void {
    if (!this.db) return;
    try {
      this.db
        .prepare(`
        INSERT OR REPLACE INTO dispatches
          (run_id, session_id, agent, runtime, model, task, status, exit_code,
           wall_ms, tokens_in, tokens_out, cache_read, cache_write, cost, turns,
           error, cwd, batch_id, created_at, completed_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
        .run(
          r.run_id,
          r.session_id,
          r.agent,
          r.runtime,
          r.model,
          r.task,
          r.status,
          r.exit_code,
          r.wall_ms,
          r.tokens_in,
          r.tokens_out,
          r.cache_read,
          r.cache_write,
          r.cost,
          r.turns,
          r.error,
          r.cwd,
          r.batch_id,
          r.created_at,
          r.completed_at,
        );
    } catch (err) {
      console.error(`[pancode:sqlite] insertDispatch failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  updateDispatchStatus(runId: string, status: string, completedAt: string | null): void {
    if (!this.db) return;
    try {
      this.db
        .prepare("UPDATE dispatches SET status = ?, completed_at = ? WHERE run_id = ?")
        .run(status, completedAt, runId);
    } catch (err) {
      console.error(
        `[pancode:sqlite] updateDispatchStatus failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  updateDispatchUsage(runId: string, u: DispatchUsageUpdate): void {
    if (!this.db) return;
    try {
      this.db
        .prepare(`
        UPDATE dispatches
        SET tokens_in = ?, tokens_out = ?, cache_read = ?, cache_write = ?,
            cost = ?, turns = ?, wall_ms = ?
        WHERE run_id = ?
      `)
        .run(u.tokens_in, u.tokens_out, u.cache_read, u.cache_write, u.cost, u.turns, u.wall_ms, runId);
    } catch (err) {
      console.error(`[pancode:sqlite] updateDispatchUsage failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  getDispatch(runId: string): DispatchRow | undefined {
    if (!this.db) return undefined;
    try {
      return this.db.prepare("SELECT * FROM dispatches WHERE run_id = ?").get(runId) as DispatchRow | undefined;
    } catch {
      return undefined;
    }
  }

  getRecentDispatches(limit: number): DispatchRow[] {
    if (!this.db) return [];
    try {
      return this.db.prepare("SELECT * FROM dispatches ORDER BY created_at DESC LIMIT ?").all(limit) as DispatchRow[];
    } catch {
      return [];
    }
  }

  getDispatchesByAgent(agent: string, limit = 100): DispatchRow[] {
    if (!this.db) return [];
    try {
      return this.db
        .prepare("SELECT * FROM dispatches WHERE agent = ? ORDER BY created_at DESC LIMIT ?")
        .all(agent, limit) as DispatchRow[];
    } catch {
      return [];
    }
  }

  getDispatchesByStatus(status: string, limit = 100): DispatchRow[] {
    if (!this.db) return [];
    try {
      return this.db
        .prepare("SELECT * FROM dispatches WHERE status = ? ORDER BY created_at DESC LIMIT ?")
        .all(status, limit) as DispatchRow[];
    } catch {
      return [];
    }
  }

  // -------------------------------------------------------------------------
  // Receipts
  // -------------------------------------------------------------------------

  insertReceipt(r: ReceiptRow): void {
    if (!this.db) return;
    try {
      this.db
        .prepare(`
        INSERT OR REPLACE INTO receipts
          (receipt_id, run_id, prompt_hash, task_hash, result_hash, receipt_hash,
           mode, safety_level, tools, actions_summary, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
        .run(
          r.receipt_id,
          r.run_id,
          r.prompt_hash,
          r.task_hash,
          r.result_hash,
          r.receipt_hash,
          r.mode,
          r.safety_level,
          r.tools,
          r.actions_summary,
          r.created_at,
        );
    } catch (err) {
      console.error(`[pancode:sqlite] insertReceipt failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  getReceipt(receiptId: string): ReceiptRow | undefined {
    if (!this.db) return undefined;
    try {
      return this.db.prepare("SELECT * FROM receipts WHERE receipt_id = ?").get(receiptId) as ReceiptRow | undefined;
    } catch {
      return undefined;
    }
  }

  getReceiptsForRun(runId: string): ReceiptRow[] {
    if (!this.db) return [];
    try {
      return this.db.prepare("SELECT * FROM receipts WHERE run_id = ?").all(runId) as ReceiptRow[];
    } catch {
      return [];
    }
  }

  // -------------------------------------------------------------------------
  // Audit events
  // -------------------------------------------------------------------------

  insertAuditEvent(r: Omit<AuditEventRow, "event_id">): void {
    if (!this.db) return;
    try {
      this.db
        .prepare("INSERT INTO audit_events (run_id, event_type, details, created_at) VALUES (?, ?, ?, ?)")
        .run(r.run_id, r.event_type, r.details, r.created_at);
    } catch (err) {
      console.error(`[pancode:sqlite] insertAuditEvent failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  getAuditEvents(runId: string): AuditEventRow[] {
    if (!this.db) return [];
    try {
      return this.db
        .prepare("SELECT * FROM audit_events WHERE run_id = ? ORDER BY created_at")
        .all(runId) as AuditEventRow[];
    } catch {
      return [];
    }
  }

  getAuditEventsByType(eventType: string, limit = 100): AuditEventRow[] {
    if (!this.db) return [];
    try {
      return this.db
        .prepare("SELECT * FROM audit_events WHERE event_type = ? ORDER BY created_at DESC LIMIT ?")
        .all(eventType, limit) as AuditEventRow[];
    } catch {
      return [];
    }
  }

  // -------------------------------------------------------------------------
  // Sessions
  // -------------------------------------------------------------------------

  insertSession(r: SessionRow): void {
    if (!this.db) return;
    try {
      this.db
        .prepare(`
        INSERT OR REPLACE INTO sessions
          (session_id, started_at, ended_at, mode, safety_level, total_dispatches, total_cost)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `)
        .run(r.session_id, r.started_at, r.ended_at, r.mode, r.safety_level, r.total_dispatches, r.total_cost);
    } catch (err) {
      console.error(`[pancode:sqlite] insertSession failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  updateSessionEnd(sessionId: string, endedAt: string, totalDispatches: number, totalCost: number): void {
    if (!this.db) return;
    try {
      this.db
        .prepare("UPDATE sessions SET ended_at = ?, total_dispatches = ?, total_cost = ? WHERE session_id = ?")
        .run(endedAt, totalDispatches, totalCost, sessionId);
    } catch (err) {
      console.error(`[pancode:sqlite] updateSessionEnd failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  getSession(sessionId: string): SessionRow | undefined {
    if (!this.db) return undefined;
    try {
      return this.db.prepare("SELECT * FROM sessions WHERE session_id = ?").get(sessionId) as SessionRow | undefined;
    } catch {
      return undefined;
    }
  }

  getRecentSessions(limit: number): SessionRow[] {
    if (!this.db) return [];
    try {
      return this.db.prepare("SELECT * FROM sessions ORDER BY started_at DESC LIMIT ?").all(limit) as SessionRow[];
    } catch {
      return [];
    }
  }

  // -------------------------------------------------------------------------
  // Metrics
  // -------------------------------------------------------------------------

  insertMetric(r: Omit<MetricRow, "metric_id">): void {
    if (!this.db) return;
    try {
      this.db
        .prepare(`
        INSERT INTO metrics
          (run_id, agent, status, runtime, input_tokens, output_tokens,
           cache_read_tokens, cache_write_tokens, cost, turns, duration_ms, recorded_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
        .run(
          r.run_id,
          r.agent,
          r.status,
          r.runtime,
          r.input_tokens,
          r.output_tokens,
          r.cache_read_tokens,
          r.cache_write_tokens,
          r.cost,
          r.turns,
          r.duration_ms,
          r.recorded_at,
        );
    } catch (err) {
      console.error(`[pancode:sqlite] insertMetric failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  getMetricsByAgent(agent: string, limit = 100): MetricRow[] {
    if (!this.db) return [];
    try {
      return this.db
        .prepare("SELECT * FROM metrics WHERE agent = ? ORDER BY recorded_at DESC LIMIT ?")
        .all(agent, limit) as MetricRow[];
    } catch {
      return [];
    }
  }

  getMetricsSummary(): { totalRuns: number; totalCost: number; totalTokensIn: number; totalTokensOut: number } {
    if (!this.db) return { totalRuns: 0, totalCost: 0, totalTokensIn: 0, totalTokensOut: 0 };
    try {
      const result = this.db
        .prepare(`
        SELECT
          COUNT(*) as total_runs,
          COALESCE(SUM(cost), 0) as total_cost,
          COALESCE(SUM(input_tokens), 0) as total_tokens_in,
          COALESCE(SUM(output_tokens), 0) as total_tokens_out
        FROM metrics
      `)
        .get();
      if (!result) return { totalRuns: 0, totalCost: 0, totalTokensIn: 0, totalTokensOut: 0 };
      return {
        totalRuns: Number(result.total_runs) || 0,
        totalCost: Number(result.total_cost) || 0,
        totalTokensIn: Number(result.total_tokens_in) || 0,
        totalTokensOut: Number(result.total_tokens_out) || 0,
      };
    } catch {
      return { totalRuns: 0, totalCost: 0, totalTokensIn: 0, totalTokensOut: 0 };
    }
  }

  // -------------------------------------------------------------------------
  // Aggregate queries
  // -------------------------------------------------------------------------

  /** Get cost breakdown by agent for all dispatches. */
  getCostByAgent(): Array<{ agent: string; total_cost: number; dispatch_count: number }> {
    if (!this.db) return [];
    try {
      return this.db
        .prepare(`
        SELECT agent, COALESCE(SUM(cost), 0) as total_cost, COUNT(*) as dispatch_count
        FROM dispatches
        WHERE cost IS NOT NULL
        GROUP BY agent
        ORDER BY total_cost DESC
      `)
        .all() as Array<{ agent: string; total_cost: number; dispatch_count: number }>;
    } catch {
      return [];
    }
  }

  /** Get dispatch count by status for dashboard display. */
  getStatusCounts(): Array<{ status: string; count: number }> {
    if (!this.db) return [];
    try {
      return this.db
        .prepare(`
        SELECT status, COUNT(*) as count
        FROM dispatches
        GROUP BY status
        ORDER BY count DESC
      `)
        .all() as Array<{ status: string; count: number }>;
    } catch {
      return [];
    }
  }

  /** Get the database file path. */
  getPath(): string {
    return this.dbPath;
  }
}

// ---------------------------------------------------------------------------
// Singleton access
// ---------------------------------------------------------------------------

let storeInstance: SqliteStore | null = null;

/**
 * Get or create the SQLite store singleton.
 * Must call initialize() on the returned store before use.
 */
export function getSqliteStore(runtimeRoot: string): SqliteStore {
  if (!storeInstance) {
    storeInstance = new SqliteStore(runtimeRoot);
  }
  return storeInstance;
}

/** Get the existing store instance (returns null if not yet created). */
export function getExistingSqliteStore(): SqliteStore | null {
  return storeInstance;
}
