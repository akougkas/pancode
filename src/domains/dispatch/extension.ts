import { Type } from "@sinclair/typebox";
import { getModeDefinition } from "../../core/modes";
import { sharedBus } from "../../core/shared-bus";
import { shutdownCoordinator } from "../../core/termination";
import { defineExtension } from "../../engine/extensions";
import type { AgentToolResult } from "../../engine/types";
import { agentRegistry } from "../agents";
import { registerSafetyPreFlightChecks } from "../safety";
import { registerPreFlightCheck, runPreFlightChecks } from "./admission";
import { batchTracker } from "./batch-tracker";
import { cleanupAllWorktrees, createWorktreeIsolation, mergeDeltaPatches } from "./isolation";
import { dispatchChain, runParallel } from "./primitives";
import { resolveWorkerRouting } from "./routing";
import { DEFAULT_DISPATCH_RULES, type DispatchRule, evaluateRules } from "./rules";
import { RunLedger, createRunEnvelope } from "./state";
import { initTaskStore, taskCheck, taskList, taskUpdate, taskWrite } from "./task-tools";
import { liveWorkerProcesses, spawnWorker, stopAllWorkers } from "./worker-spawn";

function textResult(text: string): AgentToolResult<unknown> {
  return { content: [{ type: "text", text }], details: undefined };
}

