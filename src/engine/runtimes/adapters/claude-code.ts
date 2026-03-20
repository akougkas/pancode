import { CliRuntime } from "../cli-base";
import type { RuntimeResult, RuntimeTaskConfig, SpawnConfig } from "../types";

// ---------------------------------------------------------------------------
// Claude Code JSON response types
// ---------------------------------------------------------------------------

/**
 * Structured JSON response from Claude Code (--output-format json).
 *
 * Example:
 * ```json
 * {
 *   "result": "Done. Created 3 files.",
 *   "session_id": "abc123",
 *   "cost_usd": 0.03,
 *   "usage": { "input_tokens": 1200, "output_tokens": 400 },
 *   "model": "claude-sonnet-4-20250514",
 *   "num_turns": 2
 * }
 * ```
 */
interface ClaudeCodeJsonResponse {
  result?: string;
  session_id?: string;
  cost_usd?: number;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    cache_read_tokens?: number;
    cache_write_tokens?: number;
  };
  model?: string;
  num_turns?: number;
  error?: string;
  is_error?: boolean;
}

// ---------------------------------------------------------------------------
// Runtime adapter
// ---------------------------------------------------------------------------

/**
 * Claude Code CLI runtime adapter (Gold Tier).
 *
 * Invocation: claude -p "task" --output-format json --allowedTools "..."
 *
 * Gold tier: fully structured JSON output with reliable extraction of tokens,
 * cost, model, turns, and session ID. Robust JSON parsing handles subprocess
 * wrapper noise and multi-line output.
 *
 * Features:
 * - Tool restriction via --allowedTools
 * - JSON output for structured parsing
 * - System prompt override via --system-prompt
 * - Session continuity via --resume (not used in dispatch, each task is fresh)
 * - Full usage tracking: input/output tokens, cache tokens, cost, turns
 */
export class ClaudeCodeRuntime extends CliRuntime {
  readonly id = "cli:claude-code";
  readonly displayName = "Claude Code";
  readonly binaryName = "claude";

  buildCliArgs(config: RuntimeTaskConfig): string[] {
    const args = ["-p", config.task, "--output-format", "json"];

    // Map PanCode tool CSV to Claude Code --allowedTools format
    if (config.tools && config.readonly) {
      // Read-only agents get restricted tools
      args.push("--allowedTools", "Read,Grep,Glob");
    } else if (config.tools) {
      // Map PanCode tool names to Claude Code tool names
      const toolMap: Record<string, string> = {
        read: "Read",
        write: "Write",
        edit: "Edit",
        bash: "Bash",
        grep: "Grep",
        find: "Glob",
        ls: "Glob",
      };
      const mapped = config.tools
        .split(",")
        .map((t) => toolMap[t.trim()])
        .filter(Boolean);
      if (mapped.length > 0) {
        args.push("--allowedTools", [...new Set(mapped)].join(","));
      }
    }

    // System prompt
    if (config.systemPrompt) {
      args.push("--system-prompt", config.systemPrompt);
    }

    // Pass through any extra runtime args from agent spec
    args.push(...config.runtimeArgs);

    return args;
  }

  buildSpawnConfig(config: RuntimeTaskConfig): SpawnConfig {
    return this.buildCliSpawnConfig(config, { outputFormat: "json" });
  }

  parseResult(stdout: string, stderr: string, exitCode: number, _resultFile: string | null): RuntimeResult {
    const parsed = this.extractJson(stdout);

    if (!parsed) {
      // JSON extraction failed. Fall back to text with explicit error context.
      return {
        exitCode,
        result: stdout.trim(),
        error: exitCode !== 0 ? stderr.trim() || `Claude Code exited with code ${exitCode}` : "",
        usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, cost: 0, turns: 0 },
        model: null,
        runtime: this.id,
      };
    }

    // Determine error state from exit code, is_error flag, or error field.
    const hasError = exitCode !== 0 || parsed.is_error === true;
    const errorMsg = hasError ? (parsed.error ?? (stderr.trim() || `Claude Code exited with code ${exitCode}`)) : "";

    return {
      exitCode,
      result: typeof parsed.result === "string" ? parsed.result : stdout.trim(),
      error: errorMsg,
      usage: {
        inputTokens: parsed.usage?.input_tokens ?? 0,
        outputTokens: parsed.usage?.output_tokens ?? 0,
        cacheReadTokens: parsed.usage?.cache_read_tokens ?? 0,
        cacheWriteTokens: parsed.usage?.cache_write_tokens ?? 0,
        cost: parsed.cost_usd ?? 0,
        turns: parsed.num_turns ?? 0,
      },
      model: parsed.model ?? null,
      runtime: this.id,
    };
  }

  /**
   * Extract the JSON response from stdout.
   *
   * Handles three common cases:
   * 1. Clean JSON (entire stdout is one JSON object)
   * 2. JSON preceded by subprocess wrapper noise (log lines before the JSON)
   * 3. JSON followed by trailing output (newlines, extra text after closing brace)
   */
  private extractJson(stdout: string): ClaudeCodeJsonResponse | null {
    const trimmed = stdout.trim();
    if (!trimmed) return null;

    // Fast path: entire output is a JSON object
    if (trimmed[0] === "{") {
      try {
        return JSON.parse(trimmed) as ClaudeCodeJsonResponse;
      } catch {
        // May have trailing text after the JSON; try brace matching below.
      }
    }

    // Slow path: find the first { and last } to isolate the JSON object.
    // This handles subprocess wrapper noise (log lines, warnings) before or
    // after the actual JSON payload.
    const start = trimmed.indexOf("{");
    if (start === -1) return null;

    // Try parsing from first { to end of string
    try {
      return JSON.parse(trimmed.slice(start)) as ClaudeCodeJsonResponse;
    } catch {
      // Fall through to brace-bounded attempt
    }

    // Try parsing from first { to last }
    const end = trimmed.lastIndexOf("}");
    if (end > start) {
      try {
        return JSON.parse(trimmed.slice(start, end + 1)) as ClaudeCodeJsonResponse;
      } catch {
        return null;
      }
    }

    return null;
  }
}
