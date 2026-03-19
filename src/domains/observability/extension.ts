import { defineExtension } from "../../engine/extensions";
import { sharedBus } from "../../core/shared-bus";
import { MetricsLedger, type RunMetric } from "./metrics";
import { createAuditTrail, type AuditTrail } from "./telemetry";
import { runHealthChecks } from "./health";

interface RunFinishedEvent {
  runId: string;
  agent: string;
  status: "done" | "error";
  usage: {
    cost: number;
    turns: number;
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
    cacheWriteTokens: number;
  };
  startedAt: string;
  completedAt: string;
}

let metricsLedger: MetricsLedger | null = null;
let auditTrail: AuditTrail | null = null;

export function getMetricsLedger(): MetricsLedger | null {
  return metricsLedger;
}

export function getAuditTrail(): AuditTrail | null {
  return auditTrail;
}

export const extension = defineExtension((pi) => {
  pi.on("session_start", (_event, _ctx) => {
    const packageRoot = process.env.PANCODE_PACKAGE_ROOT;
    if (!packageRoot) {
      console.error("[pancode:observability] PANCODE_PACKAGE_ROOT is not set. Domain state will not persist.");
    }
    const runtimeRoot = packageRoot ? `${packageRoot}/.pancode` : ".pancode";
    metricsLedger = new MetricsLedger(runtimeRoot);
    auditTrail = createAuditTrail(1000);

    // Record session start
    auditTrail.record({ domain: "session", event: "session_start", detail: "PanCode session started", severity: "info" });

    // Subscribe to dispatch events for both metrics and audit
    sharedBus.on("pancode:run-finished", (payload) => {
      const event = payload as RunFinishedEvent;
      const durationMs = new Date(event.completedAt).getTime() - new Date(event.startedAt).getTime();

      const metric: RunMetric = {
        runId: event.runId,
        agent: event.agent,
        status: event.status,
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

      // Audit trail entry
      const severity = event.status === "error" ? "warn" : "info";
      auditTrail?.record({
        domain: "dispatch",
        event: `run-${event.status}`,
        agent: event.agent,
        detail: `Run ${event.runId}: ${event.status} (${(durationMs / 1000).toFixed(1)}s, $${event.usage.cost.toFixed(4)})`,
        severity,
      });
    });

    // Subscribe to warnings
    sharedBus.on("pancode:warning", (payload) => {
      const event = payload as { source: string; message: string };
      auditTrail?.record({
        domain: event.source,
        event: "warning",
        detail: event.message,
        severity: "warn",
      });
    });

    // Subscribe to session reset
    sharedBus.on("pancode:session-reset", () => {
      auditTrail?.record({ domain: "session", event: "reset", detail: "Coordination state reset", severity: "info" });
    });

    // Subscribe to compaction
    sharedBus.on("pancode:compaction-started", () => {
      auditTrail?.record({ domain: "session", event: "compaction", detail: "Context compaction triggered", severity: "info" });
    });
  });

  // === /metrics ===
  pi.registerCommand("metrics", {
    description: "Show PanCode dispatch metrics",
    async handler(args, _ctx) {
      if (!metricsLedger) {
        pi.sendMessage({
          customType: "pancode-panel",
          content: "Metrics ledger not initialized.",
          display: true,
          details: { title: "PanCode Metrics" },
        });
        return;
      }

      const summary = metricsLedger.getSummary();
      const recent = metricsLedger.getRecent(parseInt(args.trim(), 10) || 10);

      const lines: string[] = [
        `Total runs: ${summary.totalRuns}`,
        `Total cost: $${summary.totalCost.toFixed(4)}`,
        `Total input tokens: ${summary.totalInputTokens}`,
        `Total output tokens: ${summary.totalOutputTokens}`,
        "",
      ];

      if (recent.length > 0) {
        lines.push("Recent:");
        for (const m of recent) {
          const costStr = m.cost > 0 ? ` $${m.cost.toFixed(4)}` : "";
          const durationStr = m.durationMs > 0 ? ` ${(m.durationMs / 1000).toFixed(1)}s` : "";
          lines.push(`  [${m.runId}] ${m.status} ${m.agent}${costStr}${durationStr}`);
        }
      } else {
        lines.push("No metrics recorded yet.");
      }

      pi.sendMessage({
        customType: "pancode-panel",
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
          customType: "pancode-panel",
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
          customType: "pancode-panel",
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
        customType: "pancode-panel",
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
      const runtimeRoot = packageRoot
        ? `${packageRoot}/.pancode/runtime`
        : ".pancode/runtime";

      // Gather inputs from other domains via lazy imports to avoid hard dependencies.
      let activeWorkerCount = 0;
      let runs: Array<{ status: string; startedAt: string }> = [];
      let providerHealth: Array<{ status: string }> = [];
      let budgetSpent = 0;
      let budgetCeiling = 10;

      try {
        const { getRunLedger } = await import("../dispatch");
        const ledger = getRunLedger();
        if (ledger) {
          activeWorkerCount = ledger.getActive().length;
          runs = ledger.getAll().map((r) => ({ status: r.status, startedAt: r.startedAt }));
        }
      } catch {
        // dispatch domain not loaded
      }

      try {
        const { getBudgetTracker } = await import("../scheduling");
        const tracker = getBudgetTracker();
        if (tracker) {
          const state = tracker.getState();
          budgetSpent = state.totalCost;
          budgetCeiling = state.ceiling;
        }
      } catch {
        // scheduling domain not loaded
      }

      const report = await runHealthChecks({
        runtimeRoot,
        activeWorkerCount,
        runs,
        providerHealth,
        budgetSpent,
        budgetCeiling,
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
        customType: "pancode-panel",
        content: lines.join("\n"),
        display: true,
        details: { title: "PanCode Doctor" },
      });
    },
  });
});
