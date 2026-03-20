import { CliRuntime } from "../cli-base";
import type { RuntimeTaskConfig } from "../types";

/**
 * Gemini CLI runtime adapter (Bronze Tier).
 *
 * Invocation: gemini -p "task"
 *
 * Bronze tier: plain text output only. No structured JSON output, no usage
 * tracking. Result text is extracted from stdout; token counts and cost are
 * reported as zeros.
 *
 * Features:
 * - --yolo for write-capable agents (suppresses confirmation prompts)
 * - Plain text output by default
 * - No tool restriction API
 *
 * TODO: Gemini CLI does not currently expose a --output-format json or --json
 * flag for structured output. When structured output support is added upstream,
 * upgrade this adapter to silver tier by parsing token usage and cost from the
 * JSON response. Check `gemini --help` for new flags periodically.
 */
export class GeminiRuntime extends CliRuntime {
  readonly id = "cli:gemini";
  readonly displayName = "Gemini CLI";
  readonly binaryName = "gemini";

  buildCliArgs(config: RuntimeTaskConfig): string[] {
    // TODO: Gemini CLI does not support --system-prompt or equivalent.
    // When upstream adds system prompt support, pass config.systemPrompt through.
    // Currently the system prompt is lost for Gemini workers.
    const args = ["-p", config.task];

    if (!config.readonly) {
      args.push("--yolo");
    }

    // Pass through any extra runtime args from agent spec
    args.push(...config.runtimeArgs);

    return args;
  }
}
