import { sharedBus } from "../../core/shared-bus";
import { defineExtension } from "../../engine/extensions";
import { registerPreFlightCheck } from "../dispatch";
import { getModelProfileCache } from "../providers";
import { BudgetTracker } from "./budget";
import { buildClusterView } from "./cluster-transport";

// Local shape for the cross-domain pancode:run-finished event payload.
// Matches what dispatch/extension.ts emits on sharedBus.
interface RunFinishedEvent {
  status: string;
  usage: {
    cost: number;
    inputTokens: number;
    outputTokens: number;
  };
  runtime: string;
}

let budgetTracker: BudgetTracker | null = null;

export function getBudgetTracker(): BudgetTracker | null {
  return budgetTracker;
}

function publishBudgetState(): void {
  if (!budgetTracker) return;
  const state = budgetTracker.getState();
  process.env.PANCODE_BUDGET_SPENT = state.totalCost.toFixed(4);
  sharedBus.emit("pancode:budget-updated", {
    totalCost: state.totalCost,
    ceiling: state.ceiling,
    runsCount: state.runsCount,
    totalInputTokens: state.totalInputTokens,
    totalOutputTokens: state.totalOutputTokens,
  });
}

export const extension = defineExtension((pi) => {
  pi.on("session_start", (_event, _ctx) => {
    const packageRoot = process.env.PANCODE_PACKAGE_ROOT;
    if (!packageRoot) {
      console.error("[pancode:scheduling] PANCODE_PACKAGE_ROOT is not set. Domain state will not persist.");
    }
    const runtimeRoot = packageRoot ? `${packageRoot}/.pancode` : ".pancode";
    const ceiling = Number.parseFloat(process.env.PANCODE_BUDGET_CEILING ?? "10.0") || 10.0;
    budgetTracker = new BudgetTracker(runtimeRoot, ceiling);
    budgetTracker.resetSession();
    publishBudgetState();

    // Register budget admission gate with the dispatch pre-flight pipeline.
    // Scheduling depends on dispatch, so this import direction is legal.
    registerPreFlightCheck("budget", () => {
      if (!budgetTracker) return { admit: true };
      if (budgetTracker.canAdmit()) return { admit: true };
      const state = budgetTracker.getState();
      return {
        admit: false,
        reason: `Budget ceiling reached ($${state.totalCost.toFixed(2)} / $${state.ceiling.toFixed(2)})`,
      };
    });

    // Subscribe to structured run-finished events from dispatch.
    // This replaces the previous approach of regex-scraping tool result text.
    // Only completed runs (status "done") count against the budget because
    // failed runs reflect an incomplete task, maintaining backward-compatible behavior.
    sharedBus.on("pancode:run-finished", (payload) => {
      if (!budgetTracker) return;
      const event = payload as RunFinishedEvent;
      if (event.status === "done") {
        budgetTracker.recordCost(event.usage.cost, event.usage.inputTokens, event.usage.outputTokens);
        publishBudgetState();
      }
    });
  });

  pi.registerCommand("budget", {
    description: "Show PanCode dispatch budget status",
    async handler(args, _ctx) {
      if (!budgetTracker) {
        pi.sendMessage({
          customType: "pancode-panel",
          content: "Budget tracker not initialized.",
          display: true,
          details: { title: "PanCode Budget" },
        });
        return;
      }

      const subcommand = args.trim().split(/\s+/);

      if (subcommand[0] === "set" && subcommand[1]) {
        const newCeiling = Number.parseFloat(subcommand[1]);
        if (!Number.isFinite(newCeiling) || newCeiling <= 0) {
          pi.sendMessage({
            customType: "pancode-panel",
            content: "Invalid ceiling value. Use: /budget set <amount>",
            display: true,
            details: { title: "PanCode Budget" },
          });
          return;
        }
        budgetTracker.setCeiling(newCeiling);
        publishBudgetState();
        pi.sendMessage({
          customType: "pancode-panel",
          content: `Budget ceiling set to $${newCeiling.toFixed(2)}`,
          display: true,
          details: { title: "PanCode Budget" },
        });
        return;
      }

      const state = budgetTracker.getState();
      const lines = [
        `Spent: $${state.totalCost.toFixed(4)} / $${state.ceiling.toFixed(2)}`,
        `Remaining: $${budgetTracker.remaining().toFixed(4)}`,
        `Runs: ${state.runsCount}`,
        `Input tokens: ${state.totalInputTokens}`,
        `Output tokens: ${state.totalOutputTokens}`,
        "",
        "Use /budget set <amount> to adjust ceiling.",
      ];

      pi.sendMessage({
        customType: "pancode-panel",
        content: lines.join("\n"),
        display: true,
        details: { title: "PanCode Budget" },
      });
    },
  });

  pi.registerCommand("cluster", {
    description: "Show cluster node visibility",
    async handler(_args, _ctx) {
      const profiles = getModelProfileCache();

      // Build provider inputs from model profiles
      const providerMap = new Map<string, { type: string; host: string; port: number; modelCount: number }>();
      for (const profile of profiles) {
        if (!providerMap.has(profile.providerId)) {
          // Derive host/port from provider naming convention
          const parts = profile.providerId.split("-");
          const type = parts.pop() ?? "unknown";
          const host = parts.join("-") || "localhost";
          providerMap.set(profile.providerId, { type, host, modelCount: 0, port: 0 });
        }
        const entry = providerMap.get(profile.providerId);
        if (!entry) continue;
        entry.modelCount++;
      }

      const providerInputs = [...providerMap.entries()].map(([id, p]) => ({
        id,
        type: p.type,
        host: p.host,
        port: p.port,
        healthy: true,
        modelCount: p.modelCount,
      }));

      const nodes = buildClusterView(providerInputs);

      if (nodes.length === 0) {
        pi.sendMessage({
          customType: "pancode-panel",
          content:
            "No cluster nodes discovered. Connect local engines (LM Studio, Ollama, llama.cpp) to enable cluster view.",
          display: true,
          details: { title: "PanCode Cluster" },
        });
        return;
      }

      const lines: string[] = [`${nodes.length} nodes:`, ""];
      for (const node of nodes) {
        const engineStrs = node.engines.map((e) => {
          const healthStr = e.healthy ? "ok" : "down";
          return `${e.type}:${e.port || "auto"} [${healthStr}] (${e.modelCount} models)`;
        });
        lines.push(`${node.name} (${node.host}) [${node.status}]`);
        for (const es of engineStrs) {
          lines.push(`  ${es}`);
        }
      }

      pi.sendMessage({
        customType: "pancode-panel",
        content: lines.join("\n"),
        display: true,
        details: { title: "PanCode Cluster" },
      });
    },
  });
});
