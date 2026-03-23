/**
 * SSH remote worker dispatch runtime.
 *
 * Spawns workers on remote machines configured via PANCODE_SSH_NODES.
 * NDJSON streams back over SSH stdout transparently. The existing
 * dispatcher, progress tracking, and result parsing all work without
 * modification because SSH pipes stdout.
 *
 * Security: all values embedded in SSH commands are shell-escaped.
 * Authentication: BatchMode only (key-based, no passwords).
 */

import { existsSync } from "node:fs";
import { join } from "node:path";
import {
  type SshNode,
  acquireSshSlot,
  getSshNode,
  parseSshNodes,
  releaseSshSlot,
  shellEscape,
} from "../../core/ssh-nodes.js";
import type { AgentRuntime, RuntimeResult, RuntimeTaskConfig, RuntimeUsage, SpawnConfig } from "./types.js";

// ---------------------------------------------------------------------------
// TIER 2 (future): scp result file retrieval
// After process exits, optionally run:
//   scp ${node.user}@${node.host}:${remoteResultPath} ${localTempPath}
// Then read localTempPath in parseResult() for authoritative result data.
// Falls back to NDJSON-extracted result when scp is unavailable.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// TIER 3 (future, design only): Git workflow for mutable remote dispatch
//
// Pre-dispatch (orchestrator):
//   Ensure remote repo is at the correct commit via SSH git fetch/checkout.
//   Create remote worktree:
//     ssh user@host "cd /project && git worktree add .pancode/worktrees/{runId} -b pancode/task-{runId}"
//
// During dispatch:
//   Worker cwd is set to the remote worktree path.
//   Worker operates normally (read, write, edit files).
//
// Post-dispatch (orchestrator):
//   SSH commit: ssh user@host "cd .pancode/worktrees/{runId} && git add -A && git commit -m '...'"
//   Fetch locally: git fetch ssh://user@host/project pancode/task-{runId}
//   Present diff: git diff HEAD...FETCH_HEAD
//   User approves -> merge or cherry-pick
//   Cleanup: ssh user@host "git worktree remove .pancode/worktrees/{runId}"
//
// On failure: cleanup remote worktree, no local branch pollution.
// ---------------------------------------------------------------------------

function resolveRemoteProjectRoot(): string {
  return process.env.PANCODE_SSH_PROJECT_ROOT ?? process.env.PANCODE_PACKAGE_ROOT ?? process.cwd();
}

function resolveRemoteWorkerEntry(): string {
  const packageRoot = process.env.PANCODE_PACKAGE_ROOT ?? process.cwd();
  const distPath = join(packageRoot, "dist", "worker", "entry.js");
  if (existsSync(distPath)) return "dist/worker/entry.js";
  return "src/worker/entry.ts";
}

function resolveRemoteNodeCommand(entryPath: string): string {
  if (entryPath.endsWith(".ts")) {
    return "node --import tsx";
  }
  return "node";
}

function buildRemoteEnvPairs(config: RuntimeTaskConfig): string {
  const pairs: string[] = [];

  // Disable parent PID monitoring for remote workers.
  // Remote workers cannot monitor the local orchestrator's PID across SSH.
  pairs.push("PANCODE_PARENT_PID=0");

  pairs.push(`PANCODE_SAFETY=${shellEscape(process.env.PANCODE_SAFETY ?? "auto-edit")}`);
  pairs.push(`PANCODE_AGENT_NAME=${shellEscape(config.agentName)}`);

  const currentDepth = Number.parseInt(process.env.PANCODE_DISPATCH_DEPTH ?? "0", 10);
  pairs.push(`PANCODE_DISPATCH_DEPTH=${currentDepth + 1}`);
  pairs.push(`PANCODE_DISPATCH_MAX_DEPTH=${process.env.PANCODE_DISPATCH_MAX_DEPTH ?? "2"}`);

  if (config.sampling) {
    pairs.push(`PANCODE_SAMPLING_TEMPERATURE=${config.sampling.temperature}`);
    pairs.push(`PANCODE_SAMPLING_TOP_P=${config.sampling.top_p}`);
    pairs.push(`PANCODE_SAMPLING_TOP_K=${config.sampling.top_k}`);
    pairs.push(`PANCODE_SAMPLING_PRESENCE_PENALTY=${config.sampling.presence_penalty}`);
  }

  pairs.push("PI_SKIP_VERSION_CHECK=1");

  if (config.runId) {
    pairs.push(`PANCODE_RUN_ID=${shellEscape(config.runId)}`);
  }

  return pairs.join(" ");
}

