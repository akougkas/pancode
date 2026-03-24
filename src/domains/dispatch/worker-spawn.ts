import { type ChildProcess, spawn } from "node:child_process";
import { BusChannel, type WorkerProgressEvent } from "../../core/bus-events";
import { sharedBus } from "../../core/shared-bus";
import { runtimeRegistry } from "../../engine/runtimes/registry";
import type { AgentRuntime, RuntimeSamplingConfig, RuntimeTaskConfig, RuntimeUsage } from "../../engine/runtimes/types";
import { healthMonitor } from "./health";

export interface WorkerResult {
  exitCode: number;
  result: string;
  error: string;
  usage: RuntimeUsage;
  model: string | null;
  /** Set when the worker was killed because it exceeded its timeout. */
  timedOut?: boolean;
  /** Set when the worker was killed because it exceeded its per-run budget. */
  budgetExceeded?: boolean;
}

export const liveWorkerProcesses = new Set<ChildProcess>();

/** Map runId to its subprocess for targeted cancellation via /stoprun. */
export const workerProcessByRunId = new Map<string, ChildProcess>();

export async function stopAllWorkers(): Promise<void> {
  const active = Array.from(liveWorkerProcesses);
  if (active.length === 0) return;

  for (const proc of active) {
    try {
      proc.kill("SIGTERM");
    } catch {
      // ignore
    }
  }

  await Promise.all(
    active.map(
      (proc) =>
        new Promise<void>((resolve) => {
          const timer = setTimeout(resolve, 3000);
          proc.once("exit", () => {
            clearTimeout(timer);
            resolve();
          });
        }),
    ),
  );

  for (const proc of active) {
    if (proc.exitCode === null) {
      try {
        proc.kill("SIGKILL");
      } catch {
        // ignore
      }
    }
  }

  liveWorkerProcesses.clear();
}

/** Default worker timeout: 5 minutes. Override with PANCODE_WORKER_TIMEOUT_MS env var. */
const DEFAULT_TIMEOUT_MS = 300_000;

interface SpawnOptions {
  task: string;
  tools: string;
  model: string | null;
  systemPrompt: string;
  cwd: string;
  agentName?: string;
  sampling?: RuntimeSamplingConfig | null;
  signal?: AbortSignal;
  runId?: string;
  runtime?: string; // Runtime ID, default "pi"
  runtimeArgs?: string[]; // Extra args for the runtime
  readonly?: boolean; // Agent readonly flag
  timeoutMs?: number; // Per-task timeout in milliseconds (0 = no timeout)
}

/** Usage with all null fields (nothing reported). Used for error fallbacks. */
function emptyUsage(): RuntimeUsage {
  return {
    inputTokens: null,
    outputTokens: null,
    cacheReadTokens: null,
    cacheWriteTokens: null,
    cost: null,
    turns: null,
  };
}

/** Usage with all zero fields. Used for Pi NDJSON path accumulation. */
function zeroUsage(): RuntimeUsage {
  return { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, cost: 0, turns: 0 };
}

