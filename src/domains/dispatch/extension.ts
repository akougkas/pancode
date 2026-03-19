import { Type } from "@sinclair/typebox";
import { defineExtension } from "../../engine/extensions";
import { sharedBus } from "../../core/shared-bus";
import type { AgentToolResult } from "../../engine/types";
import { agentRegistry } from "../agents";
import { RunLedger, createRunEnvelope } from "./state";
import { evaluateRules, DEFAULT_DISPATCH_RULES, type DispatchRule } from "./rules";
import { resolveWorkerRouting } from "./routing";
import { stopAllWorkers, spawnWorker } from "./worker-spawn";
import { runParallel } from "./primitives";
import { batchTracker } from "./batch-tracker";
import { createWorktreeIsolation, mergeDeltaPatches, cleanupAllWorktrees } from "./isolation";
import { shutdownCoordinator } from "../../core/termination";
import { runPreFlightChecks } from "./admission";

function textResult(text: string): AgentToolResult<unknown> {
  return { content: [{ type: "text", text }], details: undefined };
}

let ledger: RunLedger | null = null;
let dispatchRules: DispatchRule[] = [...DEFAULT_DISPATCH_RULES];
let draining = false;

export function getRunLedger(): RunLedger | null {
  return ledger;
}

export const extension = defineExtension((pi) => {
  pi.on("session_start", (_event, ctx) => {
    const packageRoot = process.env.PANCODE_PACKAGE_ROOT;
    if (!packageRoot) {
      console.error("[pancode:dispatch] PANCODE_PACKAGE_ROOT is not set. Domain state will not persist.");
    }
    const runtimeRoot = packageRoot ? `${packageRoot}/.pancode` : ".pancode";
    ledger = new RunLedger(runtimeRoot);
    draining = false;

    // Register drain handler with shutdown coordinator
    shutdownCoordinator.onDrain(() => {
      draining = true;
      sharedBus.emit("pancode:shutdown-draining", {});
    });
  });

  pi.on("session_shutdown", async () => {
    await stopAllWorkers();
    await cleanupAllWorktrees();
    if (ledger) {
      ledger.markInterrupted();
    }
  });

  pi.registerTool({
    name: "dispatch_agent",
    label: "Dispatch Agent",
    description:
      "Delegate a task to a specialized PanCode worker agent. The worker runs as a separate subprocess with its own context window. Use this to parallelize work or delegate to specialized agents (dev, reviewer, scout).",
    parameters: Type.Object({
      task: Type.String({ description: "The task description to send to the worker agent" }),
      agent: Type.Optional(Type.String({ description: "Agent spec name (default: dev)", default: "dev" })),
      isolate: Type.Optional(Type.Boolean({ description: "Run in a git worktree for filesystem isolation", default: false })),
    }),
    async execute(_toolCallId, params, signal, onUpdate, ctx) {
      const defaultAgent = process.env.PANCODE_DEFAULT_AGENT ?? "dev";
      const agentName = params.agent || defaultAgent;
      const task = params.task;
      const isolate = params.isolate ?? false;

      if (draining) {
        return textResult("Dispatch blocked: system is shutting down.");
      }

      if (!task?.trim()) {
        return textResult("Error: empty task");
      }

      // Pre-flight admission checks (budget, safety, etc. registered by other domains)
      const preflight = runPreFlightChecks({ task, agent: agentName, model: resolveWorkerRouting(agentName).model });
      if (!preflight.admit) {
        return textResult(`Dispatch blocked: ${preflight.reason}`);
      }

      if (!agentRegistry.has(agentName)) {
        const available = agentRegistry.names().join(", ");
        return textResult(`Unknown agent "${agentName}". Available: ${available}`);
      }

      const dispatchAction = evaluateRules(dispatchRules, { task, agent: agentName, cwd: ctx.cwd });

      if (dispatchAction.action === "stop") {
        return textResult(`Dispatch blocked: ${dispatchAction.reason}`);
      }

      if (dispatchAction.action === "skip") {
        return textResult(`Task skipped by dispatch rules: ${dispatchAction.reason ?? "no reason provided"}`);
      }

      const routing = resolveWorkerRouting(dispatchAction.agent);
      const run = createRunEnvelope(task, dispatchAction.agent, ctx.cwd);
      run.model = routing.model;
      run.status = "running";
      ledger?.add(run);

      sharedBus.emit("pancode:run-started", { runId: run.id, task, agent: dispatchAction.agent, model: routing.model });

      const isolateLabel = isolate ? " (isolated)" : "";
      if (onUpdate) {
        onUpdate(textResult(`Dispatching to ${dispatchAction.agent} worker${isolateLabel}...`));
      }

      let workerCwd = ctx.cwd;
      let isolation: Awaited<ReturnType<typeof createWorktreeIsolation>> | null = null;

      if (isolate) {
        try {
          isolation = await createWorktreeIsolation(ctx.cwd, run.id);
          workerCwd = isolation.workDir;
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          run.status = "error";
          run.error = `Worktree creation failed: ${msg}`;
          run.completedAt = new Date().toISOString();
          ledger?.update(run.id, run);
          return textResult(`Isolation failed: ${msg}`);
        }
      }

      const workerResult = await spawnWorker({
        task: dispatchAction.task,
        tools: routing.tools,
        model: routing.model,
        systemPrompt: routing.systemPrompt,
        cwd: workerCwd,
        sampling: routing.sampling,
        signal: signal ?? undefined,
        runId: run.id,
      });

      // Merge worktree delta back to parent
      if (isolation) {
        try {
          const patches = await isolation.captureDelta();
          if (patches.length > 0) {
            const mergeResult = await mergeDeltaPatches(ctx.cwd, patches);
            if (!mergeResult.success) {
              workerResult.error = (workerResult.error ? workerResult.error + "; " : "") +
                `Delta merge failed: ${mergeResult.error}`;
            }
          }
        } catch (err) {
          workerResult.error = (workerResult.error ? workerResult.error + "; " : "") +
            `Delta capture failed: ${err instanceof Error ? err.message : String(err)}`;
        } finally {
          await isolation.cleanup();
        }
      }

      run.status = workerResult.exitCode === 0 && !workerResult.error ? "done" : "error";
      run.result = workerResult.result;
      run.error = workerResult.error;
      run.usage = workerResult.usage;
      run.model = workerResult.model ?? run.model;
      run.completedAt = new Date().toISOString();
      ledger?.update(run.id, run);

      // Spec originally defined separate run-completed and run-failed events.
      // Unified to run-finished with status field for simpler subscriber logic.
      sharedBus.emit("pancode:run-finished", {
        runId: run.id,
        agent: run.agent,
        status: run.status,
        usage: run.usage,
        startedAt: run.startedAt,
        completedAt: run.completedAt ?? new Date().toISOString(),
      });

      const usageStr = workerResult.usage.cost > 0
        ? ` | cost: $${workerResult.usage.cost.toFixed(4)} | turns: ${workerResult.usage.turns}`
        : ` | turns: ${workerResult.usage.turns}`;

      const statusEmoji = run.status === "done" ? "completed" : "failed";
      const summary = `Worker ${statusEmoji} (${run.id})${usageStr}\n\nAgent: ${run.agent}${run.model ? ` | Model: ${run.model}` : ""}`;

      if (run.status === "error") {
        return textResult(`${summary}\n\nError: ${run.error}`);
      }

      return textResult(`${summary}\n\nResult:\n${run.result}`);
    },
  });

  pi.registerTool({
    name: "batch_dispatch",
    label: "Batch Dispatch",
    description:
      "Dispatch multiple tasks in parallel to worker agents. Each task runs as a separate subprocess. Up to 4 workers run concurrently by default.",
    parameters: Type.Object({
      tasks: Type.Array(Type.String({ description: "Task descriptions" }), { description: "Array of task descriptions", minItems: 1, maxItems: 8 }),
      agent: Type.Optional(Type.String({ description: "Agent spec name for all tasks (default: dev)", default: "dev" })),
      concurrency: Type.Optional(Type.Number({ description: "Max parallel workers (default: 4)", default: 4, minimum: 1, maximum: 8 })),
    }),
    async execute(_toolCallId, params, signal, onUpdate, ctx) {
      const agentName = params.agent || "dev";
      const concurrency = params.concurrency || 4;
      const tasks = params.tasks;

      if (draining) {
        return textResult("Batch dispatch blocked: system is shutting down.");
      }

      // Pre-flight admission checks for batch dispatch
      const batchPreflight = runPreFlightChecks({ task: tasks[0], agent: agentName, model: resolveWorkerRouting(agentName).model });
      if (!batchPreflight.admit) {
        return textResult(`Batch dispatch blocked: ${batchPreflight.reason}`);
      }

      if (!agentRegistry.has(agentName)) {
        const available = agentRegistry.names().join(", ");
        return textResult(`Unknown agent "${agentName}". Available: ${available}`);
      }

      const routing = resolveWorkerRouting(agentName);
      const batch = batchTracker.create(tasks.length);
      const runs = tasks.map((task) => {
        const run = createRunEnvelope(task, agentName, ctx.cwd, batch.id);
        run.model = routing.model;
        run.status = "running";
        ledger?.add(run);
        batchTracker.addRun(batch.id, run.id);
        sharedBus.emit("pancode:run-started", { runId: run.id, task, agent: agentName, model: routing.model });
        return run;
      });

      if (onUpdate) {
        onUpdate(textResult(`Dispatching batch of ${tasks.length} tasks to ${agentName} workers (concurrency: ${concurrency})...`));
      }

      const parallelTasks = tasks.map((task, i) => ({
        task,
        tools: routing.tools,
        model: routing.model,
        systemPrompt: routing.systemPrompt,
        cwd: ctx.cwd,
        sampling: routing.sampling,
        runId: runs[i].id,
      }));

      const results = await runParallel(parallelTasks, concurrency, signal ?? undefined);

      const summaryLines: string[] = [`Batch ${batch.id}: ${tasks.length} tasks`, ""];
      let totalCost = 0;

      for (let i = 0; i < results.length; i++) {
        const { result: workerResult } = results[i];
        const run = runs[i];

        run.status = workerResult.exitCode === 0 && !workerResult.error ? "done" : "error";
        run.result = workerResult.result;
        run.error = workerResult.error;
        run.usage = workerResult.usage;
        run.model = workerResult.model ?? run.model;
        run.completedAt = new Date().toISOString();
        ledger?.update(run.id, run);
        batchTracker.markCompleted(batch.id, run.status === "done");
        totalCost += workerResult.usage.cost;

        sharedBus.emit("pancode:run-finished", {
          runId: run.id,
          agent: run.agent,
          status: run.status,
          usage: run.usage,
          startedAt: run.startedAt,
          completedAt: run.completedAt,
        });

        const statusStr = run.status === "done" ? "OK" : "FAIL";
        const costStr = workerResult.usage.cost > 0 ? ` $${workerResult.usage.cost.toFixed(4)}` : "";
        const truncatedTask = run.task.length > 50 ? `${run.task.slice(0, 47)}...` : run.task;
        summaryLines.push(`  [${run.id}] ${statusStr} ${run.agent} ${truncatedTask}${costStr}`);

        if (run.status === "error" && run.error) {
          const errorText = run.error.length > 500 ? `${run.error.slice(0, 500)}...` : run.error;
          summaryLines.push(`    Error: ${errorText}`);
        } else if (run.result) {
          const resultText = run.result.length > 500 ? `${run.result.slice(0, 500)}...` : run.result;
          summaryLines.push(`    Result: ${resultText}`);
        }
      }

      const batchState = batchTracker.get(batch.id);
      summaryLines.push("");
      summaryLines.push(`Completed: ${batchState?.completedCount ?? 0}/${tasks.length} | Failed: ${batchState?.failedCount ?? 0} | Cost: $${totalCost.toFixed(4)}`);

      return textResult(summaryLines.join("\n"));
    },
  });

  pi.registerCommand("runs", {
    description: "Show dispatch run history",
    async handler(args, _ctx) {
      if (!ledger) {
        pi.sendMessage({
          customType: "pancode-panel",
          content: "Dispatch ledger not initialized.",
          display: true,
          details: { title: "PanCode Runs" },
        });
        return;
      }

      const count = parseInt(args.trim(), 10) || 10;
      const runs = ledger.getRecent(count);
      const active = ledger.getActive();

      const lines: string[] = [];
      if (active.length > 0) {
        lines.push(`Active: ${active.length}`);
        lines.push("");
      }

      if (runs.length === 0) {
        lines.push("No runs recorded.");
      } else {
        for (const run of runs) {
          const costStr = run.usage.cost > 0 ? ` $${run.usage.cost.toFixed(4)}` : "";
          const truncatedTask = run.task.length > 60 ? `${run.task.slice(0, 57)}...` : run.task;
          lines.push(`[${run.id}] ${run.status.padEnd(9)} ${run.agent.padEnd(10)} ${truncatedTask}${costStr}`);
        }
      }

      pi.sendMessage({
        customType: "pancode-panel",
        content: lines.join("\n"),
        display: true,
        details: { title: `PanCode Runs (last ${count})` },
      });
    },
  });

  pi.registerCommand("batches", {
    description: "Show batch dispatch history",
    async handler(_args, _ctx) {
      const batches = batchTracker.getRecent(10);
      if (batches.length === 0) {
        pi.sendMessage({
          customType: "pancode-panel",
          content: "No batches recorded.",
          display: true,
          details: { title: "PanCode Batches" },
        });
        return;
      }

      const lines: string[] = [];
      for (const batch of batches) {
        const statusStr = batch.completedAt ? "done" : "running";
        lines.push(`[${batch.id}] ${statusStr} ${batch.completedCount}/${batch.taskCount} ok, ${batch.failedCount} failed`);
      }

      pi.sendMessage({
        customType: "pancode-panel",
        content: lines.join("\n"),
        display: true,
        details: { title: "PanCode Batches" },
      });
    },
  });
});