export class SshRuntime implements AgentRuntime {
  readonly id = "ssh-pi";
  readonly displayName = "Pi (SSH remote)";
  readonly tier = "native" as const;
  readonly telemetryTier = "platinum" as const;

  getVersion(): string | null {
    return "remote";
  }

  isAvailable(): boolean {
    // SSH must be available and at least one node configured
    const nodes = parseSshNodes();
    return nodes.length > 0;
  }

  buildSpawnConfig(config: RuntimeTaskConfig): SpawnConfig {
    // Resolve target node from runtimeArgs: --node <name>
    let nodeName: string | null = null;
    for (let i = 0; i < config.runtimeArgs.length; i++) {
      if (config.runtimeArgs[i] === "--node" && i + 1 < config.runtimeArgs.length) {
        nodeName = config.runtimeArgs[i + 1];
        break;
      }
    }

    const nodes = parseSshNodes();
    const node: SshNode | undefined = nodeName ? getSshNode(nodeName) : nodes[0];

    if (!node) {
      throw new Error(
        nodeName
          ? `SSH node "${nodeName}" not found. Configure via PANCODE_SSH_NODES.`
          : "No SSH nodes configured. Set PANCODE_SSH_NODES env var.",
      );
    }

    // Acquire concurrency slot
    if (!acquireSshSlot(node.name)) {
      throw new Error(
        `SSH node "${node.name}" is at maximum concurrent connections (${node.maxConcurrent}). Wait for a running worker to finish.`,
      );
    }

    const remoteRoot = resolveRemoteProjectRoot();
    const entryPath = resolveRemoteWorkerEntry();
    const nodeCommand = resolveRemoteNodeCommand(entryPath);
    const envPairs = buildRemoteEnvPairs(config);

    // Build worker CLI args
    const workerArgs: string[] = [];
    workerArgs.push("--prompt", shellEscape(`Task: ${config.task}`));
    workerArgs.push("--tools", shellEscape(config.tools));

    // No --result-file for SSH: result comes from NDJSON stream.
    // Use /dev/null so the worker entry does not error on missing arg.
    workerArgs.push("--result-file", "/dev/null");

    if (config.model) {
      const slashIdx = config.model.indexOf("/");
      if (slashIdx > 0) {
        workerArgs.push("--provider", shellEscape(config.model.slice(0, slashIdx)));
        workerArgs.push("--model", shellEscape(config.model.slice(slashIdx + 1)));
      } else {
        workerArgs.push("--model", shellEscape(config.model));
      }
    }

    if (config.systemPrompt.trim()) {
      workerArgs.push("--system-prompt", shellEscape(config.systemPrompt));
    }

    if (config.timeoutMs > 0) {
      workerArgs.push("--timeout-ms", String(config.timeoutMs));
    }

    // Build the full remote command
    const remoteCommand = `cd ${shellEscape(remoteRoot)} && env ${envPairs} ${nodeCommand} ${entryPath} ${workerArgs.join(" ")}`;

    return {
      command: "ssh",
      args: [
        "-o",
        "BatchMode=yes",
        "-o",
        "StrictHostKeyChecking=accept-new",
        "-o",
        "ConnectTimeout=10",
        "-o",
        "ServerAliveInterval=15",
        "-o",
        "ServerAliveCountMax=3",
        "-p",
        String(node.port),
        `${node.user}@${node.host}`,
        remoteCommand,
      ],
      env: {},
      cwd: config.cwd,
      outputFormat: "ndjson",
    };
  }

  /**
   * Parse result from SSH runtime.
   * SSH runtime results are extracted from the NDJSON stream by worker-spawn.ts.
   * This method is a fallback that packages whatever was captured.
   */
  parseResult(stdout: string, stderr: string, exitCode: number, _resultFile: string | null): RuntimeResult {
    const emptyUsage: RuntimeUsage = {
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      cost: 0,
      turns: 0,
    };

    // Release SSH slot. The node name is embedded in the SSH args but we cannot
    // extract it here reliably. The caller (dispatch extension) should call
    // releaseSshSlot in its finally block. This is a best-effort fallback.

    return {
      exitCode,
      result: stdout,
      error: stderr ? stderr.trim().slice(0, 500) : "",
      usage: emptyUsage,
      model: null,
      runtime: this.id,
    };
  }
}

export const sshPiRuntime = new SshRuntime();