export function spawnWorker(options: SpawnOptions): Promise<WorkerResult> {
  const runtimeId = options.runtime ?? "pi";
  const runtime = runtimeRegistry.getOrThrow(runtimeId);

  const envTimeout = Number.parseInt(process.env.PANCODE_WORKER_TIMEOUT_MS ?? "", 10);
  const resolvedTimeout = options.timeoutMs ?? (Number.isFinite(envTimeout) ? envTimeout : DEFAULT_TIMEOUT_MS);

  // Strip "provider/" prefix for CLI runtimes.
  // Claude Code expects bare model names or aliases, not compound "provider/model" format.
  let resolvedModel = options.model;
  if (runtimeId.startsWith("cli:") && resolvedModel?.includes("/")) {
    resolvedModel = resolvedModel.slice(resolvedModel.indexOf("/") + 1);
  }

  const taskConfig: RuntimeTaskConfig = {
    task: options.task,
    tools: options.tools,
    model: resolvedModel,
    systemPrompt: options.systemPrompt,
    cwd: options.cwd,
    agentName: options.agentName ?? "worker",
    readonly: options.readonly ?? false,
    runtimeArgs: options.runtimeArgs ?? [],
    timeoutMs: resolvedTimeout,
    sampling: options.sampling ?? null,
    runId: options.runId,
  };
  const spawnConfig = runtime.buildSpawnConfig(taskConfig);

  return new Promise<WorkerResult>((resolve) => {
    const proc = spawn(spawnConfig.command, spawnConfig.args, {
      cwd: spawnConfig.cwd,
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        ...spawnConfig.env,
      },
    });

    liveWorkerProcesses.add(proc);

    // Track runId→process for targeted cancellation via /stoprun.
    if (options.runId) {
      workerProcessByRunId.set(options.runId, proc);
    }

    // Mutable kill-reason state shared between timeout/budget/close handlers.
    const killState = { timedOut: false, budgetExceeded: false };

    // Per-run budget cap from PANCODE_PER_RUN_BUDGET env var.
    const perRunBudgetEnv = Number.parseFloat(process.env.PANCODE_PER_RUN_BUDGET ?? "");
    const perRunBudget = Number.isFinite(perRunBudgetEnv) && perRunBudgetEnv > 0 ? perRunBudgetEnv : null;

    if (spawnConfig.outputFormat === "ndjson") {
      // NDJSON runtimes stream structured events and update progress live.
      spawnWorkerNdjsonPath(proc, runtime, options, spawnConfig.resultFile ?? null, resolve, killState, perRunBudget);
    } else {
      // CLI runtimes: buffer stdout, parse on close
      spawnWorkerCliPath(proc, runtime, options, spawnConfig.resultFile ?? null, resolve, killState);
    }

    // Timeout enforcement: kill the process if it exceeds the configured timeout.
    // A timeout of 0 means no timeout.
    let timeoutTimer: NodeJS.Timeout | null = null;
    if (resolvedTimeout > 0) {
      timeoutTimer = setTimeout(() => {
        killState.timedOut = true;
        try {
          proc.kill("SIGTERM");
        } catch {
          // process may already be dead
        }
        // Escalate to SIGKILL if SIGTERM does not terminate within 5s.
        setTimeout(() => {
          if (proc.exitCode === null) {
            try {
              proc.kill("SIGKILL");
            } catch {
              // ignore
            }
          }
        }, 5000);
      }, resolvedTimeout);
      timeoutTimer.unref();
    }

    // Clean up timeout timer when process exits naturally.
    proc.once("exit", () => {
      if (timeoutTimer) clearTimeout(timeoutTimer);
      if (options.runId) workerProcessByRunId.delete(options.runId);
    });

    if (options.signal) {
      const killProc = () => {
        try {
          proc.kill("SIGTERM");
        } catch {
          // process may already be dead
        }
        setTimeout(() => {
          if (proc.exitCode === null) {
            try {
              proc.kill("SIGKILL");
            } catch {
              // ignore
            }
          }
        }, 5000);
      };
      if (options.signal.aborted) killProc();
      else options.signal.addEventListener("abort", killProc, { once: true });
    }
  });
}

/**
 * Pi runtime spawn path: streaming NDJSON parse with live progress events.
 * Preserves identical behavior to the original spawnWorker implementation.
 */
