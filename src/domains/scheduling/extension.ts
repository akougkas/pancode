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
    const runtimeRoot = packageRoot ? `${packageRoot}/.pancode/state` : ".pancode/state";
    const ceiling = Number.parseFloat(process.env.PANCODE_BUDGET_CEILING ?? "10.0") || 10.0;
    budgetTracker = new BudgetTracker(runtimeRoot, ceiling);
    budgetTracker.resetSession();
    publishBudgetState();

    // Register budget admission gate with the dispatch pre-flight pipeline.
    // Scheduling depends on dispatch, so this import direction is legal.
    // Uses estimated cost (average of past runs) for pre-estimation (test 14b).
    registerPreFlightCheck("budget", () => {
      if (!budgetTracker) return { admit: true };
      const state = budgetTracker.getState();
      const estimatedCost = state.runsCount > 0 ? state.totalCost / state.runsCount : 0;
      if (!budgetTracker.canAdmit(estimatedCost)) {
        return {
          admit: false,
          reason: `Budget ceiling would be exceeded (spent: $${state.totalCost.toFixed(2)}, estimated next: $${estimatedCost.toFixed(4)}, ceiling: $${state.ceiling.toFixed(2)})`,
        };
      }
      return { admit: true };
    });

    // Subscribe to structured run-finished events from dispatch.
    // This replaces the previous approach of regex-scraping tool result text.
    // Only completed runs (status "done") count against the budget because
    // failed runs reflect an incomplete task, maintaining backward-compatible behavior.
    sharedBus.on(BusChannel.RUN_FINISHED, (payload) => {
      if (!budgetTracker) return;
      const event = payload as RunFinishedEvent;
      if (event.status === "done") {
        // Pass nullable values directly; BudgetTracker skips null fields.
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
          customType: PanMessageType.PANEL,
          content: "Budget tracker not initialized.",
          display: true,
          details: { title: "PanCode Budget" },
        });
        return;
      }

      const state = budgetTracker.getState();
      // Estimate cost of the next dispatch based on average cost per run.
      const estimatedNext = state.runsCount > 0 ? state.totalCost / state.runsCount : 0;
      const remaining = budgetTracker.remaining();
      const perRunCap = process.env.PANCODE_PER_RUN_BUDGET;

      const lines = [
        "\u2139 Read-only view. Ask Panos to change any setting, or use keyboard shortcuts.",
        "",
        `Ceiling:        $${state.ceiling.toFixed(2)}  (say "set budget to $20")`,
        `Spent:          $${state.totalCost.toFixed(4)}`,
        `Remaining:      $${remaining.toFixed(4)}`,
        `Estimated next: $${estimatedNext.toFixed(4)}${estimatedNext > remaining ? " (would exceed remaining)" : ""}`,
        `Runs:           ${state.runsCount}`,
        `Input tokens:   ${state.totalInputTokens}`,
        `Output tokens:  ${state.totalOutputTokens}`,
      ];

      if (perRunCap) {
        lines.push(`Per-run cap:    $${perRunCap}`);
      }

      const request = args.trim();
      if (request) {
        const amount = request.replace(/^set\s+/, "").trim();
        const numericAmount = Number.parseFloat(amount.replace(/^\$/, ""));
        if (Number.isFinite(numericAmount) && numericAmount > 0) {
          lines.push("", `To apply "$${amount}", ask Panos: "set budget to $${amount}"`);
        } else {
          lines.push("", `Invalid budget value "${amount}". Budget must be a positive number.`);
        }
      }

      lines.push("", `Tip: "set budget to $20"  "increase budget to $50" | alt+a:admin`);

      pi.sendMessage({
        customType: PanMessageType.PANEL,
        content: lines.join("\n"),
        display: true,
        details: { title: "PanCode Budget" },
      });
    },
  });
});
