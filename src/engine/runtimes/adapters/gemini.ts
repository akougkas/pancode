import { CliRuntime } from "../cli-base";
import type { RuntimeResult, RuntimeTaskConfig, SpawnConfig } from "../types";

// ---------------------------------------------------------------------------
// Gemini CLI JSON response types
// ---------------------------------------------------------------------------

/**
 * Gemini CLI JSON response (--output-format json).
 *
 * Structure:
 * ```json
 * {
 *   "response": "Assistant text...",
 *   "stats": {
 *     "model_name": { "api_calls": N, "input_tokens": N, "output_tokens": N, "total_tokens": N },
 *     "tool_execution": { "calls": N, "failures": N }
 *   }
 * }
 * ```
 */
interface GeminiJsonResponse {
  response?: string;
  stats?: {
    [model: string]: GeminiModelStats | GeminiToolStats;
  };
}

interface GeminiModelStats {
  api_calls?: number;
  input_tokens?: number;
  output_tokens?: number;
  total_tokens?: number;
}

interface GeminiToolStats {
  calls?: number;
  failures?: number;
}

function isModelStats(value: unknown): value is GeminiModelStats {
  if (!value || typeof value !== "object") return false;
  const obj = value as Record<string, unknown>;
  return "input_tokens" in obj || "output_tokens" in obj || "api_calls" in obj;
}

// ---------------------------------------------------------------------------
// Runtime adapter
// ---------------------------------------------------------------------------

/**
 * Gemini CLI runtime adapter (Silver Tier).
 *
 * Invocation: gemini -p "task" --output-format json --model <model>
 *
 * Silver tier: structured JSON output with token tracking per model. System
 * prompt injected via GEMINI_SYSTEM_MD environment variable. Tool bypass
 * via --allowed-tools for selective auto-approval.
 *
 * Features:
 * - --output-format json for structured response with stats
 * - --model for model selection (aliases or concrete names)
 * - --yolo for write-capable agents (auto-approves all tool calls)
 * - --allowed-tools for selective tool auto-approval (read-only agents)
 * - System prompt via GEMINI_SYSTEM_MD environment variable
 * - Token tracking from stats object (per-model aggregation)
 * - --sandbox for containerized tool execution
 */
/**
 * Map PanCode tool names to Gemini CLI tool names.
 * Gemini CLI uses PascalCase tool names with ShellTool for bash commands.
 */
const GEMINI_TOOL_MAP: Record<string, string> = {
  read: "ReadFile",
  write: "WriteFile",
  edit: "EditFile",
  bash: "ShellTool",
  grep: "SearchFile",
  find: "ListDirectory",
  ls: "ListDirectory",
};

export class GeminiRuntime extends CliRuntime {
  readonly id = "cli:gemini";
  readonly displayName = "Gemini CLI";
  override readonly telemetryTier = "silver" as const;
  readonly binaryName = "gemini";

  buildCliArgs(config: RuntimeTaskConfig): string[] {
    // Build the task message. Gemini CLI does not have a --system-prompt flag.
    // System prompt is injected via GEMINI_SYSTEM_MD env var in buildSpawnConfig().
    // Prepend to task as fallback context when env var is not supported.
    let message = config.task;
    if (config.systemPrompt.trim()) {
      message = `[System Instructions]\n${config.systemPrompt.trim()}\n\n[Task]\n${config.task}`;
    }

    const args = ["-p", message, "--output-format", "json"];

    // Model selection
    if (config.model) {
      args.push("--model", config.model);
    }

    if (config.readonly) {
      // Read-only agents: restrict to read-oriented tools.
      args.push(
        "--allowed-tools",
        "ReadFile,ListDirectory,SearchFile,ShellTool(git status),ShellTool(git diff),ShellTool(git log)",
      );
    } else if (config.tools) {
      // Map PanCode tool names to Gemini CLI tool names from config.tools.
      const mapped = config.tools
        .split(",")
        .map((t) => GEMINI_TOOL_MAP[t.trim()])
        .filter(Boolean);
      const deduped = [...new Set(mapped)].join(",");
      if (deduped) {
        args.push("--allowed-tools", deduped);
      } else {
        args.push("--yolo");
      }
    } else {
      args.push("--yolo");
    }

    // Sandbox for mutable agents: containerized tool execution prevents
    // destructive actions from escaping isolation. Skip if user explicitly
    // controls sandbox behavior via runtimeArgs.
    if (!config.readonly && !config.runtimeArgs.includes("--sandbox") && !config.runtimeArgs.includes("--no-sandbox")) {
      args.push("--sandbox");
    }

    // Gemini CLI does not support a --timeout flag. The cli-entry.ts wrapper
    // provides a process-level kill timer as the fallback timeout mechanism.

    // Pass through any extra runtime args from agent spec
    args.push(...config.runtimeArgs);

    return args;
  }