function spawnWorkerNdjsonPath(
  proc: ChildProcess,
  runtime: AgentRuntime,
  options: SpawnOptions,
  resultFile: string | null,
  resolve: (value: WorkerResult) => void,
  killState: { timedOut: boolean; budgetExceeded: boolean },
  perRunBudget: number | null,
): void {
  // Pi runtime always reports all usage fields. Use zero-initialized accumulators
  // so += works without null-checking, then assign to result.usage at the end.
  let accInputTokens = 0;
  let accOutputTokens = 0;
  let accCacheRead = 0;
  let accCacheWrite = 0;
  let accCost = 0;
  let accTurns = 0;

  const result: WorkerResult = {
    exitCode: 0,
    result: "",
    error: "",
    usage: zeroUsage(),
    model: null,
  };

  let buffer = "";
  let stderr = "";

  // Tool-level progress tracking
  const MAX_RECENT_TOOLS = 5;
  const MAX_TOOL_ARGS_PREVIEW = 120;
  let currentTool: string | null = null;
  let currentToolArgs: string | null = null;
  const recentTools: string[] = [];
  let toolCount = 0;

  // Keep stdout streaming for live updates during execution
  interface WorkerNdjsonEvent {
    type: string;
    /** Pi CLI emits toolName at the top level for tool_execution_start/end events. */
    toolName?: string;
    args?: Record<string, unknown>;
    message?: {
      role?: string;
      content?: Array<{ type?: string; text?: string }>;
      usage?: {
        input?: number;
        output?: number;
        cacheRead?: number;
        cacheWrite?: number;
        cost?: { total?: number };
      };
      model?: string;
      stopReason?: string;
      errorMessage?: string;
    };
  }

  /** Emit a progress update to the bus with tool-level detail. Throttled to 50ms. */
  let lastProgressEmit = 0;
  const emitProgress = (force?: boolean) => {
    if (!options.runId) return;
    const now = Date.now();
    if (!force && now - lastProgressEmit < 50) return;
    lastProgressEmit = now;

    const progress: WorkerProgressEvent = {
      runId: options.runId,
      inputTokens: accInputTokens,
      outputTokens: accOutputTokens,
      turns: accTurns,
      currentTool,
      currentToolArgs,
      recentTools: [...recentTools],
      toolCount,
    };
    sharedBus.emit(BusChannel.WORKER_PROGRESS, progress);
  };

  const processLine = (line: string) => {
    const trimmed = line.trim();
    if (!trimmed || (trimmed[0] !== "{" && trimmed[0] !== "[")) return;

    let event: WorkerNdjsonEvent;
    try {
      event = JSON.parse(trimmed) as WorkerNdjsonEvent;
    } catch {
      // Non-JSON output from worker subprocess (startup noise, warnings)
      return;
    }

    // Heartbeat events from worker entry.ts: feed to health monitor.
    if (event.type === "heartbeat") {
      const raw = event as unknown as Record<string, unknown>;
      const heartbeatRunId = (raw.runId as string | undefined) ?? options.runId ?? "";
      if (heartbeatRunId) {
        healthMonitor.recordHeartbeat(heartbeatRunId);
      }
      sharedBus.emit(BusChannel.WORKER_HEARTBEAT, {
        runId: heartbeatRunId,
        ts: (raw.ts as string) ?? new Date().toISOString(),
        turns: (raw.turns as number) ?? 0,
        lastToolCall: (raw.lastToolCall as string | null) ?? null,
        tokensThisBeat: (raw.tokensThisBeat as { in: number; out: number }) ?? { in: 0, out: 0 },
      });
      return;
    }

    // Lifecycle events from worker entry.ts: informational, logged if verbose.
    if (event.type === "lifecycle") {
      if (process.env.PANCODE_VERBOSE) {
        const raw = event as unknown as Record<string, unknown>;
        console.error(`[pancode:dispatch] lifecycle: ${raw.event} runId=${raw.runId}`);
      }
      return;
    }

    // Tool execution tracking: parse start/end events for live progress display
    if (event.type === "tool_execution_start") {
      const toolName = event.toolName ?? "unknown";
      currentTool = toolName;
      // Build a truncated args preview for display
      if (event.args) {
        try {
          const argsStr = JSON.stringify(event.args);
          currentToolArgs =
            argsStr.length > MAX_TOOL_ARGS_PREVIEW ? `${argsStr.slice(0, MAX_TOOL_ARGS_PREVIEW)}...` : argsStr;
        } catch {
          currentToolArgs = null;
        }
      } else {
        currentToolArgs = null;
      }
      toolCount++;
      emitProgress();
      return;
    }

    if (event.type === "tool_execution_end") {
      // Rotate completed tool into recent ring buffer
      if (currentTool) {
        recentTools.push(currentTool);
        if (recentTools.length > MAX_RECENT_TOOLS) {
          recentTools.shift();
        }
      }
      currentTool = null;
      currentToolArgs = null;
      emitProgress();
      return;
    }

    if (event.type !== "message_end" || !event.message) return;
    const msg = event.message;

    if (msg.role === "assistant") {
      if (Array.isArray(msg.content)) {
        const textParts = msg.content
          .filter(
            (part): part is { type: "text"; text: string } => part?.type === "text" && typeof part.text === "string",
          )
          .map((part) => part.text);
        if (textParts.length > 0) {
          result.result = textParts.join("");
        }
      }

      accTurns++;
      const usage = msg.usage;
      if (usage) {
        accInputTokens += usage.input ?? 0;
        accOutputTokens += usage.output ?? 0;
        accCacheRead += usage.cacheRead ?? 0;
        accCacheWrite += usage.cacheWrite ?? 0;
        accCost += usage.cost?.total ?? 0;
      }

      // Per-run budget cap: kill the worker if accumulated cost exceeds the cap.
      if (perRunBudget !== null && accCost > perRunBudget && !killState.budgetExceeded) {
        killState.budgetExceeded = true;
        try {
          proc.kill("SIGTERM");
        } catch {
          // process may already be dead
        }
        setTimeout(() => {
          if (proc.exitCode === null) {
            try {
              proc.kill("SIGKILL");
            } catch {
              // ignore
            }
          }
        }, 5000).unref();
      }

      // Emit live progress with full context including tool tracking.
      emitProgress(true);

      if (!result.model && msg.model) {
        result.model = msg.model;
      }

      if (msg.stopReason === "error" && typeof msg.errorMessage === "string") {
        result.error = msg.errorMessage;
      }
    }
  };

  proc.stdout?.on("data", (data: Buffer) => {
    buffer += data.toString();
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";
    for (const line of lines) processLine(line);
  });

  proc.stderr?.on("data", (data: Buffer) => {
    stderr += data.toString();
  });

  proc.on("close", (code) => {
    liveWorkerProcesses.delete(proc);
    if (buffer.trim()) processLine(buffer);
    result.exitCode = code ?? 0;

    // Record process exit in health monitor so it transitions to "dead".
    if (options.runId) {
      healthMonitor.recordProcessExit(options.runId);
    }

    // Write accumulated usage to result before resolving.
    result.usage = {
      inputTokens: accInputTokens,
      outputTokens: accOutputTokens,
      cacheReadTokens: accCacheRead,
      cacheWriteTokens: accCacheWrite,
      cost: accCost,
      turns: accTurns,
    };

    // Emit a final progress event so the TUI clears any stale "tool running" state.
    // The 50ms throttle could swallow the last tool_execution_end event.
    currentTool = null;
    currentToolArgs = null;
    emitProgress(true);

    const runtimeResult = runtime.parseResult("", stderr, result.exitCode, resultFile);
    if (runtimeResult.result) {
      result.result = runtimeResult.result;
    }
    if (runtimeResult.error && !result.error) {
      result.error = runtimeResult.error;
    }

    // Mark timeout and budget-exceeded kill reasons on the result.
    if (killState.timedOut) {
      result.timedOut = true;
      result.exitCode = 1;
      if (!result.error) {
        result.error = "Worker killed: timeout exceeded";
      }
    }
    if (killState.budgetExceeded) {
      result.budgetExceeded = true;
      result.exitCode = 1;
      if (!result.error) {
        result.error = "Worker killed: per-run budget exceeded";
      }
    }

    // Empty result detection: an agent that exits successfully but produces
    // no output has effectively failed. Mark it clearly so /runs does not
    // report "success with empty result."
    if (result.exitCode === 0 && !result.error && !result.result.trim()) {
      result.exitCode = 1;
      result.error = "Worker produced empty result";
    }

    resolve(result);
  });

  proc.on("error", (err) => {
    liveWorkerProcesses.delete(proc);
    if (options.runId) {
      healthMonitor.recordProcessExit(options.runId);
    }
    result.exitCode = 1;
    result.error = err.message;
    resolve(result);
  });
}

