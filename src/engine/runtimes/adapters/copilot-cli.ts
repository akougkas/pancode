import { CliRuntime } from "../cli-base";
import type { RuntimeTaskConfig, SpawnConfig } from "../types";

/**
 * GitHub Copilot CLI runtime adapter.
 *
 * Copilot CLI is a standalone coding agent with multi-model support, MCP
 * integration, granular tool permissions, and session continuity.
 *
 * Invocation: copilot -p "task" --allow-all-tools
 *
 * Features leveraged by this adapter:
 *
 *   Non-interactive prompt mode (-p / --prompt)
 *     Executes the prompt and exits after completion
 *
 *   Permission control
 *     --allow-all-tools: auto-approve all tool uses (required for non-interactive)
 *     --allow-all: equivalent to --allow-all-tools + --allow-all-paths + --allow-all-urls
 *     --yolo: alias for --allow-all
 *     --available-tools: restrict which tools the model can use
 *     --deny-tool: deny specific tools
 *     For readonly agents, write and shell tools are denied
 *
 *   Model passthrough (--model <model>)
 *
 *   Autopilot (--autopilot)
 *     Enables continuation in prompt mode for multi-step tasks
 *
 *   Session continuity (--continue, --resume <id>)
 *     Passed via runtimeArgs for multi-turn dispatch chains
 *
 *   No --system-prompt flag exists.
 *     System instructions are prepended to the task text.
 *
 *   No structured output (--json/--format) flag exists.
 *     Plain text output only.
 *
 * What this adapter does NOT do:
 *   - Manage Copilot auth (copilot login handles that)
 *   - Configure MCP servers (copilot's own responsibility)
 *   - Parse structured output (Copilot CLI only outputs text)
 */
export class CopilotCliRuntime extends CliRuntime {
  readonly id = "cli:copilot-cli";
  readonly displayName = "Copilot CLI";
  readonly binaryName = "copilot";

  buildCliArgs(config: RuntimeTaskConfig): string[] {
    // Build the task message. Copilot CLI has no --system-prompt flag,
    // so prepend system instructions to the task text.
    let message = config.task;
    if (config.systemPrompt.trim()) {
      message = `[System Instructions]\n${config.systemPrompt.trim()}\n\n[Task]\n${config.task}`;
    }

    const args = ["-p", message];

    if (config.readonly) {
      // Read-only agents: allow tool auto-approval but deny write and shell
      args.push("--allow-all-tools");
      args.push("--deny-tool", "write", "--deny-tool", "shell");
    } else {
      // Mutable agents: full auto-approve
      args.push("--yolo");
    }

    // Enable autopilot for multi-step task completion
    args.push("--autopilot");

    // Suppress colored output for clean parsing
    args.push("--no-color");

    // Model passthrough
    if (config.model) {
      args.push("--model", config.model);
    }

    // Pass through extra runtime args from agent spec
    args.push(...config.runtimeArgs);

    return args;
  }

  buildSpawnConfig(config: RuntimeTaskConfig): SpawnConfig {
    // Copilot CLI has no JSON output mode. Text only.
    return this.buildCliSpawnConfig(config, { outputFormat: "text" });
  }
}
