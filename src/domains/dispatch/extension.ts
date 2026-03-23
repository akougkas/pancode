import { createHash, randomUUID } from "node:crypto";
import { existsSync, readdirSync, statSync, unlinkSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";
import { Type } from "@sinclair/typebox";
import { DEFAULT_AGENT } from "../../core/agent-names";
import { BusChannel } from "../../core/bus-events";
import { PanMessageType } from "../../core/message-types";
import { getModeDefinition } from "../../core/modes";
import { sharedBus } from "../../core/shared-bus";
import { shutdownCoordinator } from "../../core/termination";
import { ToolName } from "../../core/tool-names";
import { PiEvent } from "../../engine/events";
import { defineExtension } from "../../engine/extensions";
import type { AgentToolResult } from "../../engine/types";
import { agentRegistry } from "../agents";
import { workerPool } from "../agents/worker-pool";
import { compileWorkerPrompt } from "../prompts";
import { findModelProfile } from "../providers";
import { registerSafetyPreFlightChecks } from "../safety";
import { registerPreFlightCheck, runPreFlightChecks } from "./admission";
import { type BackoffManager, createBackoffManager } from "./backoff";
import { batchTracker } from "./batch-tracker";
import { cleanupAllWorktrees, createWorktreeIsolation, mergeDeltaPatches } from "./isolation";
import { dispatchChain, runParallel } from "./primitives";
import { type ResilienceTracker, createResilienceTracker } from "./resilience";
import { resolveWorkerRouting } from "./routing";
import { DEFAULT_DISPATCH_RULES, type DispatchRule, evaluateRules } from "./rules";
import { RunLedger, createRunEnvelope } from "./state";
import { initTaskStore, taskCheck, taskList, taskUpdate, taskWrite } from "./task-tools";
import { liveWorkerProcesses, spawnWorker, stopAllWorkers, workerProcessByRunId } from "./worker-spawn";

function textResult(text: string): AgentToolResult<unknown> {
  return { content: [{ type: "text", text }], details: undefined };
}

/** Resolve a model profile from a "provider/model-id" string. */
function resolveModelProfile(modelRef: string | null) {
  if (!modelRef) return null;
  const slash = modelRef.indexOf("/");
  if (slash === -1) return null;
  return findModelProfile(modelRef.slice(0, slash), modelRef.slice(slash + 1)) ?? null;
}

let ledger: RunLedger | null = null;
const dispatchRules: DispatchRule[] = [...DEFAULT_DISPATCH_RULES];
let draining = false;

// Provider resilience: backoff on repeated failures, health tracking.
const backoff: BackoffManager = createBackoffManager();
const resilience: ResilienceTracker = createResilienceTracker();

/** Extract provider ID from a "provider/model-id" string. */
function extractProvider(model: string | null): string | null {
  if (!model) return null;
  const slash = model.indexOf("/");
  return slash > 0 ? model.slice(0, slash) : null;
}

// ---------------------------------------------------------------------------
// File path pre-validation for dispatch tasks (tests 10b, 10c)
// ---------------------------------------------------------------------------

/** Regex to extract file paths from task text. Matches common source file patterns. */
const FILE_PATH_RE = /(?:^|\s)((?:\.\/|\.\.\/|\/|src\/|lib\/|test\/)\S+\.\w{1,10})/g;

interface PathValidation {
  warnings: string[];
  blocked: boolean;
  blockReason?: string;
}

/**
 * Scan task text for referenced file paths. Warn about missing files and
 * block paths that escape the project root (scope violation).
 */
function validateTaskPaths(task: string, cwd: string): PathValidation {
  const warnings: string[] = [];
  let blocked = false;
  let blockReason: string | undefined;

  const matches = task.matchAll(FILE_PATH_RE);
  for (const match of matches) {
    const raw = match[1];
    const full = isAbsolute(raw) ? raw : resolve(cwd, raw);
    const normalized = resolve(full);

    // Path escape detection: block any absolute path outside the project root.
    if (!normalized.startsWith(cwd)) {
      blocked = true;
      blockReason = `Scope violation: "${raw}" resolves outside the project root. Workers must not access files outside ${cwd}.`;
      break;
    }

    // Missing file warning: inform the user but allow dispatch so the agent can adapt.
    if (!existsSync(normalized)) {
      warnings.push(`File not found: ${raw}`);
    }
  }

  return { warnings, blocked, blockReason };
}

// ---------------------------------------------------------------------------
// Run status classification
// ---------------------------------------------------------------------------

/** Classify a WorkerResult into a RunStatus for the ledger. */
function classifyRunStatus(workerResult: {
  exitCode: number;
  error: string;
  timedOut?: boolean;
  budgetExceeded?: boolean;
}): "done" | "error" | "timeout" | "budget_exceeded" {
  if (workerResult.timedOut) return "timeout";
  if (workerResult.budgetExceeded) return "budget_exceeded";
  if (workerResult.exitCode === 0 && !workerResult.error) return "done";
  return "error";
}

/** Max age for worker artifacts before cleanup: 24 hours. */
const ARTIFACT_MAX_AGE_MS = 24 * 60 * 60 * 1000;

/**
 * Remove stale worker session files and result files.
 * Pi sessions accumulate in PI_CODING_AGENT_DIR/sessions/ with no built-in cleanup.
 * Worker result files accumulate in PANCODE_RUNTIME_ROOT.
 */
function cleanupStaleArtifacts(): void {
  const cutoff = Date.now() - ARTIFACT_MAX_AGE_MS;

  // 1. Clean Pi session files
  const agentDir = process.env.PI_CODING_AGENT_DIR;
  if (agentDir) {
    const sessionsDir = join(agentDir, "sessions");
    cleanupDir(sessionsDir, cutoff);
  }

  // 2. Clean worker result files
  const runtimeRoot = process.env.PANCODE_RUNTIME_ROOT;
  if (runtimeRoot) {
    cleanupDir(runtimeRoot, cutoff, /^worker-.*\.result\.json$/);
  }
}

/** Remove files older than cutoff from a directory. Optional filename pattern filter. */
function cleanupDir(dir: string, cutoffMs: number, pattern?: RegExp): void {
  if (!existsSync(dir)) return;
  try {
    const entries = readdirSync(dir);
    let removed = 0;
    for (const entry of entries) {
      if (pattern && !pattern.test(entry)) continue;
      const filepath = join(dir, entry);
      try {
        const stat = statSync(filepath);
        if (stat.isFile() && stat.mtimeMs < cutoffMs) {
          unlinkSync(filepath);
          removed++;
        }
      } catch {
        // File may have been removed by another process; ignore.
      }
    }
    if (removed > 0 && process.env.PANCODE_VERBOSE) {
      console.error(`[pancode:dispatch] Cleaned ${removed} stale files from ${dir}`);
    }
  } catch {
    // Directory listing failed; ignore.
  }
}

/** Record a dispatch result in backoff and resilience trackers. */
function recordDispatchOutcome(model: string | null, exitCode: number, error: string): void {
  const provider = extractProvider(model);
  if (!provider) return;

  if (exitCode === 0 && !error) {
    backoff.signalSuccess(provider);
    resilience.recordSuccess(provider);
  } else {
    // Detect rate limiting from error text
    const is429 = error.includes("429") || error.includes("rate limit") || error.includes("Rate limit");
    if (is429) {
      backoff.signal429(provider);
    } else {
      backoff.signalFailure(provider);
    }
    resilience.recordFailure(provider, error.slice(0, 200));
  }
}

export function getRunLedger(): RunLedger | null {
  return ledger;
}

export const extension = defineExtension((pi) => {
  pi.on(PiEvent.SESSION_START, (_event, ctx) => {
    const packageRoot = process.env.PANCODE_PACKAGE_ROOT;
    if (!packageRoot) {
      console.error("[pancode:dispatch] PANCODE_PACKAGE_ROOT is not set. Domain state will not persist.");
    }
    const runtimeRoot = packageRoot ? `${packageRoot}/.pancode` : ".pancode";
    ledger = new RunLedger(runtimeRoot);
    initTaskStore(runtimeRoot);
    draining = false;

    // Session boundary marker
    const sessionId = randomUUID().slice(0, 8);
    process.env.PANCODE_SESSION_ID = sessionId;
    ledger.addSessionMarker({ type: "session_start", timestamp: new Date().toISOString(), sessionId });
    registerSafetyPreFlightChecks(registerPreFlightCheck);

    // Listen for session reset events (/new command). Clear task store.
    sharedBus.on(BusChannel.SESSION_RESET, () => {
      initTaskStore(runtimeRoot);
      if (process.env.PANCODE_VERBOSE) {
        console.error("[pancode:dispatch] Task store reset for new session.");
      }
    });

    // Register drain handler with shutdown coordinator
    shutdownCoordinator.onDrain(() => {
      draining = true;
      sharedBus.emit(BusChannel.SHUTDOWN_DRAINING, {});
    });

    shutdownCoordinator.onTerminate(async () => {
      await stopAllWorkers();
      await cleanupAllWorktrees();
      ledger?.markInterrupted();
    });
  });

  pi.on(PiEvent.SESSION_SHUTDOWN, async () => {
    const sessionId = process.env.PANCODE_SESSION_ID ?? "unknown";
    ledger?.addSessionMarker({ type: "session_end", timestamp: new Date().toISOString(), sessionId });

    // Cleanup stale worker artifacts: Pi session files and result files older than 24 hours.
    cleanupStaleArtifacts();
  });

  pi.registerTool({
    name: ToolName.DISPATCH_AGENT,
    label: "Dispatch Agent",
    description:
      "Delegate a task to a specialized PanCode worker agent. The worker runs as a separate subprocess with its own context window. Use this to parallelize work or delegate to specialized agents (dev, reviewer).",
    parameters: Type.Object({
      task: Type.String({ description: "The task description to send to the worker agent" }),
      agent: Type.Optional(Type.String({ description: "Agent spec name (default: dev)", default: DEFAULT_AGENT })),
      isolate: Type.Optional(
        Type.Boolean({ description: "Run in a git worktree for filesystem isolation", default: false }),
      ),
    }),
    async execute(_toolCallId, params, signal, onUpdate, ctx) {
      const defaultAgent = process.env.PANCODE_DEFAULT_AGENT ?? DEFAULT_AGENT;
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
            `Agent "${agentName}" is not readonly. ${mode.name} mode only allows readonly agents. Use reviewer.`,
          );
        }
      }

      if (draining) {
        return textResult("Dispatch blocked: system is shutting down.");
      }

      // Recursion depth guard: prevent unbounded subprocess trees.
      const dispatchDepth = Number.parseInt(process.env.PANCODE_DISPATCH_DEPTH ?? "0", 10);
      const maxDepth = Number.parseInt(process.env.PANCODE_DISPATCH_MAX_DEPTH ?? "2", 10);
      if (dispatchDepth >= maxDepth) {
        return textResult(
          `Dispatch blocked: recursion depth ${dispatchDepth} exceeds maximum ${maxDepth}. Complete the current task directly.`,
        );
      }

      if (!task?.trim()) {
        return textResult("Error: empty task");
      }

      // File path pre-validation: block scope violations, warn about missing files.
      const pathCheck = validateTaskPaths(task, ctx.cwd);
      if (pathCheck.blocked) {
        return textResult(`Dispatch blocked: ${pathCheck.blockReason}`);
      }
      if (pathCheck.warnings.length > 0) {
        const warningText = pathCheck.warnings.join("; ");
        sharedBus.emit(BusChannel.WARNING, { source: "dispatch", message: `Path warnings: ${warningText}` });
        if (onUpdate) {
          onUpdate(textResult(`Warning: ${warningText}. Dispatching anyway (agent may adapt).`));
        }
      }

      // Pre-flight admission checks (budget, safety, etc. registered by other domains)
      let preflightRouting: ReturnType<typeof resolveWorkerRouting>;
      try {
        preflightRouting = resolveWorkerRouting(agentName);
      } catch (err) {
        return textResult(err instanceof Error ? err.message : String(err));
      }
      const preflight = runPreFlightChecks({ task, agent: agentName, model: preflightRouting.model });
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

      // Reuse preflight routing if rules did not remap the agent to avoid duplicate warnings.
      let routing: ReturnType<typeof resolveWorkerRouting>;
      if (dispatchAction.agent === agentName) {
        routing = preflightRouting;
      } else {
        try {
          routing = resolveWorkerRouting(dispatchAction.agent);
        } catch (err) {
          return textResult(err instanceof Error ? err.message : String(err));
        }
      }

      // Provider backoff: reject dispatch if the provider is in a backoff window.
      const routingProvider = extractProvider(routing.model);
      if (routingProvider && backoff.isBackedOff(routingProvider)) {
        const waitSec = Math.ceil(backoff.getWaitMs(routingProvider) / 1000);
        return textResult(
          `Dispatch throttled: provider "${routingProvider}" is backed off for ${waitSec}s due to repeated failures.`,
        );
      }

      const run = createRunEnvelope(task, dispatchAction.agent, ctx.cwd, undefined, routing.runtime);
      run.model = routing.model;
      run.status = "running";
      ledger?.add(run);

      sharedBus.emit(BusChannel.RUN_STARTED, {
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

      // Compile dynamic worker prompt from PanPrompt engine.
      const spec = agentRegistry.get(dispatchAction.agent);
      const workerProfile = routing.model ? resolveModelProfile(routing.model) : null;
      const workerPrompt = compileWorkerPrompt(
        spec ?? null,
        {
          agentName: dispatchAction.agent,
          task: dispatchAction.task,
          readonly: routing.readonly,
          tools: routing.tools,
          mode: getModeDefinition().id,
          tier: "mid",
        },
        workerProfile,
      );

      // Store receipt context on the envelope for post-dispatch receipt generation.
      run.promptHash = createHash("sha256").update(workerPrompt).digest("hex");
      run.workerTools = routing.tools;
      ledger?.update(run.id, run);

      // Track worker pool load for scoring
      if (routing.workerId) {
        workerPool.recordDispatchStart(routing.workerId);
      }

      let workerResult: Awaited<ReturnType<typeof spawnWorker>>;
      try {
        workerResult = await spawnWorker({
          task: dispatchAction.task,
          tools: routing.tools,
          model: routing.model,
          systemPrompt: workerPrompt,
          cwd: workerCwd,
          agentName: dispatchAction.agent,
          sampling: routing.sampling,
          signal: signal ?? undefined,
          runId: run.id,
          runtime: routing.runtime,
          runtimeArgs: routing.runtimeArgs,
          readonly: routing.readonly,
        });
      } finally {
        if (routing.workerId) {
          workerPool.recordDispatchEnd(routing.workerId);
        }
      }

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

      run.status = classifyRunStatus(workerResult);
      run.result = workerResult.result;
      run.error = workerResult.error;
      run.usage = workerResult.usage;
      run.model = workerResult.model ?? run.model;
      run.completedAt = new Date().toISOString();
      ledger?.update(run.id, run);

      // Record outcome for provider health tracking and backoff.
      recordDispatchOutcome(run.model, workerResult.exitCode, workerResult.error);

      // Spec originally defined separate run-completed and run-failed events.
      // Unified to run-finished with status field for simpler subscriber logic.
      sharedBus.emit(BusChannel.RUN_FINISHED, {
        runId: run.id,
        agent: run.agent,
        status: run.status,
        usage: run.usage,
        runtime: run.runtime,
        startedAt: run.startedAt,
        completedAt: run.completedAt ?? new Date().toISOString(),
      });

      const costVal = workerResult.usage.cost;
      const turnsVal = workerResult.usage.turns;
      const usageStr =
        costVal != null && costVal > 0
          ? ` | cost: $${costVal.toFixed(4)} | turns: ${turnsVal ?? "--"}`
          : turnsVal != null
            ? ` | turns: ${turnsVal}`
            : "";

      const statusLabels: Record<string, string> = {
        done: "completed",
        error: "failed",
        timeout: "timed out",
        budget_exceeded: "budget exceeded",
      };
      const statusLabel = statusLabels[run.status] ?? "failed";
      const summary = `Worker ${statusLabel} (${run.id})${usageStr}\n\nAgent: ${run.agent}${run.model ? ` | Model: ${run.model}` : ""}`;

      if (run.status !== "done") {
        return textResult(`${summary}\n\nError: ${run.error}`);
      }

      return textResult(`${summary}\n\nResult:\n${run.result}`);
    },
  });

  pi.registerTool({
    name: ToolName.BATCH_DISPATCH,
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
        Type.String({ description: "Agent spec name for all tasks (default: dev)", default: DEFAULT_AGENT }),
      ),
      concurrency: Type.Optional(
        Type.Number({ description: "Max parallel workers (default: 4)", default: 4, minimum: 1, maximum: 8 }),
      ),
    }),
    async execute(_toolCallId, params, signal, onUpdate, ctx) {
      const agentName = params.agent || DEFAULT_AGENT;
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
            `Agent "${agentName}" is not readonly. ${batchMode.name} mode only allows readonly agents. Use reviewer.`,
          );
        }
      }

      if (draining) {
        return textResult("Batch dispatch blocked: system is shutting down.");
      }

      // Recursion depth guard for batch dispatch
      const batchDepth = Number.parseInt(process.env.PANCODE_DISPATCH_DEPTH ?? "0", 10);
      const batchMaxDepth = Number.parseInt(process.env.PANCODE_DISPATCH_MAX_DEPTH ?? "2", 10);
      if (batchDepth >= batchMaxDepth) {
        return textResult(
          `Batch dispatch blocked: recursion depth ${batchDepth} exceeds maximum ${batchMaxDepth}. Complete the current task directly.`,
        );
      }

      // File path pre-validation for all batch tasks.
      for (const batchTask of tasks) {
        const batchPathCheck = validateTaskPaths(batchTask, ctx.cwd);
        if (batchPathCheck.blocked) {
          return textResult(`Batch dispatch blocked: ${batchPathCheck.blockReason}`);
        }
        if (batchPathCheck.warnings.length > 0) {
          const warningText = batchPathCheck.warnings.join("; ");
          sharedBus.emit(BusChannel.WARNING, { source: "dispatch", message: `Path warnings: ${warningText}` });
        }
      }

      // Pre-flight admission checks for batch dispatch
      let batchPreflightRouting: ReturnType<typeof resolveWorkerRouting>;
      try {
        batchPreflightRouting = resolveWorkerRouting(agentName);
      } catch (err) {
        return textResult(err instanceof Error ? err.message : String(err));
      }
      const batchPreflight = runPreFlightChecks({
        task: tasks[0],
        agent: agentName,
        model: batchPreflightRouting.model,
      });
      if (!batchPreflight.admit) {
        return textResult(`Batch dispatch blocked: ${batchPreflight.reason}`);
      }

      if (!agentRegistry.has(agentName)) {
        const available = agentRegistry.names().join(", ");
        return textResult(`Unknown agent "${agentName}". Available: ${available}`);
      }

      const routing = batchPreflightRouting;

      // Provider backoff check for batch dispatch
      const batchProvider = extractProvider(routing.model);
      if (batchProvider && backoff.isBackedOff(batchProvider)) {
        const waitSec = Math.ceil(backoff.getWaitMs(batchProvider) / 1000);
        return textResult(
          `Batch dispatch throttled: provider "${batchProvider}" is backed off for ${waitSec}s due to repeated failures.`,
        );
      }

      const batch = batchTracker.create(tasks.length);
      const runs = tasks.map((task) => {
        const run = createRunEnvelope(task, agentName, ctx.cwd, batch.id, routing.runtime);
        run.model = routing.model;
        run.status = "running";
        ledger?.add(run);
        batchTracker.addRun(batch.id, run.id);
        sharedBus.emit(BusChannel.RUN_STARTED, {
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

      // Compile dynamic worker prompts from PanPrompt engine.
      const batchSpec = agentRegistry.get(agentName);
      const batchProfile = routing.model ? resolveModelProfile(routing.model) : null;
      const parallelTasks = tasks.map((task, i) => {
        const wp = compileWorkerPrompt(
          batchSpec ?? null,
          {
            agentName,
            task,
            readonly: routing.readonly,
            tools: routing.tools,
            mode: getModeDefinition().id,
            tier: "mid",
          },
          batchProfile,
        );
        return {
          task,
          tools: routing.tools,
          model: routing.model,
          systemPrompt: wp,
          cwd: ctx.cwd,
          agentName,
          sampling: routing.sampling,
          runId: runs[i].id,
          runtime: routing.runtime,
          runtimeArgs: routing.runtimeArgs,
          readonly: routing.readonly,
        };
      });

      const results = await runParallel(parallelTasks, concurrency, signal ?? undefined);

      const summaryLines: string[] = [`Batch ${batch.id}: ${tasks.length} tasks`, ""];
      let totalCost = 0;

      for (let i = 0; i < results.length; i++) {
        const { result: workerResult } = results[i];
        const run = runs[i];

        run.status = classifyRunStatus(workerResult);
        run.result = workerResult.result;
        run.error = workerResult.error;
        run.usage = workerResult.usage;
        run.model = workerResult.model ?? run.model;
        run.completedAt = new Date().toISOString();
        ledger?.update(run.id, run);
        batchTracker.markCompleted(batch.id, run.status === "done");
        totalCost += workerResult.usage.cost ?? 0;

        // Record outcome for provider health tracking.
        recordDispatchOutcome(run.model, workerResult.exitCode, workerResult.error);

        sharedBus.emit(BusChannel.RUN_FINISHED, {
          runId: run.id,
          agent: run.agent,
          status: run.status,
          usage: run.usage,
          runtime: run.runtime,
          startedAt: run.startedAt,
          completedAt: run.completedAt,
        });

        const statusStr = run.status === "done" ? "OK" : "FAIL";
        const batchCostVal = workerResult.usage.cost;
        const costStr = batchCostVal != null && batchCostVal > 0 ? ` $${batchCostVal.toFixed(4)}` : "";
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
    name: ToolName.DISPATCH_CHAIN,
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
      const defaultAgent = process.env.PANCODE_DEFAULT_AGENT ?? DEFAULT_AGENT;

      // Mode gating
      const mode = getModeDefinition();
      if (!mode.dispatchEnabled) {
        return textResult(`Chain dispatch is disabled in ${mode.name} mode. Switch to Build mode.`);
      }

      // In modes without mutations, verify all chain steps use readonly agents
      if (!mode.mutationsAllowed) {
        for (const step of params.steps) {
          const stepAgent = step.agent || defaultAgent;
          const spec = agentRegistry.get(stepAgent);
          if (spec && !spec.readonly) {
            return textResult(
              `Agent "${stepAgent}" is not readonly. ${mode.name} mode only allows readonly agents. Use reviewer.`,
            );
          }
        }
      }

      if (draining) {
        return textResult("Chain dispatch blocked: system is shutting down.");
      }

      // Recursion depth guard for chain dispatch
      const chainDepth = Number.parseInt(process.env.PANCODE_DISPATCH_DEPTH ?? "0", 10);
      const chainMaxDepth = Number.parseInt(process.env.PANCODE_DISPATCH_MAX_DEPTH ?? "2", 10);
      if (chainDepth >= chainMaxDepth) {
        return textResult(
          `Chain dispatch blocked: recursion depth ${chainDepth} exceeds maximum ${chainMaxDepth}. Complete the current task directly.`,
        );
      }

      // File path pre-validation for chain steps.
      for (const step of params.steps) {
        const chainPathCheck = validateTaskPaths(step.task, ctx.cwd);
        if (chainPathCheck.blocked) {
          return textResult(`Chain dispatch blocked: ${chainPathCheck.blockReason}`);
        }
        if (chainPathCheck.warnings.length > 0) {
          const warningText = chainPathCheck.warnings.join("; ");
          sharedBus.emit(BusChannel.WARNING, { source: "dispatch", message: `Path warnings: ${warningText}` });
        }
      }

      // Pre-flight
      let chainPreflightRouting: ReturnType<typeof resolveWorkerRouting>;
      try {
        chainPreflightRouting = resolveWorkerRouting(defaultAgent);
      } catch (err) {
        return textResult(err instanceof Error ? err.message : String(err));
      }
      const preflight = runPreFlightChecks({
        task: params.originalTask,
        agent: defaultAgent,
        model: chainPreflightRouting.model,
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

          // Per-step backoff check: the provider may have entered backoff during earlier chain steps.
          const stepProvider = extractProvider(routing.model);
          if (stepProvider && backoff.isBackedOff(stepProvider)) {
            const waitSec = Math.ceil(backoff.getWaitMs(stepProvider) / 1000);
            return {
              exitCode: 1,
              result: "",
              error: `Chain step throttled: provider "${stepProvider}" is backed off for ${waitSec}s due to repeated failures.`,
              usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, cost: 0, turns: 0 },
              model: routing.model,
            };
          }

          const run = createRunEnvelope(task, agent, ctx.cwd, undefined, routing.runtime);
          run.model = routing.model;
          run.status = "running";
          ledger?.add(run);
          sharedBus.emit(BusChannel.RUN_STARTED, {
            runId: run.id,
            task,
            agent,
            model: routing.model,
            runtime: routing.runtime,
          });

          // Compile dynamic worker prompt from PanPrompt engine.
          const chainSpec = agentRegistry.get(agent);
          const chainProfile = routing.model ? resolveModelProfile(routing.model) : null;
          const chainPrompt = compileWorkerPrompt(
            chainSpec ?? null,
            {
              agentName: agent,
              task,
              readonly: routing.readonly,
              tools: routing.tools,
              mode: getModeDefinition().id,
              tier: "mid",
            },
            chainProfile,
          );

          const result = await spawnWorker({
            task,
            tools: routing.tools,
            model: routing.model,
            systemPrompt: chainPrompt,
            cwd: ctx.cwd,
            agentName: agent,
            sampling: routing.sampling,
            signal: signal ?? undefined,
            runId: run.id,
            runtime: routing.runtime,
            runtimeArgs: routing.runtimeArgs,
            readonly: routing.readonly,
          });

          run.status = classifyRunStatus(result);
          run.result = result.result;
          run.error = result.error;
          run.usage = result.usage;
          run.model = result.model ?? run.model;
          run.completedAt = new Date().toISOString();
          ledger?.update(run.id, run);

          // Record outcome for provider health tracking.
          recordDispatchOutcome(run.model, result.exitCode, result.error);

          sharedBus.emit(BusChannel.RUN_FINISHED, {
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
        const stepCostVal = step.result.usage.cost;
        const costStr = stepCostVal != null && stepCostVal > 0 ? ` $${stepCostVal.toFixed(4)}` : "";
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

      // Kill the specific worker process for this run using the runId map.
      // Falls back to the legacy liveWorkerProcesses set if the map entry is missing.
      let killed = false;
      const targetProc = workerProcessByRunId.get(match.id);
      if (targetProc) {
        try {
          targetProc.kill("SIGTERM");
          killed = true;
          // Escalate to SIGKILL if SIGTERM does not terminate within 5s.
          setTimeout(() => {
            if (targetProc.exitCode === null) {
              try {
                targetProc.kill("SIGKILL");
              } catch {
                // ignore
              }
            }
          }, 5000).unref();
        } catch {
          // process already dead
        }
      } else {
        // Legacy fallback: kill first live process (best effort for untracked runs).
        for (const proc of liveWorkerProcesses) {
          try {
            proc.kill("SIGTERM");
            killed = true;
            break;
          } catch {
            // process already dead
          }
        }
      }

      match.status = "cancelled";
      match.completedAt = new Date().toISOString();
      if (!match.error) {
        match.error = "Cancelled by user via /stoprun";
      }
      ledger.update(match.id, match);

      sharedBus.emit(BusChannel.RUN_FINISHED, {
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
          customType: PanMessageType.PANEL,
          content: "Dispatch ledger not initialized.",
          display: true,
          details: { title: "PanCode Cost" },
        });
        return;
      }

      const allRuns = ledger.getAll();
      if (allRuns.length === 0) {
        pi.sendMessage({
          customType: PanMessageType.PANEL,
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
        const runCost = run.usage.cost ?? 0;
        totalCost += runCost;

        const agentStats = byAgent.get(run.agent) ?? { runs: 0, cost: 0 };
        agentStats.runs++;
        agentStats.cost += runCost;
        byAgent.set(run.agent, agentStats);

        const modelKey = run.model ?? "(unresolved)";
        const modelStats = byModel.get(modelKey) ?? { runs: 0, cost: 0 };
        modelStats.runs++;
        modelStats.cost += runCost;
        byModel.set(modelKey, modelStats);

        const runtimeKey = run.runtime ?? "pi";
        const runtimeStats = byRuntime.get(runtimeKey) ?? { runs: 0, cost: 0, hasCosts: false };
        runtimeStats.runs++;
        runtimeStats.cost += runCost;
        if (run.usage.cost != null && run.usage.cost > 0) runtimeStats.hasCosts = true;
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
        customType: PanMessageType.PANEL,
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
          customType: PanMessageType.PANEL,
          content: "Dispatch ledger not initialized.",
          display: true,
          details: { title: "PanCode Dispatch Insights" },
        });
        return;
      }

      const allRuns = ledger.getAll();
      if (allRuns.length === 0) {
        pi.sendMessage({
          customType: PanMessageType.PANEL,
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
        rtStats.cost += run.usage.cost ?? 0;
        rtStats.totalMs += dMs;
        if (run.usage.cost != null && run.usage.cost > 0) rtStats.hasCosts = true;
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
        customType: PanMessageType.PANEL,
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
          customType: PanMessageType.PANEL,
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
        const failStatuses = new Set(["error", "timeout", "cancelled", "interrupted", "budget_exceeded"]);
        for (const run of runs) {
          const runsCostVal = run.usage.cost;
          const costStr = runsCostVal != null && runsCostVal > 0 ? ` $${runsCostVal.toFixed(4)}` : "";
          const runtimeLabel = (run.runtime ?? "pi").padEnd(16);
          const truncatedTask = run.task.length > 50 ? `${run.task.slice(0, 47)}...` : run.task;
          lines.push(
            `[${run.id}] ${run.status.padEnd(9)} ${run.agent.padEnd(10)} ${runtimeLabel} ${truncatedTask}${costStr}`,
          );
          // Show error details on a dedicated line so they are visible at any terminal width.
          if (failStatuses.has(run.status) && run.error) {
            const truncErr = run.error.length > 80 ? `${run.error.slice(0, 77)}...` : run.error;
            lines.push(`           ERR: ${truncErr}`);
          }
        }
      }

      pi.sendMessage({
        customType: PanMessageType.PANEL,
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
          customType: PanMessageType.PANEL,
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
        customType: PanMessageType.PANEL,
        content: lines.join("\n"),
        display: true,
        details: { title: "PanCode Batches" },
      });
    },
  });

  // === Task tracking tools ===

  pi.registerTool({
    name: ToolName.TASK_WRITE,
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
    name: ToolName.TASK_CHECK,
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
    name: ToolName.TASK_UPDATE,
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
    name: ToolName.TASK_LIST,
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
