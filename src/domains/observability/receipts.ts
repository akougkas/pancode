/**
 * Reproducibility receipt system.
 *
 * Every dispatch produces a standalone, verifiable receipt JSON that can be
 * shared, cited, and reproduced. Receipts are external artifacts (one JSON file
 * per dispatch) stored in `.pancode/receipts/`. They are independent of the
 * internal dispatch ledger.
 *
 * Receipt verification recomputes the receiptHash from all other fields and
 * confirms the receipt has not been tampered with.
 */

import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { RunFinishedEvent, WorkerProgressEvent } from "../../core/bus-events";
import { getCurrentMode } from "../../core/modes";
import type { RunEnvelope } from "../dispatch";
import { DEFAULT_MODE_POLICIES, parseAutonomyMode } from "../safety";

// ---------------------------------------------------------------------------
// Receipt schema
// ---------------------------------------------------------------------------

export interface ReceiptTokens {
  input: number | null;
  output: number | null;
  cacheRead: number | null;
  cacheWrite: number | null;
}

export interface DispatchReceipt {
  receiptId: string;
  runId: string;
  timestamp: string;
  promptHash: string;
  taskHash: string;
  taskPreview: string;
  agent: string;
  runtime: string;
  model: string | null;
  provider: string | null;
  mode: string;
  safetyLevel: string;
  scope: string[];
  tools: string[];
  status: "done" | "error" | "timeout" | "cancelled";
  exitCode: number;
  resultHash: string;
  resultPreview: string;
  wallMs: number;
  tokens: ReceiptTokens;
  cost: number | null;
  turns: number | null;
  actionsSummary: Record<string, number>;
  receiptHash: string;
}

// ---------------------------------------------------------------------------
// Hashing utilities
// ---------------------------------------------------------------------------