  buildSpawnConfig(config: RuntimeTaskConfig): SpawnConfig {
    const env: Record<string, string> = {};

    // Inject system prompt via GEMINI_SYSTEM_MD environment variable.
    // Gemini CLI reads this to set system instructions for the session.
    if (config.systemPrompt.trim()) {
      env.GEMINI_SYSTEM_MD = config.systemPrompt.trim();
    }

    // Enable sandbox mode via environment variable for mutable agents.
    if (!config.readonly) {
      env.GEMINI_SANDBOX = "true";
    }

    return this.buildCliSpawnConfig(config, { env, outputFormat: "json" });
  }

  parseResult(stdout: string, stderr: string, exitCode: number, _resultFile: string | null): RuntimeResult {
    const parsed = this.extractJson(stdout);

    if (!parsed) {
      // JSON extraction failed. Fall back to plain text.
      return {
        exitCode,
        result: stdout.trim(),
        error: exitCode !== 0 ? stderr.trim() || `Gemini CLI exited with code ${exitCode}` : "",
        usage: {
          inputTokens: null,
          outputTokens: null,
          cacheReadTokens: null,
          cacheWriteTokens: null,
          cost: null,
          turns: null,
        },
        model: null,
        runtime: this.id,
      };
    }

    // Aggregate token usage across all model entries in stats.
    let totalInputTokens = 0;
    let totalOutputTokens = 0;
    let totalTurns = 0;
    let detectedModel: string | null = null;

    if (parsed.stats) {
      for (const [key, value] of Object.entries(parsed.stats)) {
        if (key === "tool_execution") continue;
        if (isModelStats(value)) {
          totalInputTokens += value.input_tokens ?? 0;
          totalOutputTokens += value.output_tokens ?? 0;
          totalTurns += value.api_calls ?? 0;
          if (!detectedModel) detectedModel = key;
        }
      }
    }

    const error = exitCode !== 0 ? stderr.trim() || `Gemini CLI exited with code ${exitCode}` : "";

    return {
      exitCode,
      result: typeof parsed.response === "string" ? parsed.response : stdout.trim(),
      error,
      usage: {
        inputTokens: totalInputTokens,
        outputTokens: totalOutputTokens,
        cacheReadTokens: null, // Gemini CLI does not report cache tokens
        cacheWriteTokens: null,
        cost: null, // Gemini CLI does not report cost
        turns: totalTurns,
      },
      model: detectedModel,
      runtime: this.id,
    };
  }

  /**
   * Extract the JSON response from stdout.
   * Handles noise before/after the JSON payload.
   */
  private extractJson(stdout: string): GeminiJsonResponse | null {
    const trimmed = stdout.trim();
    if (!trimmed) return null;

    // Fast path: entire output is a JSON object
    if (trimmed[0] === "{") {
      try {
        return JSON.parse(trimmed) as GeminiJsonResponse;
      } catch {
        // May have trailing text; try brace matching below.
      }
    }

    // Slow path: find the JSON object within surrounding noise
    const start = trimmed.indexOf("{");
    if (start === -1) return null;

    try {
      return JSON.parse(trimmed.slice(start)) as GeminiJsonResponse;
    } catch {
      // Fall through
    }

    const end = trimmed.lastIndexOf("}");
    if (end > start) {
      try {
        return JSON.parse(trimmed.slice(start, end + 1)) as GeminiJsonResponse;
      } catch {
        return null;
      }
    }

    return null;
  }
}
