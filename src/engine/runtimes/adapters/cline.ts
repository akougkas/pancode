import { CliRuntime } from "../cli-base";
import type { RuntimeResult, RuntimeTaskConfig, SpawnConfig } from "../types";

/**
 * Cline CLI 2.0 runtime adapter.
 *
 * Cline is a headless coding agent with structured NDJSON output, Plan/Act
 * mode split, per-category auto-approve, and MCP support. The CLI does not
 * expose browser automation in headless mode.
 *
 * Invocation: cline -y "task" --json
 *
 * Features leveraged by this adapter:
 *
 *   Structured NDJSON output (--json)
 *     Key message types: task_started, say (text, completion_result,
 *     api_req_started, reasoning, command), ask, error
 *     completion_result carries the final answer text
 *     api_req_started carries cost/token metadata as JSON in its text field
 *
 *   Auto-approve (-y / --yolo)
 *     Approves all tool uses without interactive confirmation
 *
 *   Plan mode (-p) vs Act mode (-a)
 *     PanCode maps: readonly=true -> plan mode, readonly=false -> act mode
 *
 *     Known bug (plan_mode_respond): When plan mode (-p) is combined with
 *     auto-approve (-y), Cline's CLI auto-switches to act mode after
 *     generating a plan. The plan_mode_respond handler does not wait for
 *     user approval when -y is set, so plan mode effectively becomes
 *     "plan then act." PanCode works around this by defaulting non-readonly
 *     agents to act mode (-a) and accepting that readonly agents dispatched
 *     with -p will still execute mutations after planning.
 *
 *   Model passthrough (-m provider:model-id)
 *     Routes through the configured provider's base URL
 *
 *   Working directory (-c / --cwd)
 *
 *   Timeout (-t / --timeout seconds)
 *
 *   Session continuity (-T taskId, --continue)
 *     Passed via runtimeArgs for multi-turn dispatch chains
 *
 *   No --system-prompt flag exists.
 *     System instructions are prepended to the task text.
 *
 * What this adapter does NOT do:
 *   - Expose browser automation (not available in headless CLI mode)
 *   - Manage Cline auth or provider config
 *   - Configure MCP servers
 */
export class ClineRuntime extends CliRuntime {
  readonly id = "cli:cline";
  readonly displayName = "Cline";
  readonly binaryName = "cline";

  buildCliArgs(config: RuntimeTaskConfig): string[] {
    // Build the task message. Cline has no --system-prompt flag,
    // so prepend system instructions to the task text.
    let message = config.task;
    if (config.systemPrompt.trim()) {
      message = `[System Instructions]\n${config.systemPrompt.trim()}\n\n[Task]\n${config.task}`;
    }

    const args = ["-y", "--json"];

    // Map PanCode readonly to Cline Plan/Act mode.
    // Note: -p with -y triggers the plan_mode_respond bug where Cline
    // auto-switches to act after planning. See header comment.
    if (config.readonly) {
      args.push("-p");
    } else {
      args.push("-a");
    }

    // Working directory
    args.push("-c", config.cwd);

    // Model passthrough (provider:model-id format)
    if (config.model) {
      args.push("-m", config.model);
    }

    // Pass through extra runtime args from agent spec
    args.push(...config.runtimeArgs);

    // Task message is the positional argument (must come last)
    args.push(message);

    return args;
  }

  buildSpawnConfig(config: RuntimeTaskConfig): SpawnConfig {
    return this.buildCliSpawnConfig(config, { outputFormat: "json" });
  }

  /**
   * Parse Cline's NDJSON output stream into a RuntimeResult.
   *
   * NDJSON structure (one JSON object per line):
   *   {"type":"task_started","taskId":"..."}
   *   {"type":"say","say":"text","text":"..."}
   *   {"type":"say","say":"api_req_started","text":"{\"request\":\"...\",\"tokensIn\":N,\"tokensOut\":N,\"cost\":N}"}
   *   {"type":"say","say":"completion_result","text":"..."}
   *   {"type":"error","message":"..."}
   *
   * The completion_result say event carries the final answer.
   * api_req_started carries cost/token data as a JSON string in its text field.
   */
  parseResult(stdout: string, stderr: string, exitCode: number, _resultFile: string | null): RuntimeResult {
    const lines = stdout.split("\n").filter((l) => l.trim());
    let completionResult = "";
    let totalInputTokens = 0;
    let totalOutputTokens = 0;
    let totalCost = 0;
    let turns = 0;
    let lastError = "";

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed[0] !== "{") continue;

      let event: ClineEvent;
      try {
        event = JSON.parse(trimmed) as ClineEvent;
      } catch {
        continue;
      }

      if (event.type === "say") {
        if (event.say === "completion_result" && event.text) {
          completionResult = event.text;
        } else if (event.say === "api_req_started" && event.text) {
          // api_req_started text is a JSON string with token/cost data
          try {
            const apiData = JSON.parse(event.text) as ClineApiReqData;
            totalInputTokens += apiData.tokensIn ?? 0;
            totalOutputTokens += apiData.tokensOut ?? 0;
            totalCost += apiData.cost ?? 0;
            turns++;
          } catch {
            // Not all api_req_started events have parseable JSON
          }
        }
      } else if (event.type === "error") {
        lastError = event.message ?? "Cline error";
      }
    }

    const result = completionResult || "";
    const error = exitCode !== 0 ? lastError || stderr.trim() || `Cline exited with code ${exitCode}` : lastError;

    return {
      exitCode,
      result,
      error,
      usage: {
        inputTokens: totalInputTokens,
        outputTokens: totalOutputTokens,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        cost: totalCost,
        turns,
      },
      model: null,
      runtime: this.id,
    };
  }
}

// ---------------------------------------------------------------------------
// Internal types for NDJSON event parsing
// ---------------------------------------------------------------------------

interface ClineEvent {
  type: string;
  say?: string;
  ask?: string;
  text?: string;
  message?: string;
  taskId?: string;
}

interface ClineApiReqData {
  request?: string;
  tokensIn?: number;
  tokensOut?: number;
  cost?: number;
}
