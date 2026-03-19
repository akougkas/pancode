import { CliRuntime } from "../cli-base";
import type { RuntimeResult, RuntimeTaskConfig, SpawnConfig } from "../types";

/**
 * Codex CLI runtime adapter.
 *
 * Invocation: codex exec "task" --json
 *
 * Features:
 * - --full-auto for write-capable agents, default sandbox for readonly
 * - JSON Lines output format
 * - Parse last JSON object for result
 */
export class CodexRuntime extends CliRuntime {
  readonly id = "cli:codex";
  readonly displayName = "Codex";
  readonly binaryName = "codex";

  buildCliArgs(config: RuntimeTaskConfig): string[] {
    const args = ["exec", config.task, "--json"];

    if (!config.readonly) {
      args.push("--full-auto");
    }

    // Pass through any extra runtime args from agent spec
    args.push(...config.runtimeArgs);

    return args;
  }

  buildSpawnConfig(config: RuntimeTaskConfig): SpawnConfig {
    return this.buildCliSpawnConfig(config, { outputFormat: "json" });
  }

  parseResult(stdout: string, stderr: string, exitCode: number, _resultFile: string | null): RuntimeResult {
    // Codex outputs JSON Lines. Parse the last JSON object for the final result.
    const lines = stdout
      .trim()
      .split("\n")
      .filter((l) => l.trim());
    for (let i = lines.length - 1; i >= 0; i--) {
      try {
        const parsed = JSON.parse(lines[i]);
        if (typeof parsed.output === "string" || typeof parsed.result === "string") {
          return {
            exitCode,
            result: parsed.output ?? parsed.result ?? "",
            error: exitCode !== 0 ? (parsed.error ?? stderr.trim() ?? "") : "",
            usage: {
              inputTokens: 0,
              outputTokens: 0,
              cacheReadTokens: 0,
              cacheWriteTokens: 0,
              cost: 0,
              turns: 0,
            },
            model: parsed.model ?? null,
            runtime: this.id,
          };
        }
      } catch {}
    }

    // Fallback to plain text parsing
    return super.parseResult(stdout, stderr, exitCode, _resultFile);
  }
}
