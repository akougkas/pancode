/**
 * Remote SDK runtime adapter (Proof-of-concept).
 *
 * Dispatches Claude Agent SDK workers to remote machines via SSH.
 * The remote host must have Node.js and @anthropic-ai/claude-code installed
 * and authenticated. PanCode SSHs to the target, runs the SDK query remotely,
 * and streams results back as NDJSON over SSH stdout.
 *
 * Architecture: Option A (SSH + Remote SDK)
 *   1. SSH to remote host
 *   2. Execute a thin Node.js shim that imports the SDK and runs query()
 *   3. Shim streams SDKMessage events as NDJSON to stdout
 *   4. Local orchestrator parses NDJSON and produces RuntimeResult
 *
 * This is the most viable approach for PanCode's homelab topology because:
 *   - No additional infrastructure (bridges, proxies, NFS mounts)
 *   - Works over any SSH-accessible network
 *   - Auth propagation via ~/.claude/.credentials.json copy
 *   - Each remote execution is fully isolated
 *
 * Limitations (POC):
 *   - No streaming progress events (future: NDJSON progress parsing)
 *   - No tool interception (canUseTool runs on remote host)
 *   - Session resume requires the session to exist on the remote host
 */

import { type ChildProcess, spawn } from "node:child_process";
import type {
  RuntimeResult,
  RuntimeTaskConfig,
  RuntimeUsage,
  SdkAgentRuntime,
  SdkExecutionCallbacks,
  SpawnConfig,
} from "../types";

/** Default SSH connection timeout in milliseconds. */
const SSH_CONNECT_TIMEOUT_MS = 10_000;

/** Default remote execution timeout (10 minutes). */
const REMOTE_EXEC_TIMEOUT_MS = 600_000;

/**
 * Remote host configuration for SDK worker dispatch.
 */
export interface RemoteHostConfig {
  /** Hostname or IP address (e.g., "192.168.86.143" or "dynamo"). */
  host: string;
  /** SSH port. Default: 22. */
  port?: number;
  /** SSH user. Default: current user. */
  user?: string;
  /** Path to SSH identity file. Default: system default. */
  identityFile?: string;
  /** Working directory on the remote host. */
  remoteCwd?: string;
  /** Node.js binary path on the remote host. Default: "node". */
  remoteNodePath?: string;
  /** Labels for node selection (e.g., "gpu", "high-memory"). */
  labels?: string[];
  /** Available memory in GB (advisory, for routing decisions). */
  memoryGb?: number;
  /** Whether the host has CUDA GPUs. */
  hasGpu?: boolean;
}

/**
 * NDJSON event from the remote shim script.
 * Mirrors a subset of SDKMessage fields relevant to result extraction.
 */
interface RemoteNdjsonEvent {
  type: string;
  subtype?: string;
  result?: string;
  errors?: string[];
  session_id?: string;
  model?: string;
  claude_code_version?: string;
  total_cost_usd?: number;
  num_turns?: number;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    cache_read_input_tokens?: number;
    cache_creation_input_tokens?: number;
  };
  modelUsage?: Record<string, { costUSD?: number }>;
  message?: {
    content?: Array<{ type?: string; text?: string }>;
    usage?: {
      input_tokens?: number;
      output_tokens?: number;
      cache_read_input_tokens?: number;
      cache_creation_input_tokens?: number;
    };
  };
  error?: string;
}

/**
 * Remote SDK runtime adapter.
 *
 * Executes SDK workers on remote hosts via SSH. The orchestrator remains
 * local; only the worker execution is remote. Results stream back over
 * SSH stdout as NDJSON.
 */
export class RemoteSdkRuntime implements SdkAgentRuntime {
  readonly id: string;
  readonly displayName: string;
  readonly tier = "sdk" as const;
  readonly telemetryTier = "gold" as const;

  private readonly hostConfig: RemoteHostConfig;
  private _versionResolved = false;
  private _cachedVersion: string | null = null;

  constructor(hostConfig: RemoteHostConfig) {
    this.hostConfig = hostConfig;
    this.id = `sdk:remote:${hostConfig.host}`;
    this.displayName = `Claude SDK (${hostConfig.host})`;
  }

  getVersion(): string | null {
    return this._cachedVersion;
  }