/**
 * CLI runtime spawn path: buffer stdout, parse on close.
 * CLI runtimes complete and return; no streaming progress events.
 */
function spawnWorkerCliPath(
  proc: ChildProcess,
  runtime: AgentRuntime,
  _options: SpawnOptions,
  resultFile: string | null,
  resolve: (value: WorkerResult) => void,
  killState: { timedOut: boolean; budgetExceeded: boolean },
): void {
  let stdout = "";
  let stderr = "";

  proc.stdout?.on("data", (data: Buffer) => {
    stdout += data.toString();
  });

  proc.stderr?.on("data", (data: Buffer) => {
    stderr += data.toString();
  });

  proc.on("close", (code) => {
    liveWorkerProcesses.delete(proc);
    const runtimeResult = runtime.parseResult(stdout, stderr, code ?? 0, resultFile);

    const result: WorkerResult = {
      exitCode: runtimeResult.exitCode,
      result: runtimeResult.result,
      error: runtimeResult.error,
      usage: runtimeResult.usage,
      model: runtimeResult.model,
    };

    // Mark timeout and budget-exceeded kill reasons on the result.
    if (killState.timedOut) {
      result.timedOut = true;
      result.exitCode = 1;
      if (!result.error) {
        result.error = "Worker killed: timeout exceeded";
      }
    }
    if (killState.budgetExceeded) {
      result.budgetExceeded = true;
      result.exitCode = 1;
      if (!result.error) {
        result.error = "Worker killed: per-run budget exceeded";
      }
    }

    // Empty result detection for CLI runtimes.
    if (result.exitCode === 0 && !result.error && !result.result.trim()) {
      result.exitCode = 1;
      result.error = "Worker produced empty result";
    }

    resolve(result);
  });

  proc.on("error", (err) => {
    liveWorkerProcesses.delete(proc);
    resolve({
      exitCode: 1,
      result: "",
      error: err.message,
      usage: emptyUsage(),
      model: null,
    });
  });
}
