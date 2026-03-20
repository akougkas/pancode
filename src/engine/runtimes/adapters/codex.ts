import { CliRuntime } from "../cli-base";
import type { RuntimeResult, RuntimeTaskConfig, SpawnConfig } from "../types";

// ---------------------------------------------------------------------------
// Codex JSON event types
// ---------------------------------------------------------------------------

/**
 * Codex JSON Lines event. Codex with --json outputs one JSON object per line.
 * Event types vary; usage data appears in completion/summary events.
 *
 * Known field patterns (OpenAI Codex CLI):
 * - `output` or `result`: final assistant text
 * - `usage.input_tokens` / `usage.prompt_tokens`: input token count
 * - `usage.output_tokens` / `usage.completion_tokens`: output token count
 * - `usage.total_tokens`: combined total
 * - `model`: model identifier
 * - `error`: error message on failure
 */
interface CodexJsonEvent {
  type?: string;
  output?: string;
  result?: string;
  model?: string;
  error?: string;
  usage?: {
    total_tokens?: number;
    input_tokens?: number;
    output_tokens?: number;
    prompt_tokens?: number;
    completion_tokens?: number;
  };
  cost?: number;
  total_cost?: number;
}

// ---------------------------------------------------------------------------
// Runtime adapter
// ---------------------------------------------------------------------------

/**
 * Codex CLI runtime adapter (Silver Tier).
 *
 * Invocation: codex exec "task" --json --model <model> --cd <cwd>
 *
 * Silver tier: parses JSON Lines output for both result text and usage data.
 * Aggregates tokens and cost across all events. Falls back to text when
 * structured parsing yields nothing.
 *
 * Features:
 * - --full-auto for write-capable agents, default sandbox for readonly
 * - JSON Lines output format with usage extraction
 * - Token and cost aggregation across events
 * - Model passthrough via --model flag
 * - Working directory via --cd flag
 * - System prompt prepended to task text (no native --system-prompt flag)
 */
export class CodexRuntime extends CliRuntime {
  readonly id = "cli:codex";
  readonly displayName = "Codex";
  readonly binaryName = "codex";

  buildCliArgs(config: RuntimeTaskConfig): string[] {
    // Build the task message. Codex does not have a --system-prompt flag,
    // so prepend system instructions to the task text.
    let message = config.task;
    if (config.systemPrompt.trim()) {
      message = `[System Instructions]\n${config.systemPrompt.trim()}\n\n[Task]\n${config.task}`;
    }

    const args = ["exec", message, "--json"];

    // Working directory
    args.push("--cd", config.cwd);

    // Model passthrough
    if (config.model) {
      args.push("--model", config.model);
    }

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
    const rawLines = stdout
      .trim()
      .split("\n")
      .filter((l) => l.trim());
    const events: CodexJsonEvent[] = [];

    for (const line of rawLines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed[0] !== "{") continue;
      try {
        events.push(JSON.parse(trimmed) as CodexJsonEvent);
      } catch {
        // Non-JSON line; skip
      }
    }

    if (events.length === 0) {
      return super.parseResult(stdout, stderr, exitCode, _resultFile);
    }

    // Find the result text from the last event that has output or result.
    let resultText = "";
    let model: string | null = null;
    let lastError = "";

    // Aggregate usage across all events (some runtimes split across steps).
    let totalInputTokens = 0;
    let totalOutputTokens = 0;
    let totalCost = 0;
    let turns = 0;

    for (const event of events) {
      // Capture result text (last one wins)
      if (typeof event.output === "string") resultText = event.output;
      else if (typeof event.result === "string") resultText = event.result;

      // Capture model (first one wins)
      if (!model && typeof event.model === "string") model = event.model;

      // Capture errors
      if (typeof event.error === "string") lastError = event.error;

      // Aggregate usage data. Codex uses OpenAI naming conventions:
      // input_tokens or prompt_tokens, output_tokens or completion_tokens.
      if (event.usage) {
        const inTok = event.usage.input_tokens ?? event.usage.prompt_tokens ?? 0;
        const outTok = event.usage.output_tokens ?? event.usage.completion_tokens ?? 0;
        if (inTok > 0 || outTok > 0) {
          totalInputTokens += inTok;
          totalOutputTokens += outTok;
          turns++;
        }
      }

      // Aggregate cost
      totalCost += event.cost ?? event.total_cost ?? 0;
    }

    if (!resultText) {
      return super.parseResult(stdout, stderr, exitCode, _resultFile);
    }

    const error = exitCode !== 0 ? lastError || stderr.trim() || `Codex exited with code ${exitCode}` : "";

    return {
      exitCode,
      result: resultText,
      error,
      usage: {
        inputTokens: totalInputTokens,
        outputTokens: totalOutputTokens,
        cacheReadTokens: 0, // Codex does not report cache tokens
        cacheWriteTokens: 0,
        cost: totalCost,
        turns,
      },
      model,
      runtime: this.id,
    };
  }
}
