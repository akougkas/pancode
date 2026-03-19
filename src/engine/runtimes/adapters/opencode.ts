import { CliRuntime } from "../cli-base";
import type { RuntimeResult, RuntimeTaskConfig, SpawnConfig } from "../types";

/**
 * opencode CLI runtime adapter.
 *
 * opencode (https://opencode.ai) is a full-featured coding agent with structured
 * JSON output, built-in agent roles, granular permission control, session
 * continuity, and native cost/token tracking.
 *
 * Invocation: opencode run --format json --dir <cwd> --agent <agent> "task"
 *
 * Features leveraged by this adapter:
 *
 *   Structured NDJSON output (--format json)
 *     Event types: step_start, text, tool_use, step_finish
 *     step_finish carries tokens (input/output/reasoning/cache) and cost
 *     text events carry assistant response fragments
 *
 *   Built-in agent selection (--agent)
 *     build: full access (read, write, edit, bash, web)
 *     explore: read-only (grep, glob, list, bash, read, web)
 *     plan: analysis mode (read-only + plan file editing)
 *     general: multi-step subagent (all except todo)
 *     PanCode maps: readonly=true -> explore, readonly=false -> build
 *
 *   Model passthrough (--model provider/model)
 *     opencode uses the same provider/model format as PanCode
 *
 *   Reasoning effort control (--variant)
 *     Anthropic: high, max
 *     OpenAI: none, minimal, low, medium, high, xhigh
 *     Google: low, medium, high
 *     Passed via runtimeArgs: ["--variant", "high"]
 *
 *   Session continuity (--continue, --session <id>, --fork)
 *     Passed via runtimeArgs for multi-turn dispatch chains
 *
 *   File attachment (--file)
 *     Passed via runtimeArgs: ["--file", "path/to/file"]
 *
 *   Permission override via OPENCODE_CONFIG_CONTENT env var
 *     Inject per-invocation permission lockdowns without touching config files
 *
 * What this adapter does NOT do:
 *   - Manage opencode auth (opencode uses its own provider credentials)
 *   - Start the opencode server (headless run is self-contained)
 *   - Configure MCP servers (opencode's own responsibility)
 */
export class OpencodeRuntime extends CliRuntime {
  readonly id = "cli:opencode";
  readonly displayName = "opencode";
  readonly binaryName = "opencode";

  /**
   * Map PanCode readonly flag to the best opencode agent.
   * explore: fast read-only codebase exploration (grep, glob, read, list)
   * build: full access agent for mutable tasks
   */
  private resolveAgent(config: RuntimeTaskConfig): string {
    // If the user specified an opencode agent via runtimeArgs, respect it
    const agentIdx = config.runtimeArgs.indexOf("--agent");
    if (agentIdx !== -1 && config.runtimeArgs[agentIdx + 1]) {
      return config.runtimeArgs[agentIdx + 1];
    }
    return config.readonly ? "explore" : "build";
  }

  buildCliArgs(config: RuntimeTaskConfig): string[] {
    const agent = this.resolveAgent(config);

    // Build the task message. opencode run does not have a --system-prompt flag,
    // so we prepend the system prompt to the task as context instructions.
    let message = config.task;
    if (config.systemPrompt.trim()) {
      message = `[System Instructions]\n${config.systemPrompt.trim()}\n\n[Task]\n${config.task}`;
    }

    const args = ["run", "--format", "json", "--agent", agent, "--dir", config.cwd];

    // Model passthrough. opencode uses provider/model format natively.
    if (config.model) {
      args.push("--model", config.model);
    }

    // Filter out --agent from runtimeArgs since we already handled it
    const filteredArgs = filterHandledArgs(config.runtimeArgs, ["--agent"]);
    args.push(...filteredArgs);

    // Task message is the positional argument (must come last)
    args.push(message);

    return args;
  }

  buildSpawnConfig(config: RuntimeTaskConfig): SpawnConfig {
    const env: Record<string, string> = {};

    // Inject per-invocation permission overrides via OPENCODE_CONFIG_CONTENT.
    // In headless mode, "ask" permissions are auto-approved, so critical
    // restrictions must use "deny". For readonly agents, deny edit and bash.
    if (config.readonly) {
      env.OPENCODE_CONFIG_CONTENT = JSON.stringify({
        agent: {
          [this.resolveAgent(config)]: {
            permission: {
              edit: { "*": "deny" },
              bash: { "*": "deny" },
            },
          },
        },
      });
    }

    return this.buildCliSpawnConfig(config, { env, outputFormat: "json" });
  }

