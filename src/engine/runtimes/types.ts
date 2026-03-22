export interface RuntimeUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  cost: number;
  turns: number;
}

export interface RuntimeSamplingConfig {
  temperature: number;
  top_p: number;
  top_k: number;
  presence_penalty: number;
}

/**
 * Configuration passed to a runtime when spawning a worker.
 * Runtime-agnostic: every runtime receives the same shape.
 */
export interface RuntimeTaskConfig {
  task: string;
  tools: string; // CSV tool allowlist
  model: string | null;
  systemPrompt: string;
  cwd: string;
  agentName: string;
  readonly: boolean;
  runtimeArgs: string[]; // Extra args from agent spec
  timeoutMs: number;
  sampling?: RuntimeSamplingConfig | null;
  runId?: string;
}

/**
 * Subprocess spawn configuration returned by a runtime adapter.
 * The dispatcher uses this to spawn the actual process.
 */
export interface SpawnConfig {
  command: string; // Binary to execute ("node", "claude", "codex", etc.)
  args: string[]; // CLI arguments
  env: Record<string, string>; // Environment variables (merged with process.env)
  cwd: string;
  resultFile?: string; // Optional file where runtime writes structured result
  outputFormat: "ndjson" | "text" | "json"; // How to parse stdout
}

/**
 * Parsed result from a runtime execution.
 * Same shape as the existing WorkerResult from dispatch.
 */
export interface RuntimeResult {
  exitCode: number;
  result: string; // Assistant text output
  error: string; // Error message if failed
  usage: RuntimeUsage; // Token counts (zeros for runtimes that don't report)
  model: string | null; // Model used (null if unknown)
  runtime: string; // Which runtime produced this result
}

/**
 * An agent runtime knows how to spawn and parse results from a specific
 * agent tool. Each runtime is a thin adapter: build args, parse output.
 */
export interface AgentRuntime {
  /** Unique identifier: "pi", "cli:claude-code", "cli:codex", etc. */
  readonly id: string;

  /** Human-readable display name */
  readonly displayName: string;

  /** Runtime tier: "native" (Pi), "cli" (headless invocation), "sdk" (programmatic) */
  readonly tier: "native" | "cli" | "sdk";

  /** Return the runtime version string, or null if unknown */
  getVersion(): string | null;

  /** Check if this runtime is available on the current system */
  isAvailable(): boolean;

  /** Build the subprocess spawn configuration for a task */
  buildSpawnConfig(config: RuntimeTaskConfig): SpawnConfig;

  /** Parse stdout + result file into a RuntimeResult */
  parseResult(stdout: string, stderr: string, exitCode: number, resultFile: string | null): RuntimeResult;
}
