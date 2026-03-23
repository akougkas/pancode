import { randomUUID } from "node:crypto";
import {
  type BudgetUpdatedEvent,
  BusChannel,
  type RunFinishedEvent,
  type WarningEvent,
  type WorkerProgressEvent,
} from "../../core/bus-events";
import { PanMessageType } from "../../core/message-types";
import { sharedBus } from "../../core/shared-bus";
import { PiEvent } from "../../engine/events";
import { defineExtension } from "../../engine/extensions";
import { getRunLedger } from "../dispatch";
import { DispatchLedger, type DispatchLedgerEntry } from "./dispatch-ledger";
import { runHealthChecks } from "./health";
import { MetricsLedger, type RunMetric } from "./metrics";
import { ReceiptWriter, listReceipts, verifyReceipt } from "./receipts";
import { type AuditTrail, createAuditTrail } from "./telemetry";

let metricsLedger: MetricsLedger | null = null;
let dispatchLedger: DispatchLedger | null = null;
let auditTrail: AuditTrail | null = null;
let receiptWriter: ReceiptWriter | null = null;
let budgetSnapshot = { totalCost: 0, ceiling: 10 };

export function getMetricsLedger(): MetricsLedger | null {
  return metricsLedger;
}

export function getDispatchLedger(): DispatchLedger | null {
  return dispatchLedger;
}

export function getAuditTrail(): AuditTrail | null {
  return auditTrail;
}

export function getReceiptWriter(): ReceiptWriter | null {
  return receiptWriter;
}

