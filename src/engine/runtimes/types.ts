/**
 * Telemetry tier classification for runtime adapters.
 *
 * Platinum: full structured output with all usage fields (Pi native).
 * Gold: structured JSON with tokens, cost, model, and turns (Claude Code, OpenCode).
 * Silver: partial structured output, some fields missing (Codex, Gemini, Cline).
 * Bronze: text-only output, no usage extraction (Copilot CLI).
 */
export type TelemetryTier = "platinum" | "gold" | "silver" | "bronze";

/**
 * Token and cost usage from a runtime execution.
 *
 * Fields are nullable: `null` means the runtime did not report this field.
 * `0` means the runtime reported zero tokens or zero cost.
 * Consumers must handle null gracefully (render as "--", skip in aggregation).
 */
export interface RuntimeUsage {
  inputTokens: number | null;
  outputTokens: number | null;
  cacheReadTokens: number | null;
  cacheWriteTokens: number | null;
  cost: number | null;
  turns: number | null;
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
  /** Session metadata for continuity across dispatches (taskId, sessionId). */
  sessionMeta?: { taskId?: string; sessionId?: string };
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

  /** Telemetry quality tier: how much usage data this runtime can report */
  readonly telemetryTier: TelemetryTier;

  /** Return the runtime version string, or null if unknown */
  getVersion(): string | null;

  /** Check if this runtime is available on the current system */
  isAvailable(): boolean;

  /** Build the subprocess spawn configuration for a task */
  buildSpawnConfig(config: RuntimeTaskConfig): SpawnConfig;

  /** Parse stdout + result file into a RuntimeResult */
  parseResult(stdout: string, stderr: string, exitCode: number, resultFile: string | null): RuntimeResult;
}

// ---------------------------------------------------------------------------
// SDK runtime extensions
// ---------------------------------------------------------------------------

/**
 * Progress event emitted by SDK runtimes during in-process execution.
 * Maps to WorkerProgressEvent on the bus via the dispatcher.
 */
export interface SdkProgressEvent {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  cost: number;
  turns: number;
  currentTool: string | null;
  currentToolArgs: string | null;
  recentTools: string[];
  toolCount: number;
  textDelta?: string;
}

/**
 * Subagent progress event from the SDK's agentProgressSummaries feature.
 * Emitted when a subagent periodically reports its status.
 */
export interface SdkTaskProgressEvent {
  taskId: string;
  description: string;
  summary: string;
  usage: { total_tokens: number; tool_uses: number; duration_ms: number };
  lastToolName: string | null;
}

/**
 * Callbacks for SDK runtime in-process execution. The dispatcher provides
 * these so SDK runtimes can report progress and request tool approvals.
 */
export interface SdkExecutionCallbacks {
  onProgress?: (progress: SdkProgressEvent) => void;
  onTaskProgress?: (progress: SdkTaskProgressEvent) => void;
  onToolApproval?: (toolName: string, input: Record<string, unknown>) => Promise<boolean>;
  signal?: AbortSignal;
}

/**
 * An SDK runtime executes tasks in-process through a programmatic API
 * instead of spawning subprocesses. Provides streaming, tool interception,
 * and session management. The dispatcher detects this interface via
 * isSdkRuntime() and routes to executeTask() instead of subprocess spawn.
 */
export interface SdkAgentRuntime extends AgentRuntime {
  executeTask(config: RuntimeTaskConfig, callbacks?: SdkExecutionCallbacks): Promise<RuntimeResult>;
}

/** Type guard: true when the runtime supports in-process SDK execution. */
export function isSdkRuntime(runtime: AgentRuntime): runtime is SdkAgentRuntime {
  return runtime.tier === "sdk" && "executeTask" in runtime;
}
