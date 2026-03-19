import { defineExtension } from "../../engine/extensions";
import { sharedBus } from "../../core/shared-bus";
import { MetricsLedger, type RunMetric } from "./metrics";

// Local shape for the cross-domain pancode:run-finished event payload.
// Matches what dispatch/extension.ts emits on sharedBus.
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

export function getMetricsLedger(): MetricsLedger | null {
  return metricsLedger;
}

export const extension = defineExtension((pi) => {
  pi.on("session_start", (_event, _ctx) => {
    const packageRoot = process.env.PANCODE_PACKAGE_ROOT;
    if (!packageRoot) {
      console.error("[pancode:observability] PANCODE_PACKAGE_ROOT is not set. Domain state will not persist.");
    }
    const runtimeRoot = packageRoot ? `${packageRoot}/.pancode` : ".pancode";
    metricsLedger = new MetricsLedger(runtimeRoot);

    // Subscribe to structured run-finished events from dispatch.
    // This replaces the previous approach of regex-scraping tool result text.
    sharedBus.on("pancode:run-finished", (payload) => {
      const event = payload as RunFinishedEvent;
      const durationMs =
        new Date(event.completedAt).getTime() - new Date(event.startedAt).getTime();

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
    });
  });

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
});