  /** Internal setter for version caching. */
  _setVersion(version: string): void {
    if (!this._versionResolved) {
      this._cachedVersion = version;
      this._versionResolved = true;
    }
  }

  isAvailable(): boolean {
    // Remote availability requires SSH connectivity check.
    // For the POC, we assume availability and fail at execution time.
    return true;
  }

  buildSpawnConfig(_config: RuntimeTaskConfig): SpawnConfig {
    throw new Error(
      "RemoteSdkRuntime uses executeTask() for remote execution. " +
        "The dispatcher routes SDK runtimes through isSdkRuntime().",
    );
  }

  parseResult(_stdout: string, _stderr: string, _exitCode: number, _resultFile: string | null): RuntimeResult {
    throw new Error(
      "RemoteSdkRuntime uses executeTask() for remote execution. " +
        "The dispatcher routes SDK runtimes through isSdkRuntime().",
    );
  }

  async executeTask(config: RuntimeTaskConfig, callbacks?: SdkExecutionCallbacks): Promise<RuntimeResult> {
    const shimScript = buildRemoteShimScript(config, this.hostConfig);
    const sshArgs = this.buildSshArgs(shimScript);

    return new Promise<RuntimeResult>((resolve) => {
      const proc = spawn("ssh", sshArgs, {
        stdio: ["ignore", "pipe", "pipe"],
        env: process.env,
      });

      const state = new RemoteExecutionState(this, callbacks);

      // Forward abort signal.
      if (callbacks?.signal) {
        const onAbort = () => {
          try {
            proc.kill("SIGTERM");
          } catch {
            // Process may already be dead.
          }
        };
        if (callbacks.signal.aborted) {
          onAbort();
        } else {
          callbacks.signal.addEventListener("abort", onAbort, { once: true });
        }
      }

      // Execution timeout.
      const timeoutMs = config.timeoutMs || REMOTE_EXEC_TIMEOUT_MS;
      let timeoutTimer: NodeJS.Timeout | null = null;
      if (timeoutMs > 0) {
        timeoutTimer = setTimeout(() => {
          state.timedOut = true;
          try {
            proc.kill("SIGTERM");
          } catch {
            // ignore
          }
        }, timeoutMs);
        timeoutTimer.unref();
      }

      let buffer = "";
      let stderr = "";

      proc.stdout?.on("data", (data: Buffer) => {
        buffer += data.toString();
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";
        for (const line of lines) {
          state.processLine(line);
        }
      });

      proc.stderr?.on("data", (data: Buffer) => {
        stderr += data.toString();
      });

      proc.on("close", (code) => {
        if (timeoutTimer) clearTimeout(timeoutTimer);
        if (buffer.trim()) state.processLine(buffer);

        const result = state.toRuntimeResult(this.id, code ?? 0, stderr);
        resolve(result);
      });

      proc.on("error", (err) => {
        if (timeoutTimer) clearTimeout(timeoutTimer);
        resolve({
          exitCode: 1,
          result: "",
          error: `SSH connection failed: ${err.message}`,
          usage: emptyUsage(),
          model: null,
          runtime: this.id,
        });
      });
    });
  }

  /**
   * Check if the remote host is reachable and has Claude Code installed.
   * Returns null on success, or an error message on failure.
   */
  async checkRemoteHealth(): Promise<string | null> {
    const sshArgs = this.buildSshArgs("claude --version 2>/dev/null || echo 'NOT_INSTALLED'");

    return new Promise<string | null>((resolve) => {
      const proc = spawn("ssh", sshArgs, {
        stdio: ["ignore", "pipe", "pipe"],
        env: process.env,
      });

      let stdout = "";
      const timeout = setTimeout(() => {
        try {
          proc.kill("SIGTERM");
        } catch {
          // ignore
        }
        resolve(`SSH connection to ${this.hostConfig.host} timed out.`);
      }, SSH_CONNECT_TIMEOUT_MS);
      timeout.unref();

      proc.stdout?.on("data", (data: Buffer) => {
        stdout += data.toString();
      });

      proc.on("close", (code) => {
        clearTimeout(timeout);
        if (code !== 0) {
          resolve(`SSH to ${this.hostConfig.host} failed (exit ${code}).`);
          return;
        }
        if (stdout.includes("NOT_INSTALLED")) {
          resolve(`Claude Code is not installed on ${this.hostConfig.host}.`);
          return;
        }
        // Cache version from output.
        const versionMatch = stdout.match(/(\d+\.\d+\.\d+)/);
        if (versionMatch) {
          this._setVersion(`v${versionMatch[1]}`);
        }
        resolve(null);
      });

      proc.on("error", (err) => {
        clearTimeout(timeout);
        resolve(`SSH connection error: ${err.message}`);
      });
    });
  }

