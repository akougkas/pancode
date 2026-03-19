import { CliRuntime } from "../cli-base";
import type { RuntimeTaskConfig } from "../types";

/**
 * Gemini CLI runtime adapter.
 *
 * Invocation: gemini -p "task"
 *
 * Features:
 * - --yolo for write-capable agents (suppresses confirmation prompts)
 * - Plain text output by default
 * - No tool restriction API
 */
export class GeminiRuntime extends CliRuntime {
  readonly id = "cli:gemini";
  readonly displayName = "Gemini CLI";
  readonly binaryName = "gemini";

  buildCliArgs(config: RuntimeTaskConfig): string[] {
    const args = ["-p", config.task];

    if (!config.readonly) {
      args.push("--yolo");
    }

    // Pass through any extra runtime args from agent spec
    args.push(...config.runtimeArgs);

    return args;
  }
}
