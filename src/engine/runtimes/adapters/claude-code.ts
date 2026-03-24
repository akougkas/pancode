import { CliRuntime } from "../cli-base";
import type { RuntimeResult, RuntimeTaskConfig, SpawnConfig } from "../types";

/** Default maximum agent turns before Claude Code stops. Prevents runaway workers. */
const DEFAULT_MAX_TURNS = 30;

// ---------------------------------------------------------------------------
// Claude Code JSON response types
// ---------------------------------------------------------------------------

/**
 * Structured JSON response from Claude Code (--output-format json).
 *
 * Supports two formats:
 * 1. Legacy (pre-v2.x): single JSON object with cost_usd and snake_case usage fields.
 * 2. v2.x: JSON array of event objects; the "result" event contains total_cost_usd,
 *    snake_case usage fields, and a camelCase modelUsage map keyed by model name.
 */
interface ClaudeCodeJsonResponse {
  // Common fields (present in both formats)
  result?: string;
  session_id?: string;
  num_turns?: number;
  error?: string;
  is_error?: boolean;

  // Legacy fields (pre-v2.x)
  cost_usd?: number;
  model?: string;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    cache_read_tokens?: number;
    cache_write_tokens?: number;
    // v2.x usage fields (same level, different names)
    cache_creation_input_tokens?: number;
    cache_read_input_tokens?: number;
  };

  // v2.x event fields
  type?: string;
  subtype?: string;
  total_cost_usd?: number;
  modelUsage?: Record<
    string,
    {
      inputTokens?: number;
      outputTokens?: number;
      cacheReadInputTokens?: number;
      cacheCreationInputTokens?: number;
      costUSD?: number;
      contextWindow?: number;
      maxOutputTokens?: number;
    }
  >;
}

// ---------------------------------------------------------------------------
// Runtime adapter
// ---------------------------------------------------------------------------

/**
 * Claude Code CLI runtime adapter (Gold Tier).
 *
 * Invocation: claude -p "task" --output-format json --tools "..." --model <model>
 *
 * Gold tier: fully structured JSON output with reliable extraction of tokens,
 * cost, model, turns, and session ID. Robust JSON parsing handles subprocess
 * wrapper noise and multi-line output.
 *
 * Features:
 * - Tool restriction via --tools (restricts tool availability)
 * - Tool auto-approval via --allowedTools (pattern-based permission rules)
 * - JSON output for structured parsing
 * - System prompt via --append-system-prompt (preserves built-in capabilities)
 * - Model selection via --model (aliases or full model names)
 * - Turn limits via --max-turns for bounded execution
 * - Session continuity via --resume (auto-injected by session-continuity store)
 * - Full usage tracking: input/output tokens, cache tokens, cost, turns
 */
export class ClaudeCodeRuntime extends CliRuntime {
  readonly id = "cli:claude-code";
  readonly displayName = "Claude Code";
  override readonly telemetryTier = "gold" as const;
  readonly binaryName = "claude";