  private buildSshArgs(remoteCommand: string): string[] {
    const args: string[] = [];

    // Connection settings.
    args.push("-o", "StrictHostKeyChecking=accept-new");
    args.push("-o", `ConnectTimeout=${Math.ceil(SSH_CONNECT_TIMEOUT_MS / 1000)}`);
    args.push("-o", "BatchMode=yes");

    // Port.
    if (this.hostConfig.port && this.hostConfig.port !== 22) {
      args.push("-p", String(this.hostConfig.port));
    }

    // Identity file.
    if (this.hostConfig.identityFile) {
      args.push("-i", this.hostConfig.identityFile);
    }

    // User@host.
    const target = this.hostConfig.user ? `${this.hostConfig.user}@${this.hostConfig.host}` : this.hostConfig.host;
    args.push(target);

    // Remote command.
    args.push(remoteCommand);

    return args;
  }
}

// ---------------------------------------------------------------------------
// Remote execution state tracker
// ---------------------------------------------------------------------------

/**
 * Tracks state from NDJSON events received over SSH stdout.
 * Similar to ExecutionTracker in claude-sdk.ts but operates on raw JSON
 * instead of typed SDKMessage objects.
 */
class RemoteExecutionState {
  private resultText = "";
  private errorText = "";
  private model: string | null = null;
  private sessionId: string | null = null;
  private inputTokens = 0;
  private outputTokens = 0;
  private cacheReadTokens = 0;
  private cacheWriteTokens = 0;
  private cost = 0;
  private turns = 0;

  timedOut = false;

  constructor(
    private readonly runtime: RemoteSdkRuntime,
    private readonly _callbacks?: SdkExecutionCallbacks,
  ) {}

  processLine(line: string): void {
    const trimmed = line.trim();
    if (!trimmed || trimmed[0] !== "{") return;

    let event: RemoteNdjsonEvent;
    try {
      event = JSON.parse(trimmed) as RemoteNdjsonEvent;
    } catch {
      return;
    }

    switch (event.type) {
      case "system":
        this.handleSystem(event);
        break;
      case "assistant":
        this.handleAssistant(event);
        break;
      case "result":
        this.handleResult(event);
        break;
      default:
        break;
    }
  }

  toRuntimeResult(runtimeId: string, exitCode: number, stderr: string): RuntimeResult {
    // If SSH itself failed, surface stderr as the error.
    if (exitCode !== 0 && !this.errorText && stderr.trim()) {
      this.errorText = `Remote execution failed: ${stderr.trim().slice(0, 500)}`;
    }

    if (this.timedOut && !this.errorText) {
      this.errorText = "Remote worker killed: timeout exceeded.";
    }

    const usage: RuntimeUsage = {
      inputTokens: this.inputTokens || null,
      outputTokens: this.outputTokens || null,
      cacheReadTokens: this.cacheReadTokens || null,
      cacheWriteTokens: this.cacheWriteTokens || null,
      cost: this.cost || null,
      turns: this.turns || null,
    };

    return {
      exitCode: this.errorText ? 1 : exitCode,
      result: this.resultText,
      error: this.errorText,
      usage,
      model: this.model,
      runtime: runtimeId,
      sessionMeta: this.sessionId ? { sessionId: this.sessionId } : undefined,
    };
  }

  private handleSystem(event: RemoteNdjsonEvent): void {
    if (event.subtype === "init") {
      if (event.model) this.model = event.model;
      if (event.session_id) this.sessionId = event.session_id;
      if (event.claude_code_version) {
        this.runtime._setVersion(`v${event.claude_code_version}`);
      }
    }
  }