export const extension = defineExtension((pi) => {
  pi.on(PiEvent.SESSION_START, (_event, _ctx) => {
    const packageRoot = process.env.PANCODE_PACKAGE_ROOT;
    if (!packageRoot) {
      console.error("[pancode:observability] PANCODE_PACKAGE_ROOT is not set. Domain state will not persist.");
    }
    const runtimeRoot = packageRoot ? `${packageRoot}/.pancode` : ".pancode";
    metricsLedger = new MetricsLedger(runtimeRoot);
    dispatchLedger = new DispatchLedger(runtimeRoot);
    auditTrail = createAuditTrail(1000);
    receiptWriter = new ReceiptWriter(runtimeRoot);

    // Session boundary marker
    const sessionId = process.env.PANCODE_SESSION_ID ?? randomUUID().slice(0, 8);
    metricsLedger.addSessionMarker({ type: "session_start", timestamp: new Date().toISOString(), sessionId });
    budgetSnapshot = {
      totalCost: 0,
      ceiling: Number.parseFloat(process.env.PANCODE_BUDGET_CEILING ?? "10.0") || 10,
    };

    // Record session start
    auditTrail.record({
      domain: "session",
      event: "session_start",
      detail: "PanCode session started",
      severity: "info",
    });

    // Subscribe to dispatch events for both metrics and audit
    sharedBus.on(BusChannel.RUN_FINISHED, (payload) => {
      const event = payload as RunFinishedEvent;
      const durationMs = new Date(event.completedAt).getTime() - new Date(event.startedAt).getTime();

      const metric: RunMetric = {
        runId: event.runId,
        agent: event.agent,
        status: event.status,
        runtime: event.runtime ?? "pi",
        inputTokens: event.usage.inputTokens,
        outputTokens: event.usage.outputTokens,
        cacheReadTokens: event.usage.cacheReadTokens,
        cacheWriteTokens: event.usage.cacheWriteTokens,
        cost: event.usage.cost,
        turns: event.usage.turns,
        durationMs: Math.max(0, durationMs),
        timestamp: event.completedAt,
      };

      metricsLedger?.record(metric);

      // Persistent dispatch ledger (NDJSON, survives restart).
      // Look up the run envelope from the dispatch RunLedger for task and error fields.
      const runEnvelope = getRunLedger()?.get(event.runId);
      const ledgerEntry: DispatchLedgerEntry = {
        ts: event.completedAt,
        runId: event.runId,
        agent: event.agent,
        runtime: event.runtime ?? "pi",
        model: runEnvelope?.model ?? null,
        task: runEnvelope ? runEnvelope.task.slice(0, 200) : "",
        status: event.status,
        exitCode: event.status === "done" ? 0 : 1,
        wallMs: Math.max(0, durationMs),
        tokens: {
          in: event.usage.inputTokens,
          out: event.usage.outputTokens,
          cacheRead: event.usage.cacheReadTokens,
          cacheWrite: event.usage.cacheWriteTokens,
        },
        cost: event.usage.cost,
        turns: event.usage.turns,
        error: runEnvelope?.error || null,
      };
      dispatchLedger?.append(ledgerEntry);

      // Audit trail entry
      const severity = event.status === "error" ? "warn" : "info";
      const costLabel = event.usage.cost != null ? `$${event.usage.cost.toFixed(4)}` : "--";
      auditTrail?.record({
        domain: "dispatch",
        event: `run-${event.status}`,
        agent: event.agent,
        detail: `Run ${event.runId}: ${event.status} (${(durationMs / 1000).toFixed(1)}s, ${costLabel})`,
        severity,
      });

      // Write reproducibility receipt for this dispatch.
      receiptWriter?.writeReceipt(event, runEnvelope);
    });

    // Subscribe to worker progress for receipt action tracking
    sharedBus.on(BusChannel.WORKER_PROGRESS, (payload) => {
      const event = payload as WorkerProgressEvent;
      receiptWriter?.recordProgress(event);
    });

    // Subscribe to warnings
    sharedBus.on(BusChannel.WARNING, (payload) => {
      const event = payload as WarningEvent;
      auditTrail?.record({
        domain: event.source,
        event: "warning",
        detail: event.message,
        severity: "warn",
      });
    });

    // Subscribe to session reset
    sharedBus.on(BusChannel.SESSION_RESET, () => {
      auditTrail?.record({ domain: "session", event: "reset", detail: "Coordination state reset", severity: "info" });
    });

    // Subscribe to compaction
    sharedBus.on(BusChannel.COMPACTION_STARTED, () => {
      auditTrail?.record({
        domain: "session",
        event: "compaction",
        detail: "Context compaction triggered",
        severity: "info",
      });
    });

    sharedBus.on(BusChannel.BUDGET_UPDATED, (payload) => {
      const event = payload as BudgetUpdatedEvent;
      budgetSnapshot = {
        totalCost: event.totalCost,
        ceiling: event.ceiling,
      };
    });
  });

  pi.on(PiEvent.SESSION_SHUTDOWN, async () => {
    const sessionId = process.env.PANCODE_SESSION_ID ?? "unknown";
    metricsLedger?.addSessionMarker({ type: "session_end", timestamp: new Date().toISOString(), sessionId });
  });

  // === /metrics ===
  pi.registerCommand("metrics", {
    description: "Show PanCode dispatch metrics",
    async handler(args, _ctx) {
      if (!metricsLedger) {
        pi.sendMessage({
          customType: PanMessageType.PANEL,
          content: "Metrics ledger not initialized.",
          display: true,
          details: { title: "PanCode Metrics" },
        });
        return;
      }

      const summary = metricsLedger.getSummary();
      const recent = metricsLedger.getRecent(Number.parseInt(args.trim(), 10) || 10);

      const costDisplay = summary.totalCost != null ? `$${summary.totalCost.toFixed(4)}` : "\u2014";
      const inputDisplay = summary.totalInputTokens != null ? String(summary.totalInputTokens) : "\u2014";
      const outputDisplay = summary.totalOutputTokens != null ? String(summary.totalOutputTokens) : "\u2014";

      const lines: string[] = [
        `Total runs: ${summary.totalRuns}`,
        `Total cost: ${costDisplay}`,
        `Total input tokens: ${inputDisplay}`,
        `Total output tokens: ${outputDisplay}`,
        "",
      ];

      if (recent.length > 0) {
        lines.push("Recent:");
        for (const m of recent) {
          const costStr = m.cost != null ? ` $${m.cost.toFixed(4)}` : " \u2014";
          const durationStr = m.durationMs > 0 ? ` ${(m.durationMs / 1000).toFixed(1)}s` : "";
          lines.push(`  [${m.runId}] ${m.status} ${m.agent}${costStr}${durationStr}`);
        }
      } else {
        lines.push("No metrics recorded yet.");
      }

      pi.sendMessage({
        customType: PanMessageType.PANEL,
        content: lines.join("\n"),
        display: true,
        details: { title: "PanCode Metrics" },
      });
    },
  });

  // === /audit ===
  pi.registerCommand("audit", {
    description: "Show structured audit trail",
    async handler(args, _ctx) {
      if (!auditTrail) {
        pi.sendMessage({
          customType: PanMessageType.PANEL,
          content: "Audit trail not initialized.",
          display: true,
          details: { title: "PanCode Audit" },
        });
        return;
      }

      const filter = args.trim().toLowerCase();
      let entries = auditTrail.getRecent(50);

      // Filter by domain or severity
      if (filter === "error" || filter === "warn" || filter === "info") {
        entries = auditTrail.getBySeverity(filter).slice(-50);
      } else if (filter) {
        entries = auditTrail.getByDomain(filter).slice(-50);
      }

      if (entries.length === 0) {
        pi.sendMessage({
          customType: PanMessageType.PANEL,
          content: filter ? `No audit entries matching "${filter}".` : "No audit entries recorded.",
          display: true,
          details: { title: "PanCode Audit" },
        });
        return;
      }

      const lines: string[] = [
        `${entries.length} entries${filter ? ` (filter: ${filter})` : ""} of ${auditTrail.size()} total:`,
        "",
        `${"TIME".padEnd(12)} ${"SEV".padEnd(6)} ${"DOMAIN".padEnd(14)} ${"EVENT".padEnd(16)} DETAIL`,
      ];

      for (const entry of entries) {
        const time = entry.timestamp.slice(11, 19);
        const sev = entry.severity.toUpperCase().padEnd(6);
        const domain = entry.domain.padEnd(14);
        const event = entry.event.padEnd(16);
        const detail = entry.detail.length > 60 ? `${entry.detail.slice(0, 57)}...` : entry.detail;
        lines.push(`${time.padEnd(12)} ${sev} ${domain} ${event} ${detail}`);
      }

      lines.push("", "Filters: /audit <domain>, /audit error, /audit warn, /audit info");

      pi.sendMessage({
        customType: PanMessageType.PANEL,
        content: lines.join("\n"),
        display: true,
        details: { title: "PanCode Audit" },
      });
    },
  });

  // === /doctor ===
  pi.registerCommand("doctor", {
    description: "Run diagnostic health checks",
    async handler(_args, _ctx) {
      const packageRoot = process.env.PANCODE_PACKAGE_ROOT;
      const runtimeRoot = packageRoot ? `${packageRoot}/.pancode/runtime` : ".pancode/runtime";

      let activeWorkerCount = 0;
      let runs: Array<{ status: string; startedAt: string }> = [];
      const providerHealth: Array<{ status: string }> = [];
      const ledger = getRunLedger();
      if (ledger) {
        activeWorkerCount = ledger.getActive().length;
        runs = ledger.getAll().map((r) => ({ status: r.status, startedAt: r.startedAt }));
      }

      const report = await runHealthChecks({
        runtimeRoot,
        activeWorkerCount,
        runs,
        providerHealth,
        budgetSpent: budgetSnapshot.totalCost,
        budgetCeiling: budgetSnapshot.ceiling,
      });

      const statusIcon = (status: string) => {
        if (status === "pass") return "OK";
        if (status === "warn") return "!!";
        return "XX";
      };

      const lines: string[] = [
        `Health Report: ${report.passed} pass, ${report.warnings} warn, ${report.failures} fail`,
        "",
      ];

      for (const check of report.checks) {
        lines.push(`  [${statusIcon(check.status)}] ${check.name.padEnd(22)} ${check.message}`);
      }

      pi.sendMessage({
        customType: PanMessageType.PANEL,
        content: lines.join("\n"),
        display: true,
        details: { title: "PanCode Doctor" },
      });
    },
  });

  // === /receipt ===
  pi.registerCommand("receipt", {
    description: "List or verify reproducibility receipts",
    async handler(args, _ctx) {
      if (!receiptWriter) {
        pi.sendMessage({
          customType: PanMessageType.PANEL,
          content: "Receipt writer not initialized.",
          display: true,
          details: { title: "PanCode Receipts" },
        });
        return;
      }

      const receiptsDir = receiptWriter.getReceiptsDir();
      const parts = args.trim().split(/\s+/);
      const subcommand = parts[0]?.toLowerCase() ?? "";
      const receiptId = parts[1] ?? "";

      if (subcommand === "verify" && receiptId) {
        const result = verifyReceipt(receiptsDir, receiptId);
        const statusLabel =
          result.status === "PASS" ? "PASS" : result.status === "TAMPERED" ? "TAMPERED" : result.status;
        const lines: string[] = [`Verification: ${statusLabel}`, "", result.message];

        if (result.receipt && result.status === "PASS") {
          const r = result.receipt;
          lines.push(
            "",
            `  Run:      ${r.runId}`,
            `  Agent:    ${r.agent}`,
            `  Model:    ${r.model ?? "unknown"}`,
            `  Runtime:  ${r.runtime}`,
            `  Status:   ${r.status}`,
            `  Wall:     ${(r.wallMs / 1000).toFixed(1)}s`,
            `  Cost:     ${r.cost != null ? `$${r.cost.toFixed(4)}` : "n/a"}`,
          );
        }

        pi.sendMessage({
          customType: PanMessageType.PANEL,
          content: lines.join("\n"),
          display: true,
          details: { title: "PanCode Receipt Verify" },
        });
        return;
      }

      // Default: list recent receipts
      const ids = listReceipts(receiptsDir);
      if (ids.length === 0) {
        pi.sendMessage({
          customType: PanMessageType.PANEL,
          content: "No receipts found. Receipts are generated after each dispatch completes.",
          display: true,
          details: { title: "PanCode Receipts" },
        });
        return;
      }

      const maxShow = 20;
      const shown = ids.slice(-maxShow);
      const lines: string[] = [`${ids.length} receipt(s) in ${receiptsDir}:`, ""];
      for (const id of shown) {
        lines.push(`  ${id}`);
      }
      if (ids.length > maxShow) {
        lines.push(`  ... and ${ids.length - maxShow} more`);
      }
      lines.push("", "Usage: /receipt verify <receipt-id>");

      pi.sendMessage({
        customType: PanMessageType.PANEL,
        content: lines.join("\n"),
        display: true,
        details: { title: "PanCode Receipts" },
      });
    },
  });
});