  buildCliArgs(config: RuntimeTaskConfig): string[] {
    const args = ["-p", config.task, "--output-format", "json"];

    // Model selection. Supports aliases (sonnet, opus) or full model names.
    if (config.model) {
      args.push("--model", config.model);
    }

    // Tool restriction via --tools (controls tool availability) and
    // --allowedTools (controls which tools auto-approve without prompting).
    // --tools restricts what the model can see; --allowedTools controls permissions.
    if (config.readonly) {
      // Read-only agents: restrict available tools to read-only set
      args.push("--tools", "Read,Grep,Glob");
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
      const deduped = [...new Set(mapped)].join(",");
      if (deduped) {
        args.push("--tools", deduped);
        args.push("--allowedTools", deduped);
      }
    }

    // System prompt: use --append-system-prompt to preserve Claude Code's
    // built-in capabilities (tool descriptions, guidelines) while adding
    // PanCode worker instructions on top.
    if (config.systemPrompt) {
      args.push("--append-system-prompt", config.systemPrompt);
    }

    // Turn limit for bounded execution. Prevents runaway workers.
    // Can be overridden via runtimeArgs: ["--max-turns", "50"].
    // Claude Code has no --timeout flag. The cli-entry.ts wrapper provides a
    // process-level kill timer as the fallback timeout mechanism.
    if (!config.runtimeArgs.includes("--max-turns")) {
      args.push("--max-turns", String(DEFAULT_MAX_TURNS));
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

    // Determine error state from exit code, is_error flag, or error field.
    const hasError = exitCode !== 0 || parsed.is_error === true;
    const errorMsg = hasError ? (parsed.error ?? (stderr.trim() || `Claude Code exited with code ${exitCode}`)) : "";

    // Extract model: prefer modelUsage keys (v2.x), fall back to top-level model field.
    let model = parsed.model ?? null;
    if (!model && parsed.modelUsage) {
      const modelKeys = Object.keys(parsed.modelUsage);
      if (modelKeys.length > 0) {
        // Strip the context window suffix like "[1m]" from "claude-opus-4-6[1m]"
        model = modelKeys[0].replace(/\[.*\]$/, "");
      }
    }

    // Extract usage: merge v2.x and legacy field names.
    // v2.x provides both snake_case in usage{} and camelCase in modelUsage{}.
    const usage = parsed.usage;
    const modelUsageEntry = parsed.modelUsage ? Object.values(parsed.modelUsage)[0] : null;

    return {
      exitCode,
      result: typeof parsed.result === "string" ? parsed.result : stdout.trim(),
      error: errorMsg,
      usage: {
        inputTokens: usage?.input_tokens ?? modelUsageEntry?.inputTokens ?? 0,
        outputTokens: usage?.output_tokens ?? modelUsageEntry?.outputTokens ?? 0,
        cacheReadTokens:
          usage?.cache_read_input_tokens ?? usage?.cache_read_tokens ?? modelUsageEntry?.cacheReadInputTokens ?? 0,
        cacheWriteTokens:
          usage?.cache_creation_input_tokens ??
          usage?.cache_write_tokens ??
          modelUsageEntry?.cacheCreationInputTokens ??
          0,
        cost: parsed.total_cost_usd ?? parsed.cost_usd ?? modelUsageEntry?.costUSD ?? 0,
        turns: parsed.num_turns ?? 0,
      },
      model,
      runtime: this.id,
      sessionMeta: parsed.session_id ? { sessionId: parsed.session_id } : undefined,
    };
  }

  /**
   * Extract the JSON response from stdout.
   *
   * Handles four output formats:
   * 1. JSON array (v2.x): parse the array, find the element with type "result"
   * 2. Single JSON object (legacy): parse as a single object
   * 3. NDJSON: split by newlines, parse each line, find the result event
   * 4. Brace-bounded extraction: isolate JSON from subprocess wrapper noise
   */
  private extractJson(stdout: string): ClaudeCodeJsonResponse | null {
    const trimmed = stdout.trim();
    if (!trimmed) return null;

    // Case 1: JSON array (v2.x format)
    if (trimmed[0] === "[") {
      try {
        const events = JSON.parse(trimmed) as ClaudeCodeJsonResponse[];
        const resultEvent = events.findLast((e) => e.type === "result");
        return resultEvent ?? events[events.length - 1] ?? null;
      } catch {
        // Fall through to other cases
      }
    }

    // Case 2: Single JSON object (legacy format)
    if (trimmed[0] === "{") {
      try {
        return JSON.parse(trimmed) as ClaudeCodeJsonResponse;
      } catch {
        // Fall through
      }
    }

    // Case 3: NDJSON (multiple JSON objects separated by newlines)
    const lines = trimmed.split("\n");
    let lastResult: ClaudeCodeJsonResponse | null = null;
    for (const line of lines) {
      const cleaned = line.trim();
      if (!cleaned || cleaned[0] !== "{") continue;
      try {
        const parsed = JSON.parse(cleaned) as ClaudeCodeJsonResponse;
        if (parsed.type === "result" || parsed.result !== undefined) {
          lastResult = parsed;
        }
      } catch {
        // Parse failure on this line; skip it
      }
    }
    if (lastResult) return lastResult;

    // Case 4: Brace-bounded extraction (original fallback for subprocess noise)
    const start = trimmed.indexOf("{");
    if (start === -1) return null;
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
