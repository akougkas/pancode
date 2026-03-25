import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { atomicWriteTextSync } from "../../core/config-writer";
import type { AgentRuntime, RuntimeResult, RuntimeTaskConfig, SpawnConfig } from "./types";

/** Threshold for writing system prompts to temp files instead of CLI args. */
const LONG_PROMPT_THRESHOLD = 8000;

/**
 * Write a system prompt to a temp file when it exceeds the threshold.
 * Returns the file path. The worker entry owns cleanup of its own temp files,
 * and these files are in the OS temp dir with a short TTL.
 */
let tempFileCounter = 0;

function writePromptTempFile(prefix: string, content: string): string {
  const dir = join(tmpdir(), "pancode-dispatch");
  mkdirSync(dir, { recursive: true });
  const filename = `${prefix}-${process.pid}-${Date.now()}-${tempFileCounter++}.txt`;
  const filepath = join(dir, filename);
  atomicWriteTextSync(filepath, content, { mode: 0o600 });
  return filepath;
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

/**
 * Pi SDK native runtime adapter.
 * Spawns Pi agent subprocesses using the vendored Pi SDK.
 * Always available (it is the built-in runtime).
 */
export class PiRuntime implements AgentRuntime {
  readonly id = "pi";
  readonly displayName = "Pi (native)";
  readonly tier = "native" as const;
  readonly telemetryTier = "platinum" as const;

  getVersion(): string | null {
    return "built-in";
  }

  isAvailable(): boolean {
    return true; // Pi SDK is always available (vendored)
  }

  buildSpawnConfig(config: RuntimeTaskConfig): SpawnConfig {
    const entryPath = resolveWorkerEntryPath();
    const runtimeRoot =
      process.env.PANCODE_RUNTIME_ROOT ?? join(process.env.PANCODE_PACKAGE_ROOT ?? process.cwd(), ".pancode", "state");
    const resultsDir =
      process.env.PANCODE_RESULTS_DIR ?? join(process.env.PANCODE_PACKAGE_ROOT ?? process.cwd(), ".pancode", "results");
    const runId = config.runId ?? randomUUID().slice(0, 8);
    const resultFile = join(resultsDir, `worker-${runId}.result.json`);

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

    // Pi CLI requires --provider and --model as separate args.
    // PanCode uses compound "provider/model-id" format internally.
    if (config.model) {
      const slashIdx = config.model.indexOf("/");
      if (slashIdx > 0) {
        args.push("--provider", config.model.slice(0, slashIdx));
        args.push("--model", config.model.slice(slashIdx + 1));
      } else {
        args.push("--model", config.model);
      }
    }

    // System prompt: use temp file for long prompts to avoid OS arg length
    // limits and prevent prompt content from appearing in process listings.
    if (config.systemPrompt.trim()) {
      if (config.systemPrompt.length > LONG_PROMPT_THRESHOLD) {
        const promptPath = writePromptTempFile("sys-prompt", config.systemPrompt);
        args.push("--system-prompt", `@${promptPath}`);
      } else {
        args.push("--system-prompt", config.systemPrompt);
      }
    }

    // Forward timeout to worker entry so it enforces a hard deadline on the pi subprocess.
    if (config.timeoutMs > 0) {
      args.push("--timeout-ms", String(config.timeoutMs));
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

    // Recursion depth guard: increment depth for child subprocess so nested
    // dispatch_agent calls can be blocked at the configured maximum depth.
    const currentDepth = Number.parseInt(process.env.PANCODE_DISPATCH_DEPTH ?? "0", 10);

    return {
      command: process.execPath,
      args,
      env: {
        ...samplingEnv,
        PANCODE_RUN_ID: runId,
        PANCODE_PARENT_PID: String(process.pid),
        PANCODE_SAFETY: process.env.PANCODE_SAFETY ?? "auto-edit",
        PANCODE_BOARD_FILE: join(runtimeRoot, "board.json"),
        PANCODE_CONTEXT_FILE: join(runtimeRoot, "context.json"),
        PANCODE_AGENT_NAME: config.agentName,
        PANCODE_DISPATCH_DEPTH: String(currentDepth + 1),
        PANCODE_DISPATCH_MAX_DEPTH: process.env.PANCODE_DISPATCH_MAX_DEPTH ?? "2",
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