  private handleAssistant(event: RemoteNdjsonEvent): void {
    if (!event.session_id && !this.sessionId) {
      this.sessionId = event.session_id ?? null;
    }

    if (event.message?.content && Array.isArray(event.message.content)) {
      const textParts: string[] = [];
      for (const block of event.message.content) {
        if (block.type === "text" && typeof block.text === "string") {
          textParts.push(block.text);
        }
      }
      if (textParts.length > 0) {
        this.resultText = textParts.join("");
      }
    }

    const usage = event.message?.usage;
    if (usage) {
      this.inputTokens += usage.input_tokens ?? 0;
      this.outputTokens += usage.output_tokens ?? 0;
      this.cacheReadTokens += usage.cache_read_input_tokens ?? 0;
      this.cacheWriteTokens += usage.cache_creation_input_tokens ?? 0;
    }

    this.turns++;

    if (event.error) {
      this.errorText = `Remote SDK error: ${event.error}`;
    }
  }

  private handleResult(event: RemoteNdjsonEvent): void {
    if (event.subtype === "success") {
      if (event.result) this.resultText = event.result;
    } else {
      this.errorText = event.errors?.join("; ") || `Remote SDK execution failed: ${event.subtype}`;
    }

    if (event.usage) {
      this.inputTokens = event.usage.input_tokens ?? this.inputTokens;
      this.outputTokens = event.usage.output_tokens ?? this.outputTokens;
      this.cacheReadTokens = event.usage.cache_read_input_tokens ?? this.cacheReadTokens;
      this.cacheWriteTokens = event.usage.cache_creation_input_tokens ?? this.cacheWriteTokens;
    }
    if (typeof event.total_cost_usd === "number") {
      this.cost = event.total_cost_usd;
    }
    if (typeof event.num_turns === "number") {
      this.turns = event.num_turns;
    }
    if (event.session_id) {
      this.sessionId = event.session_id;
    }
    if (!this.model && event.modelUsage) {
      const modelKeys = Object.keys(event.modelUsage);
      if (modelKeys.length > 0) {
        this.model = modelKeys[0].replace(/\[.*\]$/, "");
      }
    }
    if (this.cost === 0 && event.modelUsage) {
      for (const mu of Object.values(event.modelUsage)) {
        this.cost += mu.costUSD ?? 0;
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Remote shim script generation
// ---------------------------------------------------------------------------

/**
 * Build the remote Node.js shim script that runs the SDK query on the
 * remote host and streams events as NDJSON to stdout.
 *
 * The script is passed inline to SSH so no file deployment is needed.
 * It uses the SDK's query() function with the same options PanCode would
 * use locally, minus tool interception (runs in bypassPermissions mode).
 */
function buildRemoteShimScript(config: RuntimeTaskConfig, hostConfig: RemoteHostConfig): string {
  // Escape the task string for embedding in a shell heredoc.
  const escapedTask = config.task.replace(/'/g, "'\\''");
  const escapedSystemPrompt = config.systemPrompt?.replace(/'/g, "'\\''") ?? "";
  const remoteCwd = hostConfig.remoteCwd ?? process.cwd();
  const model = config.model ?? "";
  const maxTurns = 30;

  // Parse max turns from runtimeArgs.
  const maxTurnsIdx = config.runtimeArgs.indexOf("--max-turns");
  const parsedMaxTurns =
    maxTurnsIdx !== -1 && config.runtimeArgs[maxTurnsIdx + 1]
      ? Number.parseInt(config.runtimeArgs[maxTurnsIdx + 1], 10)
      : maxTurns;

  // Parse budget from runtimeArgs.
  const budgetIdx = config.runtimeArgs.indexOf("--max-budget");
  const maxBudget =
    budgetIdx !== -1 && config.runtimeArgs[budgetIdx + 1] ? Number.parseFloat(config.runtimeArgs[budgetIdx + 1]) : 0;

  const nodeBin = hostConfig.remoteNodePath ?? "node";

  // The shim script imports the SDK, runs query(), and writes each
  // SDKMessage as a JSON line to stdout. Stderr is used for debug logging.
  return `${nodeBin} -e '
const { query } = require("@anthropic-ai/claude-agent-sdk");
const options = {
  cwd: ${JSON.stringify(remoteCwd)},
  permissionMode: "bypassPermissions",
  allowDangerouslySkipPermissions: true,
  persistSession: true,
  maxTurns: ${parsedMaxTurns},
  ${model ? `model: ${JSON.stringify(model)},` : ""}
  ${maxBudget > 0 ? `maxBudgetUsd: ${maxBudget},` : ""}
  ${escapedSystemPrompt ? `systemPrompt: { type: "preset", preset: "claude_code", append: ${JSON.stringify(escapedSystemPrompt)} },` : ""}
  env: { ...process.env, CLAUDE_AGENT_SDK_CLIENT_APP: "pancode/0.3.0-remote" },
};
(async () => {
  try {
    const q = query({ prompt: ${JSON.stringify(escapedTask)}, options });
    for await (const msg of q) {
      process.stdout.write(JSON.stringify(msg) + "\\n");
    }
    q.close();
  } catch (err) {
    process.stdout.write(JSON.stringify({ type: "result", subtype: "error_during_execution", errors: [err.message], total_cost_usd: 0, num_turns: 0, usage: {} }) + "\\n");
    process.exit(1);
  }
})();
'`;
}

// ---------------------------------------------------------------------------
// Node selection for remote dispatch
// ---------------------------------------------------------------------------

/**
 * Node selection criteria for routing workers to specific remote hosts.
 */
export interface NodeSelectionCriteria {
  /** Minimum memory in GB. */
  minMemoryGb?: number;
  /** Require GPU. */
  requireGpu?: boolean;
  /** Required labels (all must match). */
  requiredLabels?: string[];
  /** Preferred host (soft preference, not required). */
  preferredHost?: string;
}

/**
 * Select the best remote host from a set of candidates based on criteria.
 * Returns null if no host matches the requirements.
 */
export function selectRemoteHost(hosts: RemoteHostConfig[], criteria: NodeSelectionCriteria): RemoteHostConfig | null {
  const candidates = hosts.filter((h) => {
    // Hard requirement: minimum memory.
    if (criteria.minMemoryGb && h.memoryGb && h.memoryGb < criteria.minMemoryGb) {
      return false;
    }
    // Hard requirement: GPU.
    if (criteria.requireGpu && !h.hasGpu) {
      return false;
    }
    // Hard requirement: all required labels present.
    if (criteria.requiredLabels) {
      const hostLabels = new Set(h.labels ?? []);
      if (!criteria.requiredLabels.every((l) => hostLabels.has(l))) {
        return false;
      }
    }
    return true;
  });

  if (candidates.length === 0) return null;

  // Soft preference: preferred host.
  if (criteria.preferredHost) {
    const preferred = candidates.find((h) => h.host === criteria.preferredHost);
    if (preferred) return preferred;
  }

  // Score by memory (higher is better).
  candidates.sort((a, b) => (b.memoryGb ?? 0) - (a.memoryGb ?? 0));
  return candidates[0];
}

/**
 * PanCode homelab node inventory (default configuration).
 * Override with PANCODE_REMOTE_HOSTS env var (JSON array of RemoteHostConfig).
 */
export function getHomelabNodes(): RemoteHostConfig[] {
  const envHosts = process.env.PANCODE_REMOTE_HOSTS;
  if (envHosts) {
    try {
      return JSON.parse(envHosts) as RemoteHostConfig[];
    } catch {
      console.error("[pancode:remote] Failed to parse PANCODE_REMOTE_HOSTS. Using defaults.");
    }
  }

  return [
    {
      host: "192.168.86.140",
      user: "akougkas",
      remoteCwd: "/home/akougkas/projects",
      labels: ["orchestrator"],
      memoryGb: 32,
      hasGpu: false,
    },
    {
      host: "192.168.86.141",
      user: "akougkas",
      remoteCwd: "/home/akougkas/projects",
      labels: ["orchestrator", "llm-server"],
      memoryGb: 32,
      hasGpu: false,
    },
    {
      host: "192.168.86.143",
      user: "akougkas",
      remoteCwd: "/home/akougkas/projects",
      labels: ["worker", "gpu", "llm-server"],
      memoryGb: 64,
      hasGpu: true,
    },
    {
      host: "192.168.86.249",
      user: "akougkas",
      remoteCwd: "/home/akougkas/projects",
      labels: ["worker", "high-memory"],
      memoryGb: 128,
      hasGpu: false,
    },
  ];
}

function emptyUsage(): RuntimeUsage {
  return {
    inputTokens: null,
    outputTokens: null,
    cacheReadTokens: null,
    cacheWriteTokens: null,
    cost: null,
    turns: null,
  };
}
