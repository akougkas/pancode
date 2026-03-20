import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { AgentRuntime, RuntimeResult, RuntimeTaskConfig, SpawnConfig } from "./types";

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

/**
 * Pi SDK native runtime adapter.
 * Spawns Pi agent subprocesses using the vendored Pi SDK.
 * Always available (it is the built-in runtime).
 */
export class PiRuntime implements AgentRuntime {
  readonly id = "pi";
  readonly displayName = "Pi (native)";
  readonly tier = "native" as const;

  isAvailable(): boolean {
    return true; // Pi SDK is always available (vendored)
  }

  buildSpawnConfig(config: RuntimeTaskConfig): SpawnConfig {
    const entryPath = resolveWorkerEntryPath();
    const runtimeRoot =
      process.env.PANCODE_RUNTIME_ROOT ??
      join(process.env.PANCODE_PACKAGE_ROOT ?? process.cwd(), ".pancode", "runtime");
    const runId = config.runId ?? randomUUID().slice(0, 8);
    const resultFile = join(runtimeRoot, `worker-${runId}.result.json`);

    const isDev = entryPath.endsWith(".ts");
    const workerArgs: string[] = [
      "--prompt",
      `Task: ${config.task}`,
      "--result-file",
      resultFile,
      "--tools",
      config.tools,
    ];
    const args: string[] = isDev ? ["--import", "tsx", entryPath, ...workerArgs] : [entryPath, ...workerArgs];

    if (config.model) {
      args.push("--model", config.model);
    }

    if (config.systemPrompt.trim()) {
      args.push("--system-prompt", config.systemPrompt);
    }

    // Ensure worker agent dir exists and has auth (set by loader.ts at boot)
    const pancakeHome = process.env.PANCODE_HOME;
    if (!pancakeHome) {
      throw new Error("PANCODE_HOME must be set before spawning Pi workers");
    }
    const agentDir = join(pancakeHome, "agent-engine");

    // Pass sampling params via env vars so Pi SDK picks them up
    const samplingEnv: Record<string, string> = {};
    if (config.sampling) {
      samplingEnv.PANCODE_SAMPLING_TEMPERATURE = String(config.sampling.temperature);
      samplingEnv.PANCODE_SAMPLING_TOP_P = String(config.sampling.top_p);
      samplingEnv.PANCODE_SAMPLING_TOP_K = String(config.sampling.top_k);
      samplingEnv.PANCODE_SAMPLING_PRESENCE_PENALTY = String(config.sampling.presence_penalty);
    }

    return {
      command: process.execPath,
      args,
      env: {
        ...samplingEnv,
        PANCODE_PARENT_PID: String(process.pid),
        PANCODE_SAFETY: process.env.PANCODE_SAFETY ?? "auto-edit",
        PANCODE_BOARD_FILE: join(runtimeRoot, "board.json"),
        PANCODE_CONTEXT_FILE: join(runtimeRoot, "context.json"),
        PANCODE_AGENT_NAME: config.agentName,
        PI_CODING_AGENT_DIR: process.env.PI_CODING_AGENT_DIR ?? agentDir,
        PI_SKIP_VERSION_CHECK: "1",
      },
      cwd: config.cwd,
      resultFile,
      outputFormat: "ndjson",
    };
  }

  /**
   * Parse the final result from a Pi runtime execution.
   * Called after NDJSON streaming has already updated the live result object.
   * This handles the result file reading (authoritative final output).
   */
  parseResult(stdout: string, stderr: string, exitCode: number, resultFile: string | null): RuntimeResult {
    const result: RuntimeResult = {
      exitCode,
      result: "",
      error: "",
      usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, cost: 0, turns: 0 },
      model: null,
      runtime: this.id,
    };

    // Use the result file as the authoritative final result if available
    if (resultFile && existsSync(resultFile)) {
      try {
        const resultData = JSON.parse(readFileSync(resultFile, "utf8"));
        if (typeof resultData.assistantText === "string" && resultData.assistantText) {
          result.result = resultData.assistantText;
        }
        if (typeof resultData.assistantError === "string" && resultData.assistantError) {
          result.error = resultData.assistantError;
        }
        if (resultData.usage && typeof resultData.usage === "object") {
          const u = resultData.usage;
          result.usage = {
            inputTokens: u.inputTokens ?? 0,
            outputTokens: u.outputTokens ?? 0,
            cacheReadTokens: u.cacheReadTokens ?? 0,
            cacheWriteTokens: u.cacheWriteTokens ?? 0,
            cost: u.cost ?? 0,
            turns: u.turns ?? 0,
          };
        }
      } catch {
        // Fall back to stdout-parsed result if result file is malformed
      }
    }

    if (exitCode !== 0 && !result.error) {
      result.error = stderr.trim()
        ? `Worker exited with code ${exitCode}: ${stderr.trim().slice(0, 500)}`
        : `Worker exited with code ${exitCode}`;
    }

    return result;
  }
}