  /**
   * Parse opencode's NDJSON event stream into a RuntimeResult.
   *
   * Event stream structure (one JSON object per line):
   *   { type: "step_start", part: { type: "step-start" } }
   *   { type: "text",       part: { type: "text", text: "..." } }
   *   { type: "tool_use",   part: { type: "tool", tool: "read", state: { status, input, output } } }
   *   { type: "step_finish", part: { type: "step-finish", reason, cost, tokens: { input, output, reasoning, cache: { read, write } } } }
   *
   * We aggregate all text fragments and sum tokens/cost across all steps.
   * The last text fragment before the final step_finish is the authoritative result.
   */
  parseResult(stdout: string, stderr: string, exitCode: number, _resultFile: string | null): RuntimeResult {
    const lines = stdout.split("\n").filter((l) => l.trim());
    const textFragments: string[] = [];
    let totalInputTokens = 0;
    let totalOutputTokens = 0;
    let totalCacheRead = 0;
    let totalCacheWrite = 0;
    let totalCost = 0;
    let turns = 0;
    const model: string | null = null;
    let sessionId: string | null = null;
    let lastError = "";

    for (const line of lines) {
      // Skip non-JSON lines (plugin init messages, warnings)
      const trimmed = line.trim();
      if (!trimmed || trimmed[0] !== "{") continue;

      let event: OpencodeEvent;
      try {
        event = JSON.parse(trimmed) as OpencodeEvent;
      } catch {
        continue;
      }

      // Capture session ID for potential continuity
      if (event.sessionID && !sessionId) {
        sessionId = event.sessionID;
      }

      switch (event.type) {
        case "text":
          if (event.part?.text) {
            textFragments.push(event.part.text);
          }
          break;

        case "step_finish":
          if (event.part) {
            turns++;
            const tokens = event.part.tokens;
            if (tokens) {
              totalInputTokens += tokens.input ?? 0;
              totalOutputTokens += tokens.output ?? 0;
              totalCacheRead += tokens.cache?.read ?? 0;
              totalCacheWrite += tokens.cache?.write ?? 0;
            }
            totalCost += event.part.cost ?? 0;

            // Track errors from step finish
            if (event.part.reason === "error") {
              lastError = "Step finished with error";
            }
          }
          break;

        case "session.error":
          lastError = event.error ?? "Session error";
          break;

        // step_start, tool_use, session.idle: no action needed for result parsing
      }
    }

    // The final text fragment is the authoritative assistant response.
    // Earlier fragments may be partial or from intermediate steps.
    const result = textFragments.length > 0 ? textFragments[textFragments.length - 1] : "";

    // Determine error state
    const error = exitCode !== 0 ? lastError || stderr.trim() || `opencode exited with code ${exitCode}` : lastError;

    return {
      exitCode,
      result,
      error,
      usage: {
        inputTokens: totalInputTokens,
        outputTokens: totalOutputTokens,
        cacheReadTokens: totalCacheRead,
        cacheWriteTokens: totalCacheWrite,
        cost: totalCost,
        turns,
      },
      model,
      runtime: this.id,
    };
  }
}

// ---------------------------------------------------------------------------
// Internal types for NDJSON event parsing
// ---------------------------------------------------------------------------

interface OpencodeEvent {
  type: string;
  timestamp?: number;
  sessionID?: string;
  error?: string;
  part?: {
    type?: string;
    text?: string;
    reason?: string;
    cost?: number;
    tool?: string;
    tokens?: {
      total?: number;
      input?: number;
      output?: number;
      reasoning?: number;
      cache?: {
        read?: number;
        write?: number;
      };
    };
    state?: {
      status?: string;
      input?: unknown;
      output?: unknown;
    };
  };
}

/**
 * Filter out already-handled flag/value pairs from runtimeArgs.
 * Removes both the flag and its value if the flag takes an argument.
 */
function filterHandledArgs(args: string[], handledFlags: string[]): string[] {
  const result: string[] = [];
  let skip = false;
  for (const arg of args) {
    if (skip) {
      skip = false;
      continue;
    }
    if (handledFlags.includes(arg)) {
      skip = true; // skip the next arg (the value)
      continue;
    }
    result.push(arg);
  }
  return result;
}