let ledger: RunLedger | null = null;
const dispatchRules: DispatchRule[] = [...DEFAULT_DISPATCH_RULES];
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
    initTaskStore(runtimeRoot);
    draining = false;
    registerSafetyPreFlightChecks(registerPreFlightCheck);

    // Listen for session reset events (/new command). Clear task store.
    sharedBus.on("pancode:session-reset", () => {
      initTaskStore(runtimeRoot);
      console.error("[pancode:dispatch] Task store reset for new session.");
    });

    // Register drain handler with shutdown coordinator
    shutdownCoordinator.onDrain(() => {
      draining = true;
      sharedBus.emit("pancode:shutdown-draining", {});
    });

    shutdownCoordinator.onTerminate(async () => {
      await stopAllWorkers();
      await cleanupAllWorktrees();
      ledger?.markInterrupted();
    });
  });

  pi.registerTool({
    name: "dispatch_agent",
    label: "Dispatch Agent",
    description:
      "Delegate a task to a specialized PanCode worker agent. The worker runs as a separate subprocess with its own context window. Use this to parallelize work or delegate to specialized agents (dev, reviewer, scout).",
    parameters: Type.Object({
      task: Type.String({ description: "The task description to send to the worker agent" }),
      agent: Type.Optional(Type.String({ description: "Agent spec name (default: dev)", default: "dev" })),
      isolate: Type.Optional(
        Type.Boolean({ description: "Run in a git worktree for filesystem isolation", default: false }),
      ),
    }),
    async execute(_toolCallId, params, signal, onUpdate, ctx) {
      const defaultAgent = process.env.PANCODE_DEFAULT_AGENT ?? "dev";
      const agentName = params.agent || defaultAgent;
      const task = params.task;
      const isolate = params.isolate ?? false;

      // Mode gating: check if dispatch is allowed in the current behavior mode
      const mode = getModeDefinition();
      if (!mode.dispatchEnabled) {
        return textResult(
          `Dispatch is disabled in ${mode.name} mode. Switch to Build mode (Shift+Tab) to dispatch workers.`,
        );
      }

      // In modes without mutations, only readonly agents are permitted
      if (!mode.mutationsAllowed) {
        const spec = agentRegistry.get(agentName);
        if (spec && !spec.readonly) {
          return textResult(
            `Agent "${agentName}" is not readonly. ${mode.name} mode only allows readonly agents. Use scout or reviewer.`,
          );
        }
      }

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
      const run = createRunEnvelope(task, dispatchAction.agent, ctx.cwd, undefined, routing.runtime);
      run.model = routing.model;
      run.status = "running";
      ledger?.add(run);

      sharedBus.emit("pancode:run-started", {
        runId: run.id,
        task,
        agent: dispatchAction.agent,
        model: routing.model,
        runtime: routing.runtime,
      });

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
        agentName: dispatchAction.agent,
        sampling: routing.sampling,
        signal: signal ?? undefined,
        runId: run.id,
        runtime: routing.runtime,
        runtimeArgs: routing.runtimeArgs,
        readonly: routing.readonly,
      });

      // Merge worktree delta back to parent
      if (isolation) {
        try {
          const patches = await isolation.captureDelta();
          if (patches.length > 0) {
            const mergeResult = await mergeDeltaPatches(ctx.cwd, patches);
            if (!mergeResult.success) {
              workerResult.error = `${workerResult.error ? `${workerResult.error}; ` : ""}Delta merge failed: ${mergeResult.error}`;
            }
          }
        } catch (err) {
          workerResult.error = `${workerResult.error ? `${workerResult.error}; ` : ""}Delta capture failed: ${err instanceof Error ? err.message : String(err)}`;
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
        runtime: run.runtime,
        startedAt: run.startedAt,
        completedAt: run.completedAt ?? new Date().toISOString(),
      });

      const usageStr =
        workerResult.usage.cost > 0
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
      tasks: Type.Array(Type.String({ description: "Task descriptions" }), {
        description: "Array of task descriptions",
        minItems: 1,
        maxItems: 8,
      }),
      agent: Type.Optional(
        Type.String({ description: "Agent spec name for all tasks (default: dev)", default: "dev" }),
      ),
      concurrency: Type.Optional(
        Type.Number({ description: "Max parallel workers (default: 4)", default: 4, minimum: 1, maximum: 8 }),
      ),
    }),
    async execute(_toolCallId, params, signal, onUpdate, ctx) {
      const agentName = params.agent || "dev";
      const concurrency = params.concurrency || 4;
      const tasks = params.tasks;

      // Mode gating: check if dispatch is allowed in the current behavior mode
      const batchMode = getModeDefinition();
      if (!batchMode.dispatchEnabled) {
        return textResult(
          `Batch dispatch is disabled in ${batchMode.name} mode. Switch to Build mode (Shift+Tab) to dispatch workers.`,
        );
      }

      if (!batchMode.mutationsAllowed) {
        const spec = agentRegistry.get(agentName);
        if (spec && !spec.readonly) {
          return textResult(
            `Agent "${agentName}" is not readonly. ${batchMode.name} mode only allows readonly agents. Use scout or reviewer.`,
          );
        }
      }

      if (draining) {
        return textResult("Batch dispatch blocked: system is shutting down.");
      }

      // Pre-flight admission checks for batch dispatch
      const batchPreflight = runPreFlightChecks({
        task: tasks[0],
        agent: agentName,
        model: resolveWorkerRouting(agentName).model,
      });
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
        const run = createRunEnvelope(task, agentName, ctx.cwd, batch.id, routing.runtime);
        run.model = routing.model;
        run.status = "running";
        ledger?.add(run);
        batchTracker.addRun(batch.id, run.id);
        sharedBus.emit("pancode:run-started", {
          runId: run.id,
          task,
          agent: agentName,
          model: routing.model,
          runtime: routing.runtime,
        });
        return run;
      });

      if (onUpdate) {
        onUpdate(
          textResult(
            `Dispatching batch of ${tasks.length} tasks to ${agentName} workers (concurrency: ${concurrency})...`,
          ),
        );
      }

      const parallelTasks = tasks.map((task, i) => ({
        task,
        tools: routing.tools,
        model: routing.model,
        systemPrompt: routing.systemPrompt,
        cwd: ctx.cwd,
        agentName,
        sampling: routing.sampling,
        runId: runs[i].id,
        runtime: routing.runtime,
        runtimeArgs: routing.runtimeArgs,
        readonly: routing.readonly,
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
          runtime: run.runtime,
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
      summaryLines.push(
        `Completed: ${batchState?.completedCount ?? 0}/${tasks.length} | Failed: ${batchState?.failedCount ?? 0} | Cost: $${totalCost.toFixed(4)}`,
      );

      return textResult(summaryLines.join("\n"));
    },
  });

  pi.registerTool({
    name: "dispatch_chain",
    label: "Chain Dispatch",
    description:
      "Execute a sequential pipeline of agent tasks. Each step receives the previous step's output via $INPUT and the original task via $ORIGINAL. Steps run sequentially; a failure at any step stops the chain.",
    parameters: Type.Object({
      steps: Type.Array(
        Type.Object({
          task: Type.String({
            description: "Task for this step. Use $INPUT for previous output, $ORIGINAL for the original task.",
          }),
          agent: Type.Optional(Type.String({ description: "Agent for this step. Defaults to 'dev'." })),
        }),
        { minItems: 1, maxItems: 10 },
      ),
      originalTask: Type.String({ description: "The original high-level task description." }),
    }),
    async execute(_toolCallId, params, signal, onUpdate, ctx) {
      const defaultAgent = process.env.PANCODE_DEFAULT_AGENT ?? "dev";

      // Mode gating
      const mode = getModeDefinition();
      if (!mode.dispatchEnabled) {
        return textResult(`Chain dispatch is disabled in ${mode.name} mode. Switch to Build mode.`);
      }

      if (draining) {
        return textResult("Chain dispatch blocked: system is shutting down.");
      }

      // Pre-flight
      const preflight = runPreFlightChecks({
        task: params.originalTask,
        agent: defaultAgent,
        model: resolveWorkerRouting(defaultAgent).model,
      });
      if (!preflight.admit) {
        return textResult(`Chain dispatch blocked: ${preflight.reason}`);
      }

      if (onUpdate) {
        onUpdate(textResult(`Dispatching chain of ${params.steps.length} steps...`));
      }

      const chainResult = await dispatchChain(
        params.steps.map((s) => ({ task: s.task, agent: s.agent })),
        params.originalTask,
        defaultAgent,
        async (task, agent) => {
          const routing = resolveWorkerRouting(agent);
          const run = createRunEnvelope(task, agent, ctx.cwd, undefined, routing.runtime);
          run.model = routing.model;
          run.status = "running";
          ledger?.add(run);
          sharedBus.emit("pancode:run-started", {
            runId: run.id,
            task,
            agent,
            model: routing.model,
            runtime: routing.runtime,
          });

          const result = await spawnWorker({
            task,
            tools: routing.tools,
            model: routing.model,
            systemPrompt: routing.systemPrompt,
            cwd: ctx.cwd,
            agentName: agent,
            sampling: routing.sampling,
            signal: signal ?? undefined,
            runId: run.id,
            runtime: routing.runtime,
            runtimeArgs: routing.runtimeArgs,
            readonly: routing.readonly,
          });

          run.status = result.exitCode === 0 && !result.error ? "done" : "error";
          run.result = result.result;
          run.error = result.error;
          run.usage = result.usage;
          run.model = result.model ?? run.model;
          run.completedAt = new Date().toISOString();
          ledger?.update(run.id, run);

          sharedBus.emit("pancode:run-finished", {
            runId: run.id,
            agent: run.agent,
            status: run.status,
            usage: run.usage,
            runtime: run.runtime,
            startedAt: run.startedAt,
            completedAt: run.completedAt ?? new Date().toISOString(),
          });

          return result;
        },
        ctx.cwd,
        signal ?? undefined,
      );

      // Build summary
      const lines: string[] = [
        `Chain: ${params.steps.length} steps, ${chainResult.success ? "SUCCESS" : "FAILED"}`,
        "",
      ];
      for (const step of chainResult.steps) {
        const statusStr = step.result.exitCode === 0 && !step.result.error ? "OK" : "FAIL";
        const costStr = step.result.usage.cost > 0 ? ` $${step.result.usage.cost.toFixed(4)}` : "";
        const durStr = ` ${(step.durationMs / 1000).toFixed(1)}s`;
        const truncatedTask = step.task.length > 50 ? `${step.task.slice(0, 47)}...` : step.task;
        lines.push(`  Step ${step.stepIndex + 1}: [${statusStr}] ${step.agent} ${truncatedTask}${costStr}${durStr}`);
        if (step.validation && !step.validation.valid) {
          for (const check of step.validation.checks.filter((c) => !c.passed)) {
            lines.push(`    FAIL: ${check.kind} ${check.target}${check.detail ? ` (${check.detail})` : ""}`);
          }
        }
      }

      if (!chainResult.success && chainResult.failedAtStep !== undefined) {
        lines.push("");
        lines.push(`Chain stopped at step ${chainResult.failedAtStep + 1}.`);
      }

      lines.push("");
      lines.push(`Final output:\n${chainResult.finalOutput.slice(0, 1000)}`);

      return textResult(lines.join("\n"));
    },
  });

  // === Commands ===

  pi.registerCommand("stoprun", {
    description: "Stop a running dispatch by run ID",
    async handler(args, ctx) {
      const query = args.trim();
      if (!query) {
        ctx.ui.notify("Usage: /stoprun <run-id>", "error");
        return;
      }

      if (!ledger) {
        ctx.ui.notify("Dispatch ledger not initialized.", "error");
        return;
      }

      // Find run by ID prefix match
      const active = ledger.getActive();
      const match = active.find((r) => r.id === query || r.id.startsWith(query));
      if (!match) {
        ctx.ui.notify(`No active run found matching: ${query}`, "error");
        return;
      }

      // Kill worker process
      let killed = false;
      for (const proc of liveWorkerProcesses) {
        // Worker processes are matched by liveness. Kill the first one matching the run.
        try {
          proc.kill("SIGTERM");
          killed = true;
          break;
        } catch {
          // process already dead
        }
      }

      match.status = "cancelled";
      match.completedAt = new Date().toISOString();
      ledger.update(match.id, match);

      sharedBus.emit("pancode:run-finished", {
        runId: match.id,
        agent: match.agent,
        status: "cancelled",
        usage: match.usage,
        runtime: match.runtime,
        startedAt: match.startedAt,
        completedAt: match.completedAt,
      });

      ctx.ui.notify(`Run ${match.id} cancelled.${killed ? " Worker process terminated." : ""}`, "info");
    },
  });

  pi.registerCommand("cost", {
    description: "Show per-run cost breakdown",
    async handler(_args, _ctx) {
      if (!ledger) {
        pi.sendMessage({
          customType: "pancode-panel",
          content: "Dispatch ledger not initialized.",
          display: true,
          details: { title: "PanCode Cost" },
        });
        return;
      }

      const allRuns = ledger.getAll();
      if (allRuns.length === 0) {
        pi.sendMessage({
          customType: "pancode-panel",
          content: "No runs recorded.",
          display: true,
          details: { title: "PanCode Cost" },
        });
        return;
      }

      let totalCost = 0;
      const byAgent = new Map<string, { runs: number; cost: number }>();
      const byModel = new Map<string, { runs: number; cost: number }>();
      const byRuntime = new Map<string, { runs: number; cost: number; hasCosts: boolean }>();

      for (const run of allRuns) {
        totalCost += run.usage.cost;

        const agentStats = byAgent.get(run.agent) ?? { runs: 0, cost: 0 };
        agentStats.runs++;
        agentStats.cost += run.usage.cost;
        byAgent.set(run.agent, agentStats);

        const modelKey = run.model ?? "(unresolved)";
        const modelStats = byModel.get(modelKey) ?? { runs: 0, cost: 0 };
        modelStats.runs++;
        modelStats.cost += run.usage.cost;
        byModel.set(modelKey, modelStats);

        const runtimeKey = run.runtime ?? "pi";
        const runtimeStats = byRuntime.get(runtimeKey) ?? { runs: 0, cost: 0, hasCosts: false };
        runtimeStats.runs++;
        runtimeStats.cost += run.usage.cost;
        if (run.usage.cost > 0) runtimeStats.hasCosts = true;
        byRuntime.set(runtimeKey, runtimeStats);
      }

      const lines: string[] = [`Total: ${allRuns.length} runs, $${totalCost.toFixed(4)}`, ""];

      lines.push(
        `${"RUNTIME".padEnd(20)} ${"RUNS".padEnd(6)} COST`,
        `${"-------".padEnd(20)} ${"----".padEnd(6)} ----`,
      );
      for (const [runtime, stats] of [...byRuntime.entries()].sort((a, b) => b[1].cost - a[1].cost)) {
        // Show real cost for runtimes that report it; show "--" for those that do not
        const costStr = stats.hasCosts ? `$${stats.cost.toFixed(4)}` : "\u2014";
        lines.push(`  ${runtime.padEnd(18)} ${String(stats.runs).padEnd(6)} ${costStr}`);
      }

      lines.push("", "By agent:");
      for (const [agent, stats] of [...byAgent.entries()].sort((a, b) => b[1].cost - a[1].cost)) {
        lines.push(`  ${agent.padEnd(12)} ${String(stats.runs).padEnd(6)} $${stats.cost.toFixed(4)}`);
      }

      lines.push("", "By model:");
      for (const [model, stats] of [...byModel.entries()].sort((a, b) => b[1].cost - a[1].cost)) {
        const shortModel = model.length > 40 ? `${model.slice(0, 37)}...` : model;
        lines.push(`  ${shortModel.padEnd(42)} ${String(stats.runs).padEnd(6)} $${stats.cost.toFixed(4)}`);
      }

      // Note about CLI runtimes that do not report costs
      const unreported = [...byRuntime.entries()].filter(([_, s]) => !s.hasCosts);
      if (unreported.length > 0) {
        lines.push("", "CLI runtimes with \u2014 do not report costs.");
      }

      pi.sendMessage({
        customType: "pancode-panel",
        content: lines.join("\n"),
        display: true,
        details: { title: "PanCode Cost" },
      });
    },
  });

  pi.registerCommand("dispatch-insights", {
    description: "Show dispatch analytics and rule evaluation",
    async handler(_args, _ctx) {
      if (!ledger) {
        pi.sendMessage({
          customType: "pancode-panel",
          content: "Dispatch ledger not initialized.",
          display: true,
          details: { title: "PanCode Dispatch Insights" },
        });
        return;
      }

      const allRuns = ledger.getAll();
      if (allRuns.length === 0) {
        pi.sendMessage({
          customType: "pancode-panel",
          content: "No dispatch history.",
          display: true,
          details: { title: "PanCode Dispatch Insights" },
        });
        return;
      }

      // Aggregate stats by agent and runtime
      const byAgent = new Map<string, { runs: number; ok: number; errored: number; totalMs: number }>();
      const byRuntime = new Map<string, { runs: number; cost: number; totalMs: number; hasCosts: boolean }>();
      for (const run of allRuns) {
        const agentStats = byAgent.get(run.agent) ?? { runs: 0, ok: 0, errored: 0, totalMs: 0 };
        agentStats.runs++;
        if (run.status === "done") agentStats.ok++;
        if (run.status === "error") agentStats.errored++;
        const dMs =
          run.completedAt && run.startedAt
            ? new Date(run.completedAt).getTime() - new Date(run.startedAt).getTime()
            : 0;
        agentStats.totalMs += dMs;
        byAgent.set(run.agent, agentStats);

        const runtimeKey = run.runtime ?? "pi";
        const rtStats = byRuntime.get(runtimeKey) ?? { runs: 0, cost: 0, totalMs: 0, hasCosts: false };
        rtStats.runs++;
        rtStats.cost += run.usage.cost;
        rtStats.totalMs += dMs;
        if (run.usage.cost > 0) rtStats.hasCosts = true;
        byRuntime.set(runtimeKey, rtStats);
      }

      const lines: string[] = [
        `Dispatch Insights (${allRuns.length} total runs)`,
        "",
        `${"AGENT".padEnd(12)} ${"RUNS".padEnd(6)} ${"OK".padEnd(6)} ${"ERR".padEnd(6)} ${"ERR%".padEnd(8)} AVG TIME`,
        `${"-----".padEnd(12)} ${"----".padEnd(6)} ${"--".padEnd(6)} ${"---".padEnd(6)} ${"----".padEnd(8)} --------`,
      ];

      for (const [agent, stats] of [...byAgent.entries()].sort((a, b) => b[1].runs - a[1].runs)) {
        const errPct = stats.runs > 0 ? ((stats.errored / stats.runs) * 100).toFixed(0) : "0";
        const avgMs = stats.runs > 0 ? stats.totalMs / stats.runs : 0;
        const avgStr = avgMs > 60000 ? `${(avgMs / 60000).toFixed(1)}m` : `${(avgMs / 1000).toFixed(1)}s`;
        lines.push(
          `${agent.padEnd(12)} ${String(stats.runs).padEnd(6)} ${String(stats.ok).padEnd(6)} ${String(stats.errored).padEnd(6)} ${`${errPct}%`.padEnd(8)} ${avgStr}`,
        );
      }

      // Runtime breakdown
      if (byRuntime.size > 0) {
        lines.push("", "RUNTIME BREAKDOWN");
        for (const [runtime, stats] of [...byRuntime.entries()].sort((a, b) => b[1].runs - a[1].runs)) {
          const runsLabel = stats.runs === 1 ? "1 run " : `${stats.runs} runs`;
          const costStr = stats.hasCosts ? `$${stats.cost.toFixed(2)}` : "\u2014".padEnd(5);
          const avgMs = stats.runs > 0 ? stats.totalMs / stats.runs : 0;
          const avgStr = avgMs > 60000 ? `avg ${(avgMs / 60000).toFixed(1)}m` : `avg ${(avgMs / 1000).toFixed(1)}s`;
          lines.push(`  ${runtime.padEnd(16)} ${runsLabel.padEnd(8)} ${costStr.padEnd(8)} ${avgStr}`);
        }
      }

      // Recent runs
      const recent = allRuns.slice(-5);
      lines.push("", "Last 5 dispatches:");
      for (const run of recent) {
        const durationMs =
          run.completedAt && run.startedAt
            ? new Date(run.completedAt).getTime() - new Date(run.startedAt).getTime()
            : 0;
        const durStr = durationMs > 0 ? ` ${(durationMs / 1000).toFixed(1)}s` : "";
        const truncatedTask = run.task.length > 40 ? `${run.task.slice(0, 37)}...` : run.task;
        lines.push(`  [${run.id}] ${run.status.padEnd(9)} ${run.agent.padEnd(8)} ${truncatedTask}${durStr}`);
      }

      // Active dispatch rules
      lines.push("", `Active dispatch rules: ${dispatchRules.length}`);
      for (const rule of dispatchRules.slice(0, 5)) {
        lines.push(`  ${rule.name}`);
      }

      pi.sendMessage({
        customType: "pancode-panel",
        content: lines.join("\n"),
        display: true,
        details: { title: "PanCode Dispatch Insights" },
      });
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

      const count = Number.parseInt(args.trim(), 10) || 10;
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
          const runtimeLabel = (run.runtime ?? "pi").padEnd(16);
          const truncatedTask = run.task.length > 50 ? `${run.task.slice(0, 47)}...` : run.task;
          lines.push(
            `[${run.id}] ${run.status.padEnd(9)} ${run.agent.padEnd(10)} ${runtimeLabel} ${truncatedTask}${costStr}`,
          );
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
        lines.push(
          `[${batch.id}] ${statusStr} ${batch.completedCount}/${batch.taskCount} ok, ${batch.failedCount} failed`,
        );
      }

      pi.sendMessage({
        customType: "pancode-panel",
        content: lines.join("\n"),
        display: true,
        details: { title: "PanCode Batches" },
      });
    },
  });

  // === Task tracking tools ===

  pi.registerTool({
    name: "task_write",
    label: "Write Task",
    description: "Create a task in the PanCode task list. Use this to track work items, TODOs, and planned changes.",
    parameters: Type.Object({
      title: Type.String({ description: "Short task title" }),
      description: Type.Optional(Type.String({ description: "Detailed task description" })),
    }),
    async execute(_id, params) {
      const newTask = taskWrite(params.title, params.description ?? "");
      return textResult(`Task created: [${newTask.id}] ${newTask.title}`);
    },
  });

  pi.registerTool({
    name: "task_check",
    label: "Check Task",
    description: "Mark a task as done in the PanCode task list.",
    parameters: Type.Object({
      id: Type.String({ description: "Task ID (e.g., t-abc123)" }),
    }),
    async execute(_id, params) {
      const checked = taskCheck(params.id);
      if (!checked) return textResult(`Task not found: ${params.id}`);
      return textResult(`Task completed: [${checked.id}] ${checked.title}`);
    },
  });

  pi.registerTool({
    name: "task_update",
    label: "Update Task",
    description: "Update a task's title, description, or status.",
    parameters: Type.Object({
      id: Type.String({ description: "Task ID" }),
      title: Type.Optional(Type.String()),
      description: Type.Optional(Type.String()),
      status: Type.Optional(
        Type.Union([Type.Literal("todo"), Type.Literal("doing"), Type.Literal("done"), Type.Literal("blocked")]),
      ),
    }),
    async execute(_id, params) {
      const updated = taskUpdate(params.id, {
        title: params.title,
        description: params.description,
        status: params.status,
      });
      if (!updated) return textResult(`Task not found: ${params.id}`);
      return textResult(`Task updated: [${updated.id}] ${updated.title} (${updated.status})`);
    },
  });

  pi.registerTool({
    name: "task_list",
    label: "List Tasks",
    description: "List all tasks in the PanCode task list.",
    parameters: Type.Object({}),
    async execute() {
      const allTasks = taskList();
      if (allTasks.length === 0) return textResult("No tasks.");
      const lines = allTasks.map((t) => `[${t.id}] ${t.status.padEnd(7)} ${t.title}`);
      return textResult(lines.join("\n"));
    },
  });
});