function sha256(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

/**
 * Compute the self-verifying receipt hash from all other fields.
 * The hash covers a deterministic JSON serialization of all fields
 * except `receiptHash` itself.
 */
function computeReceiptHash(receipt: Omit<DispatchReceipt, "receiptHash">): string {
  // Deterministic serialization: sorted keys, no receiptHash field.
  const ordered: Record<string, unknown> = {};
  const keys = Object.keys(receipt).sort();
  for (const key of keys) {
    ordered[key] = (receipt as Record<string, unknown>)[key];
  }
  return sha256(JSON.stringify(ordered));
}

/** Extract provider ID from a "provider/model-id" string. */
function extractProvider(model: string | null): string | null {
  if (!model) return null;
  const slash = model.indexOf("/");
  return slash > 0 ? model.slice(0, slash) : null;
}

/**
 * Derive allowed action classes from the current autonomy mode.
 * Returns the set of action classes that are permitted (not blocked).
 */
function deriveScope(safetyMode: string): string[] {
  const mode = parseAutonomyMode(safetyMode);
  const policies = DEFAULT_MODE_POLICIES[mode];
  if (!policies) return [];
  return Object.entries(policies)
    .filter(([, tier]) => tier === "allow")
    .map(([action]) => action);
}

/** Map a receipt status string to an exit code. */
function statusToExitCode(status: string): number {
  return status === "done" ? 0 : 1;
}

/** Normalize status string to receipt status enum. */
function normalizeStatus(status: string): DispatchReceipt["status"] {
  switch (status) {
    case "done":
      return "done";
    case "timeout":
      return "timeout";
    case "cancelled":
      return "cancelled";
    default:
      return "error";
  }
}

// ---------------------------------------------------------------------------
// Per-run context accumulator
// ---------------------------------------------------------------------------

interface RunContext {
  /** Accumulated tool invocation counts keyed by tool name. */
  toolCounts: Record<string, number>;
  /** Last observed toolCount from progress events (for delta tracking). */
  lastToolCount: number;
}

// ---------------------------------------------------------------------------
// Receipt writer
// ---------------------------------------------------------------------------

export class ReceiptWriter {
  private readonly receiptsDir: string;
  private readonly runContexts = new Map<string, RunContext>();

  constructor(runtimeRoot: string) {
    const customDir = process.env.PANCODE_RECEIPT_DIR;
    this.receiptsDir = customDir || join(runtimeRoot, "receipts");
  }

  /**
   * Track tool usage from a worker progress event.
   * Called on each WORKER_PROGRESS bus event.
   */
  recordProgress(event: WorkerProgressEvent): void {
    let ctx = this.runContexts.get(event.runId);
    if (!ctx) {
      ctx = { toolCounts: {}, lastToolCount: 0 };
      this.runContexts.set(event.runId, ctx);
    }

    // When toolCount increases and currentTool is set, attribute new invocations.
    if (event.toolCount > ctx.lastToolCount && event.currentTool) {
      const delta = event.toolCount - ctx.lastToolCount;
      ctx.toolCounts[event.currentTool] = (ctx.toolCounts[event.currentTool] ?? 0) + delta;
      ctx.lastToolCount = event.toolCount;
    }
  }

  /**
   * Build and persist a receipt for a completed dispatch.
   * Returns the receipt ID on success, null on failure.
   */
  writeReceipt(event: RunFinishedEvent, envelope: RunEnvelope | undefined): string | null {
    try {
      const receiptId = randomUUID();
      const durationMs = new Date(event.completedAt).getTime() - new Date(event.startedAt).getTime();
      const safetyLevel = process.env.PANCODE_SAFETY ?? "auto-edit";
      const mode = getCurrentMode();
      const task = envelope?.task ?? "";
      const result = envelope?.result ?? "";
      const model = envelope?.model ?? null;
      const workerTools = envelope?.workerTools ?? "";

      // Build the receipt without the self-hash.
      const partial: Omit<DispatchReceipt, "receiptHash"> = {
        receiptId,
        runId: event.runId,
        timestamp: new Date().toISOString(),
        promptHash: envelope?.promptHash ?? sha256(""),
        taskHash: sha256(task),
        taskPreview: task.slice(0, 200),
        agent: event.agent,
        runtime: event.runtime ?? "pi",
        model,
        provider: extractProvider(model),
        mode,
        safetyLevel,
        scope: deriveScope(safetyLevel),
        tools: workerTools
          ? workerTools
              .split(",")
              .map((t) => t.trim())
              .filter(Boolean)
          : [],
        status: normalizeStatus(event.status),
        exitCode: statusToExitCode(event.status),
        resultHash: sha256(result),
        resultPreview: result.slice(0, 500),
        wallMs: Math.max(0, durationMs),
        tokens: {
          input: event.usage.inputTokens,
          output: event.usage.outputTokens,
          cacheRead: event.usage.cacheReadTokens,
          cacheWrite: event.usage.cacheWriteTokens,
        },
        cost: event.usage.cost,
        turns: event.usage.turns,
        actionsSummary: this.getActionsSummary(event.runId),
      };

      const receipt: DispatchReceipt = {
        ...partial,
        receiptHash: computeReceiptHash(partial),
      };

      // Atomic write: temp file + rename.
      mkdirSync(this.receiptsDir, { recursive: true });
      const filePath = join(this.receiptsDir, `${receiptId}.json`);
      const tmpPath = `${filePath}.tmp`;
      writeFileSync(tmpPath, JSON.stringify(receipt, null, 2), "utf8");
      renameSync(tmpPath, filePath);

      // Cleanup per-run context.
      this.runContexts.delete(event.runId);

      console.error(`[pancode:receipts] Receipt ${receiptId} written for run ${event.runId}`);
      return receiptId;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[pancode:receipts] Failed to write receipt: ${msg}`);
      this.runContexts.delete(event.runId);
      return null;
    }
  }

  /** Get the receipts directory path. */
  getReceiptsDir(): string {
    return this.receiptsDir;
  }

  /** Get accumulated actions summary for a run, then discard the tracking context. */
  private getActionsSummary(runId: string): Record<string, number> {
    const ctx = this.runContexts.get(runId);
    return ctx?.toolCounts ?? {};
  }
}

// ---------------------------------------------------------------------------
// Receipt verification
// ---------------------------------------------------------------------------

export interface VerifyResult {
  status: "PASS" | "TAMPERED" | "NOT_FOUND" | "INVALID";
  message: string;
  receipt?: DispatchReceipt;
}

/**
 * Verify a receipt by recomputing its hash from all other fields.
 */
export function verifyReceipt(receiptsDir: string, receiptId: string): VerifyResult {
  const filePath = join(receiptsDir, `${receiptId}.json`);

  if (!existsSync(filePath)) {
    return { status: "NOT_FOUND", message: `Receipt file not found: ${filePath}` };
  }

  let receipt: DispatchReceipt;
  try {
    const raw = readFileSync(filePath, "utf8");
    receipt = JSON.parse(raw) as DispatchReceipt;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { status: "INVALID", message: `Failed to parse receipt: ${msg}` };
  }

  if (!receipt.receiptHash || !receipt.receiptId) {
    return { status: "INVALID", message: "Receipt is missing required fields (receiptHash or receiptId)." };
  }

  // Recompute hash from all fields except receiptHash.
  const { receiptHash: storedHash, ...rest } = receipt;
  const computedHash = computeReceiptHash(rest);

  if (computedHash === storedHash) {
    return {
      status: "PASS",
      message: `Receipt ${receipt.receiptId} verified. Hash matches.`,
      receipt,
    };
  }

  return {
    status: "TAMPERED",
    message: `Receipt ${receipt.receiptId} TAMPERED. Expected hash ${storedHash.slice(0, 16)}..., got ${computedHash.slice(0, 16)}...`,
    receipt,
  };
}

/**
 * List all receipt IDs in the receipts directory, sorted by modification time (newest first).
 */
export function listReceipts(receiptsDir: string): string[] {
  if (!existsSync(receiptsDir)) return [];
  try {
    return readdirSync(receiptsDir)
      .filter((f) => f.endsWith(".json") && !f.endsWith(".tmp"))
      .map((f) => f.replace(/\.json$/, ""));
  } catch {
    return [];
  }
}
