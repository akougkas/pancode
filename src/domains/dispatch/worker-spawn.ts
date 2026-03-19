import { type ChildProcess, spawn } from "node:child_process";
import { sharedBus } from "../../core/shared-bus";
import { runtimeRegistry } from "../../engine/runtimes/registry";
import type { AgentRuntime, RuntimeSamplingConfig, RuntimeTaskConfig, RuntimeUsage } from "../../engine/runtimes/types";

export interface WorkerResult {
  exitCode: number;
  result: string;
  error: string;
  usage: RuntimeUsage;
  model: string | null;
}

export const liveWorkerProcesses = new Set<ChildProcess>();

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
}

function emptyUsage(): RuntimeUsage {
  return { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, cost: 0, turns: 0 };
}

export function spawnWorker(options: SpawnOptions): Promise<WorkerResult> {
  const runtimeId = options.runtime ?? "pi";
  const runtime = runtimeRegistry.getOrThrow(runtimeId);

  const taskConfig: RuntimeTaskConfig = {
    task: options.task,
    tools: options.tools,
    model: options.model,
    systemPrompt: options.systemPrompt,
    cwd: options.cwd,
    agentName: options.agentName ?? "worker",
    readonly: options.readonly ?? false,
    runtimeArgs: options.runtimeArgs ?? [],
    timeoutMs: 0,
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

    if (spawnConfig.outputFormat === "ndjson") {
      // NDJSON runtimes stream structured events and update progress live.
      spawnWorkerNdjsonPath(proc, runtime, options, spawnConfig.resultFile ?? null, resolve);
    } else {
      // CLI runtimes: buffer stdout, parse on close
      spawnWorkerCliPath(proc, runtime, options, spawnConfig.resultFile ?? null, resolve);
    }

    if (options.signal) {
      const killProc = () => {
        proc.kill("SIGTERM");
        setTimeout(() => {
          if (!proc.killed) proc.kill("SIGKILL");
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
): void {
  const result: WorkerResult = {
    exitCode: 0,
    result: "",
    error: "",
    usage: emptyUsage(),
    model: null,
  };

  let buffer = "";
  let stderr = "";

  // Keep stdout streaming for live updates during execution
  interface WorkerMessageEvent {
    type: string;
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

  const processLine = (line: string) => {
    const trimmed = line.trim();
    if (!trimmed || (trimmed[0] !== "{" && trimmed[0] !== "[")) return;

    let event: WorkerMessageEvent;
    try {
      event = JSON.parse(trimmed) as WorkerMessageEvent;
    } catch {
      // Non-JSON output from worker subprocess (startup noise, warnings)
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

      result.usage.turns++;
      const usage = msg.usage;
      if (usage) {
        result.usage.inputTokens += usage.input ?? 0;
        result.usage.outputTokens += usage.output ?? 0;
        result.usage.cacheReadTokens += usage.cacheRead ?? 0;
        result.usage.cacheWriteTokens += usage.cacheWrite ?? 0;
        result.usage.cost += usage.cost?.total ?? 0;
      }

      // Emit live progress so the UI can display per-worker token counts
      // on active cards during execution.
      if (options.runId) {
        sharedBus.emit("pancode:worker-progress", {
          runId: options.runId,
          inputTokens: result.usage.inputTokens,
          outputTokens: result.usage.outputTokens,
          turns: result.usage.turns,
        });
      }

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

    const runtimeResult = runtime.parseResult("", stderr, result.exitCode, resultFile);
    if (runtimeResult.result) {
      result.result = runtimeResult.result;
    }
    if (runtimeResult.error && !result.error) {
      result.error = runtimeResult.error;
    }

    resolve(result);
  });

  proc.on("error", (err) => {
    liveWorkerProcesses.delete(proc);
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
    resolve({
      exitCode: runtimeResult.exitCode,
      result: runtimeResult.result,
      error: runtimeResult.error,
      usage: runtimeResult.usage,
      model: runtimeResult.model,
    });
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
