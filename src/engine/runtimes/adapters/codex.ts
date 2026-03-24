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
  override readonly telemetryTier = "silver" as const;
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

    // Codex CLI does not support a --timeout flag. The cli-entry.ts wrapper
    // provides a process-level kill timer as the fallback timeout mechanism.

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

    // Multi-line accumulator: handles JSON objects that span multiple lines
    // or stdout lines corrupted by interleaved deprecation warnings.
    let jsonAccumulator = "";

    for (const line of rawLines) {
      let trimmed = line.trim();
      if (!trimmed) continue;

      // Strip UTF-8 BOM from the first meaningful line.
      if (events.length === 0 && !jsonAccumulator && trimmed.charCodeAt(0) === 0xfeff) {
        trimmed = trimmed.slice(1);
      }

      // If accumulating a multi-line JSON object, keep appending lines.
      if (jsonAccumulator) {
        jsonAccumulator += `\n${trimmed}`;
        try {
          events.push(JSON.parse(jsonAccumulator) as CodexJsonEvent);
          jsonAccumulator = "";
        } catch {
          // Still incomplete; keep accumulating.
        }
        continue;
      }

      if (trimmed[0] !== "{") continue;

      try {
        events.push(JSON.parse(trimmed) as CodexJsonEvent);
      } catch {
        // Could be the start of a multi-line JSON object.
        jsonAccumulator = trimmed;
      }
    }

    // Flush any remaining accumulator.
    if (jsonAccumulator) {
      try {
        events.push(JSON.parse(jsonAccumulator) as CodexJsonEvent);
      } catch {
        // Truly broken JSON; ignore.
      }
    }

    // Brace-bounded fallback: if per-line and multi-line parsing both found
    // nothing, attempt to extract a single JSON object from the raw stdout.
    if (events.length === 0) {
      const extracted = this.extractBraceBounded(stdout);
      if (extracted) {
        events.push(extracted);
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

    const error = exitCode !== 0 ? lastError || this.classifyCliError(stderr, exitCode).message : "";

    return {
      exitCode,
      result: resultText,
      error,
      usage: {
        inputTokens: totalInputTokens,
        outputTokens: totalOutputTokens,
        cacheReadTokens: null, // Codex does not report cache tokens
        cacheWriteTokens: null,
        cost: totalCost,
        turns,
      },
      model,
      runtime: this.id,
    };
  }

  /**
   * Fallback JSON extraction via brace matching.
   * Handles cases where Codex output contains a single JSON object
   * spanning multiple lines or embedded in wrapper noise.
   */
  private extractBraceBounded(stdout: string): CodexJsonEvent | null {
    const trimmed = stdout.trim();
    if (!trimmed) return null;

    // Strip UTF-8 BOM if present.
    const clean = trimmed.charCodeAt(0) === 0xfeff ? trimmed.slice(1) : trimmed;

    const start = clean.indexOf("{");
    if (start === -1) return null;

    // Try from first brace to end of string.
    try {
      return JSON.parse(clean.slice(start)) as CodexJsonEvent;
    } catch {
      // Try from first brace to last brace.
      const end = clean.lastIndexOf("}");
      if (end > start) {
        try {
          return JSON.parse(clean.slice(start, end + 1)) as CodexJsonEvent;
        } catch {
          return null;
        }
      }
    }

    return null;
  }
}
