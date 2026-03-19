import type { RunEnvelope } from "../dispatch";

export interface TaskWidget {
  activeRuns: RunEnvelope[];
  completedRuns: number;
  failedRuns: number;
}

export function buildTaskWidget(runs: RunEnvelope[]): TaskWidget {
  const activeRuns = runs.filter((r) => r.status === "running" || r.status === "pending");
  const completedRuns = runs.filter((r) => r.status === "done").length;
  const failedRuns = runs.filter((r) => r.status === "error").length;

  return { activeRuns, completedRuns, failedRuns };
}

export function renderTaskWidget(widget: TaskWidget): string[] {
  const lines: string[] = [];

  if (widget.activeRuns.length > 0) {
    lines.push(`Active: ${widget.activeRuns.length}`);
    for (const run of widget.activeRuns) {
      const task = run.task.length > 40 ? `${run.task.slice(0, 37)}...` : run.task;
      lines.push(`  [${run.id}] ${run.agent} ${task}`);
    }
  }

  if (widget.completedRuns > 0 || widget.failedRuns > 0) {
    lines.push(`Completed: ${widget.completedRuns} | Failed: ${widget.failedRuns}`);
  }

  return lines.length > 0 ? lines : ["No dispatched tasks."];
}
