import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import type { RunUsage } from "./state";
import type { SamplingPreset } from "../providers";
import { sharedBus } from "../../core/shared-bus";

export interface WorkerResult {
  exitCode: number;
  result: string;
  error: string;
  usage: RunUsage;
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
  sampling?: SamplingPreset | null;
  signal?: AbortSignal;
  runId?: string;
}

function resolveWorkerEntryPath(): string {
  // In dev mode: src/worker/entry.ts (run via tsx)
  // In published mode: dist/worker/entry.js (pre-compiled)
  const packageRoot = process.env.PANCODE_PACKAGE_ROOT ?? process.cwd();

  // Check for compiled output first
  const distPath = join(packageRoot, "dist", "worker", "entry.js");
  if (existsSync(distPath)) return distPath;

  // Fall back to source (dev mode)
  return join(packageRoot, "src", "worker", "entry.ts");
}

function emptyUsage(): RunUsage {
  return { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, cost: 0, turns: 0 };
}

export function spawnWorker(options: SpawnOptions): Promise<WorkerResult> {
  const entryPath = resolveWorkerEntryPath();
  const runtimeRoot = process.env.PANCODE_RUNTIME_ROOT
    ?? join(process.env.PANCODE_PACKAGE_ROOT ?? process.cwd(), ".pancode", "runtime");
  const runId = randomUUID().slice(0, 8);
  const resultFile = join(runtimeRoot, `worker-${runId}.result.json`);

  const isDev = entryPath.endsWith(".ts");
  const workerArgs: string[] = [
    "--prompt", `Task: ${options.task}`,
    "--result-file", resultFile,
    "--tools", options.tools,
  ];
  const args: string[] = isDev
    ? ["--import", "tsx", entryPath, ...workerArgs]
    : [entryPath, ...workerArgs];

  if (options.model) {
    args.push("--model", options.model);
  }

  if (options.systemPrompt.trim()) {
    args.push("--system-prompt", options.systemPrompt);
  }

  // Ensure worker agent dir exists and has auth (set by loader.ts at boot)
  const pancodeHome = process.env.PANCODE_HOME!;
  const agentDir = join(pancodeHome, "agent-engine");

  // Pass sampling params via env vars so Pi SDK picks them up
  const samplingEnv: Record<string, string> = {};
  if (options.sampling) {
    samplingEnv.PANCODE_SAMPLING_TEMPERATURE = String(options.sampling.temperature);
    samplingEnv.PANCODE_SAMPLING_TOP_P = String(options.sampling.top_p);
    samplingEnv.PANCODE_SAMPLING_TOP_K = String(options.sampling.top_k);
    samplingEnv.PANCODE_SAMPLING_PRESENCE_PENALTY = String(options.sampling.presence_penalty);
  }

  return new Promise<WorkerResult>((resolve) => {
    const proc = spawn(process.execPath, args, {
      cwd: options.cwd,
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        ...samplingEnv,
        PANCODE_PARENT_PID: String(process.pid),
        PANCODE_SAFETY: process.env.PANCODE_SAFETY ?? "auto-edit",
        PANCODE_BOARD_FILE: join(runtimeRoot, "board.json"),
        PANCODE_CONTEXT_FILE: join(runtimeRoot, "context.json"),
        PANCODE_AGENT_NAME: options.agentName ?? "worker",
        PI_CODING_AGENT_DIR: process.env.PI_CODING_AGENT_DIR ?? agentDir,
        PI_SKIP_VERSION_CHECK: "1",
      },
    });

    liveWorkerProcesses.add(proc);

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
            .filter((part): part is { type: "text"; text: string } =>
              part?.type === "text" && typeof part.text === "string")
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

    proc.stdout!.on("data", (data: Buffer) => {
      buffer += data.toString();
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";
      for (const line of lines) processLine(line);
    });

    proc.stderr!.on("data", (data: Buffer) => {
      stderr += data.toString();
    });

    proc.on("close", (code) => {
      liveWorkerProcesses.delete(proc);
      if (buffer.trim()) processLine(buffer);
      result.exitCode = code ?? 0;

      // Use the result file as the authoritative final result if available
      if (existsSync(resultFile)) {
        try {
          const resultData = JSON.parse(readFileSync(resultFile, "utf8"));
          if (typeof resultData.assistantText === "string" && resultData.assistantText) {
            result.result = resultData.assistantText;
          }
          if (typeof resultData.assistantError === "string" && resultData.assistantError) {
            result.error = resultData.assistantError;
          }
        } catch {
          // Fall back to stdout-parsed result if result file is malformed
        }
      }

      if (result.exitCode !== 0 && !result.error) {
        result.error = stderr.trim()
          ? `Worker exited with code ${result.exitCode}: ${stderr.trim().slice(0, 500)}`
          : `Worker exited with code ${result.exitCode}`;
      }
      resolve(result);
    });

    proc.on("error", (err) => {
      liveWorkerProcesses.delete(proc);
      result.exitCode = 1;
      result.error = err.message;
      resolve(result);
    });

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
