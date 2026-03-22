import { BusChannel, type RunFinishedEvent } from "../../core/bus-events";
import { PanMessageType } from "../../core/message-types";
import { sharedBus } from "../../core/shared-bus";
import { PiEvent } from "../../engine/events";
import { defineExtension } from "../../engine/extensions";
import { registerPreFlightCheck } from "../dispatch";
import { getModelProfileCache } from "../providers";
import { BudgetTracker } from "./budget";
import { buildClusterView } from "./cluster-transport";

let budgetTracker: BudgetTracker | null = null;

export function getBudgetTracker(): BudgetTracker | null {
  return budgetTracker;
}

function publishBudgetState(): void {
  if (!budgetTracker) return;
  const state = budgetTracker.getState();
  process.env.PANCODE_BUDGET_SPENT = state.totalCost.toFixed(4);
  sharedBus.emit(BusChannel.BUDGET_UPDATED, {
    totalCost: state.totalCost,
    ceiling: state.ceiling,
    runsCount: state.runsCount,
    totalInputTokens: state.totalInputTokens,
    totalOutputTokens: state.totalOutputTokens,
  });
}

export const extension = defineExtension((pi) => {
  pi.on(PiEvent.SESSION_START, (_event, _ctx) => {
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
    sharedBus.on(BusChannel.RUN_FINISHED, (payload) => {
      if (!budgetTracker) return;
      const event = payload as RunFinishedEvent;
      if (event.status === "done") {
        // Skip budget recording when usage fields are null (runtime did not report).
        budgetTracker.recordCost(event.usage.cost ?? 0, event.usage.inputTokens ?? 0, event.usage.outputTokens ?? 0);
        publishBudgetState();
      }
    });
  });

  pi.registerCommand("budget", {
    description: "Show PanCode dispatch budget status",
    async handler(args, _ctx) {
      if (!budgetTracker) {
        pi.sendMessage({
          customType: PanMessageType.PANEL,
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
            customType: PanMessageType.PANEL,
            content: "Invalid ceiling value. Use: /budget set <amount>",
            display: true,
            details: { title: "PanCode Budget" },
          });
          return;
        }
        budgetTracker.setCeiling(newCeiling);
        publishBudgetState();
        pi.sendMessage({
          customType: PanMessageType.PANEL,
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
        customType: PanMessageType.PANEL,
        content: lines.join("\n"),
        display: true,
        details: { title: "PanCode Budget" },
      });
    },
  });
});
