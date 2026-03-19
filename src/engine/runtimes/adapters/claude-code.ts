import { CliRuntime } from "../cli-base";
import type { RuntimeResult, RuntimeTaskConfig, SpawnConfig } from "../types";

/**
 * Claude Code CLI runtime adapter.
 *
 * Invocation: claude -p "task" --output-format json --allowedTools "..."
 *
 * Features:
 * - Tool restriction via --allowedTools
 * - JSON output for structured parsing
 * - System prompt override via --system-prompt
 * - Session continuity via --resume (not used in dispatch, each task is fresh)
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
    // Claude Code --output-format json returns: { result: string, session_id: string, ... }
    try {
      const parsed = JSON.parse(stdout.trim());
      return {
        exitCode,
        result: typeof parsed.result === "string" ? parsed.result : stdout.trim(),
        error: exitCode !== 0 ? (parsed.error ?? stderr.trim() ?? "") : "",
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
    } catch {
      // Fallback to plain text parsing if JSON parse fails
      return super.parseResult(stdout, stderr, exitCode, _resultFile);
    }
  }
}
