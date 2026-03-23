import type { AgentSpec } from "../agents";
import type { RunEnvelope } from "../dispatch";
import type { SessionMetrics } from "../observability";

export {
  renderDispatchBoard,
  renderDispatchCard,
  renderDispatchFooter,
  renderDispatchFooterLine,
} from "./dispatch-board";
export type { BoardColorizer, DispatchCardData, DispatchBoardState } from "./dispatch-board";

export function renderRunBoard(runs: RunEnvelope[]): string[] {
  if (runs.length === 0) return ["No runs recorded."];

  const lines: string[] = [];
  for (const run of runs) {
    const status = run.status.padEnd(9);
    const agent = run.agent.padEnd(10);
    const renderCostVal = run.usage.cost;
    const costStr = renderCostVal != null && renderCostVal > 0 ? ` $${renderCostVal.toFixed(4)}` : "";
    const task = run.task.length > 50 ? `${run.task.slice(0, 47)}...` : run.task;
    // For failed runs, append the error reason (truncated) so /runs shows why it failed.
    let errorSuffix = "";
    if (run.status === "error" && run.error) {
      const truncated = run.error.length > 60 ? `${run.error.slice(0, 57)}...` : run.error;
      errorSuffix = `  ${truncated}`;
    }
    lines.push(`[${run.id}] ${status} ${agent} ${task}${costStr}${errorSuffix}`);
  }
  return lines;
}

export function renderAgentList(agents: AgentSpec[]): string[] {
  if (agents.length === 0) return ["No agents registered."];

  return agents.map((spec) => {
    const readonlyTag = spec.readonly ? " [readonly]" : "";
    return `- ${spec.name}: ${spec.description}${readonlyTag}`;
  });
}

export function renderMetricsSummary(metrics: SessionMetrics): string[] {
  const costStr = metrics.totalCost != null ? `$${metrics.totalCost.toFixed(4)}` : "\u2014";
  const inputStr = metrics.totalInputTokens != null ? `${metrics.totalInputTokens} tokens` : "\u2014";
  const outputStr = metrics.totalOutputTokens != null ? `${metrics.totalOutputTokens} tokens` : "\u2014";
  return [`Runs: ${metrics.totalRuns}`, `Cost: ${costStr}`, `Input: ${inputStr}`, `Output: ${outputStr}`];
}
