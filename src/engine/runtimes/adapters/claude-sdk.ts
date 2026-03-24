import {
  type AgentDefinition,
  type Options,
  type Query,
  type SDKAssistantMessage,
  type SDKMessage,
  type SDKPartialAssistantMessage,
  type SDKResultError,
  type SDKResultSuccess,
  type SDKSystemMessage,
  type SDKTaskProgressMessage,
  query,
} from "@anthropic-ai/claude-agent-sdk";
import { binaryExists } from "../cli-base";
import type {
  RuntimeResult,
  RuntimeTaskConfig,
  RuntimeUsage,
  SdkAgentRuntime,
  SdkExecutionCallbacks,
  SpawnConfig,
} from "../types";

/** Default maximum agent turns before the SDK stops. Prevents runaway workers. */
const DEFAULT_MAX_TURNS = 30;

/** Maximum length for tool argument preview strings. */
const MAX_TOOL_ARGS_PREVIEW = 120;

/** Maximum recent tools in the ring buffer. */
const MAX_RECENT_TOOLS = 5;

const isVerbose = () => !!process.env.PANCODE_VERBOSE;

// ---------------------------------------------------------------------------
// PanCode tool name to Claude Code tool name mapping
// ---------------------------------------------------------------------------

const TOOL_MAP: Record<string, string> = {
  read: "Read",
  write: "Write",
  edit: "Edit",
  bash: "Bash",
  grep: "Grep",
  find: "Glob",
  ls: "Glob",
};

const READ_ONLY_TOOLS = ["Read", "Grep", "Glob"];

// ---------------------------------------------------------------------------
// Runtime adapter
// ---------------------------------------------------------------------------

/**
 * Claude Agent SDK runtime adapter (Platinum Tier).
 *
 * Executes tasks in-process via the official @anthropic-ai/claude-agent-sdk
 * query() function. The SDK internally spawns a Claude Code subprocess, so
 * worker isolation is maintained. PanCode gains streaming events, tool
 * interception, session management, and authoritative usage tracking.
 *
 * Platinum tier: real-time streaming with full usage fields (input/output
 * tokens, cache tokens, cost, turns, model, session ID).
 */
export class ClaudeSdkRuntime implements SdkAgentRuntime {
  readonly id = "sdk:claude-code";
  readonly displayName = "Claude Code SDK";
  readonly tier = "sdk" as const;
  readonly telemetryTier = "platinum" as const;

  private _versionResolved = false;
  private _cachedVersion: string | null = null;

  getVersion(): string | null {
    return this._cachedVersion;
  }

  isAvailable(): boolean {
    return binaryExists("claude");
  }

  buildSpawnConfig(_config: RuntimeTaskConfig): SpawnConfig {
    throw new Error(
      "ClaudeSdkRuntime uses executeTask() for in-process execution. " +
        "The dispatcher routes SDK runtimes through isSdkRuntime(). " +
        "Use cli:claude-code for subprocess spawning.",
    );
  }

  parseResult(_stdout: string, _stderr: string, _exitCode: number, _resultFile: string | null): RuntimeResult {
    throw new Error(
      "ClaudeSdkRuntime uses executeTask() for in-process execution. " +
        "The dispatcher routes SDK runtimes through isSdkRuntime(). " +
        "Use cli:claude-code for subprocess spawning.",
    );
  }

  /** Internal setter for version caching, called by ExecutionTracker. */
  _setVersion(version: string): void {
    if (!this._versionResolved) {
      this._cachedVersion = version;
      this._versionResolved = true;
    }
  }

  async executeTask(config: RuntimeTaskConfig, callbacks?: SdkExecutionCallbacks): Promise<RuntimeResult> {
    const abortController = new AbortController();

    // Forward external abort signal to the SDK's controller.
    if (callbacks?.signal) {
      if (callbacks.signal.aborted) {
        abortController.abort();
      } else {
        callbacks.signal.addEventListener("abort", () => abortController.abort(), { once: true });
      }
    }

    const options = this.buildSdkOptions(config, abortController, callbacks);
    const tracker = new ExecutionTracker(this, callbacks);

    let sdkQuery: Query | null = null;
    try {
      sdkQuery = query({ prompt: config.task, options });

      for await (const message of sdkQuery) {
        if (abortController.signal.aborted) break;
        tracker.handleMessage(message);
      }
    } catch (err: unknown) {
      tracker.recordError(err);
    } finally {
      if (sdkQuery) {
        try {
          sdkQuery.close();
        } catch {
          // Already closed or errored; safe to ignore.
        }
      }
    }

    return tracker.toRuntimeResult(this.id);
  }

  // -------------------------------------------------------------------------
  // SDK options construction
  // -------------------------------------------------------------------------

  private buildSdkOptions(
    config: RuntimeTaskConfig,
    abortController: AbortController,
    callbacks?: SdkExecutionCallbacks,
  ): Options {
    const options: Options = {
      abortController,
      cwd: config.cwd,
      includePartialMessages: true,
      settingSources: ["user", "project", "local"],
      persistSession: true,
      agentProgressSummaries: true,
      env: {
        ...process.env,
        CLAUDE_AGENT_SDK_CLIENT_APP: "pancode/0.3.0",
      },
    };

    // Model selection.
    if (config.model) {
      options.model = config.model;
    }

    // Turn limit. Parse from runtimeArgs or use default.
    const maxTurnsIdx = config.runtimeArgs.indexOf("--max-turns");
    if (maxTurnsIdx !== -1 && config.runtimeArgs[maxTurnsIdx + 1]) {
      options.maxTurns = Number.parseInt(config.runtimeArgs[maxTurnsIdx + 1], 10);
    } else {
      options.maxTurns = DEFAULT_MAX_TURNS;
    }

    // Budget cap from runtimeArgs.
    const budgetIdx = config.runtimeArgs.indexOf("--max-budget");
    if (budgetIdx !== -1 && config.runtimeArgs[budgetIdx + 1]) {
      options.maxBudgetUsd = Number.parseFloat(config.runtimeArgs[budgetIdx + 1]);
    }

    // Effort level from runtimeArgs.
    const effortIdx = config.runtimeArgs.indexOf("--effort");
    if (effortIdx !== -1 && config.runtimeArgs[effortIdx + 1]) {
      const effort = config.runtimeArgs[effortIdx + 1] as "low" | "medium" | "high" | "max";
      if (["low", "medium", "high", "max"].includes(effort)) {
        options.effort = effort;
      }
    }

    // Tool configuration.
    if (config.readonly) {
      options.allowedTools = [...READ_ONLY_TOOLS];
      options.tools = [...READ_ONLY_TOOLS];
      options.permissionMode = "plan";
    } else if (config.tools) {
      const mapped = config.tools
        .split(",")
        .map((t) => TOOL_MAP[t.trim()])
        .filter(Boolean);
      const deduped = [...new Set(mapped)];
      if (deduped.length > 0) {
        options.allowedTools = deduped;
        options.tools = deduped;
      }
      options.permissionMode = "bypassPermissions";
      options.allowDangerouslySkipPermissions = true;
    } else {
      options.permissionMode = "bypassPermissions";
      options.allowDangerouslySkipPermissions = true;
    }

    // System prompt: append PanCode worker instructions to Claude Code's
    // built-in system prompt, preserving native tool descriptions.
    if (config.systemPrompt) {
      options.systemPrompt = {
        type: "preset",
        preset: "claude_code",
        append: config.systemPrompt,
      };
    }

    // Session resume from runtimeArgs (injected by session-continuity).
    const resumeIdx = config.runtimeArgs.indexOf("--resume");
    if (resumeIdx !== -1 && config.runtimeArgs[resumeIdx + 1]) {
      options.resume = config.runtimeArgs[resumeIdx + 1];
    }

    // Precise resume point from runtimeArgs.
    const resumeAtIdx = config.runtimeArgs.indexOf("--resume-at");
    if (resumeAtIdx !== -1 && config.runtimeArgs[resumeAtIdx + 1]) {
      options.resumeSessionAt = config.runtimeArgs[resumeAtIdx + 1];
    }

    // Subagent definitions from runtimeArgs (JSON-encoded).
    const agentsIdx = config.runtimeArgs.indexOf("--sdk-agents");
    if (agentsIdx !== -1 && config.runtimeArgs[agentsIdx + 1]) {
      try {
        const agents = JSON.parse(config.runtimeArgs[agentsIdx + 1]) as Record<string, AgentDefinition>;
        options.agents = agents;
      } catch {
        if (isVerbose()) {
          console.error("[pancode:sdk] Failed to parse --sdk-agents JSON.");
        }
      }
    }

    // Human-in-the-loop tool approval callback.
    if (callbacks?.onToolApproval) {
      const approvalFn = callbacks.onToolApproval;
      options.canUseTool = async (toolName, input, opts) => {
        // Respect the SDK's abort signal for this specific tool call.
        if (opts.signal.aborted) {
          return { behavior: "deny", message: "Operation cancelled." };
        }
        const approved = await approvalFn(toolName, input);
        // Re-check after the async approval decision.
        if (opts.signal.aborted) {
          return { behavior: "deny", message: "Operation cancelled." };
        }
        if (approved) {
          return { behavior: "allow", updatedInput: input };
        }
        return { behavior: "deny", message: "Denied by PanCode dispatcher." };
      };
    }

    return options;
  }
}

// ---------------------------------------------------------------------------
// Execution state tracker
// ---------------------------------------------------------------------------

/**
 * Tracks execution state across the SDK's async message stream.
 * Accumulates text, usage, tool tracking, and errors, then produces
 * a final RuntimeResult.
 *
 * Handles all SDKMessage union members:
 *   system (init, status, api_retry, task_progress, task_started,
 *           task_notification, compact_boundary, hook_*, files_persisted,
 *           local_command_output, elicitation_complete)
 *   stream_event (text_delta, thinking_delta)
 *   assistant (text + tool_use content blocks, per-turn usage)
 *   result (success or error with authoritative usage totals)
 *   user / user_replay (ignored, our own input)
 *   tool_progress, tool_use_summary (informational, logged if verbose)
 *   auth_status, rate_limit_event (diagnostic, logged if verbose)
 *   prompt_suggestion (informational)
 */
class ExecutionTracker {
  private resultText = "";
  private errorText = "";
  private model: string | null = null;
  private sessionId: string | null = null;

  // Usage accumulators (updated incrementally from assistant messages,
  // then overwritten with authoritative values from the result message).
  private inputTokens = 0;
  private outputTokens = 0;
  private cacheReadTokens = 0;
  private cacheWriteTokens = 0;
  private cost = 0;
  private turns = 0;

  // Duration tracking from the result message.
  private durationMs = 0;
  private durationApiMs = 0;

  // Tool tracking for progress events.
  private currentTool: string | null = null;
  private currentToolArgs: string | null = null;
  private readonly recentTools: string[] = [];
  private toolCount = 0;

  constructor(
    private readonly runtime: ClaudeSdkRuntime,
    private readonly callbacks?: SdkExecutionCallbacks,
  ) {}

  handleMessage(message: SDKMessage): void {
    switch (message.type) {
      case "system":
        this.handleSystemMessage(message);
        break;
      case "stream_event":
        this.handleStreamEvent(message as SDKPartialAssistantMessage);
        break;
      case "assistant":
        this.handleAssistantMessage(message as SDKAssistantMessage);
        break;
      case "result":
        this.handleResultMessage(message as SDKResultSuccess | SDKResultError);
        break;
      case "user":
        // Our own input echo or replay; no action needed.
        break;
      case "tool_progress":
        this.handleToolProgress(message);
        break;
      case "tool_use_summary":
        if (isVerbose()) {
          const summary = message as { summary?: string };
          console.error(`[pancode:sdk] Tool summary: ${summary.summary ?? "none"}`);
        }
        break;
      case "auth_status":
        this.handleAuthStatus(message);
        break;
      case "rate_limit_event":
        this.handleRateLimitEvent(message);
        break;
      case "prompt_suggestion":
        // Informational; no state mutation needed.
        break;
      default:
        if (isVerbose()) {
          console.error(`[pancode:sdk] Unhandled message type: ${(message as { type: string }).type}`);
        }
        break;
    }
  }

  recordError(err: unknown): void {
    if (!this.errorText) {
      this.errorText = err instanceof Error ? err.message : String(err);
    }
  }

  toRuntimeResult(runtimeId: string): RuntimeResult {
    const usage: RuntimeUsage = {
      inputTokens: this.inputTokens || null,
      outputTokens: this.outputTokens || null,
      cacheReadTokens: this.cacheReadTokens || null,
      cacheWriteTokens: this.cacheWriteTokens || null,
      cost: this.cost || null,
      turns: this.turns || null,
    };

    return {
      exitCode: this.errorText ? 1 : 0,
      result: this.resultText,
      error: this.errorText,
      usage,
      model: this.model,
      runtime: runtimeId,
      sessionMeta: this.sessionId ? { sessionId: this.sessionId } : undefined,
    };
  }

  // -----------------------------------------------------------------------
  // System message routing
  // -----------------------------------------------------------------------

  private handleSystemMessage(msg: SDKMessage): void {
    // All system-typed messages share { type: "system", subtype: string }.
    const base = msg as { type: "system"; subtype: string; session_id?: string };

    // Capture session_id from any system message that carries it.
    if (base.session_id && !this.sessionId) {
      this.sessionId = base.session_id;
    }

    switch (base.subtype) {
      case "init":
        this.handleInitMessage(msg as SDKSystemMessage);
        break;
      case "api_retry":
        this.handleApiRetry(msg);
        break;
      case "task_progress":
        this.handleTaskProgress(msg as SDKTaskProgressMessage);
        break;
      case "task_started":
        if (isVerbose()) {
          const started = msg as { task_id?: string; description?: string };
          console.error(`[pancode:sdk] Subagent started: ${started.task_id} ${started.description ?? ""}`);
        }
        break;
      case "task_notification":
        this.handleTaskNotification(msg);
        break;
      case "status":
        // Informational status updates (e.g., "working", "idle").
        break;
      case "compact_boundary":
        // Context window compaction occurred. Log if verbose.
        if (isVerbose()) {
          console.error("[pancode:sdk] Context compaction boundary reached.");
        }
        break;
      default:
        // hook_started, hook_progress, hook_response, files_persisted,
        // local_command_output, elicitation_complete: informational.
        break;
    }
  }

  private handleInitMessage(msg: SDKSystemMessage): void {
    if (msg.model) this.model = msg.model;
    this.sessionId = msg.session_id ?? null;

    // Cache the Claude Code version on first init message.
    if (msg.claude_code_version) {
      this.runtime._setVersion(`v${msg.claude_code_version}`);
    }
  }

  private handleApiRetry(msg: SDKMessage): void {
    const retry = msg as {
      attempt?: number;
      max_retries?: number;
      retry_delay_ms?: number;
      error_status?: number | null;
      error?: string;
    };
    if (isVerbose()) {
      console.error(
        `[pancode:sdk] API retry ${retry.attempt ?? "?"}/${retry.max_retries ?? "?"} ` +
          `(status=${retry.error_status ?? "?"}, delay=${retry.retry_delay_ms ?? "?"}ms)`,
      );
    }
  }

  private handleTaskProgress(msg: SDKTaskProgressMessage): void {
    // Subagent progress summaries when agentProgressSummaries is enabled.
    // Forward to the progress callback for TUI display.
    if (msg.summary) {
      this.callbacks?.onTaskProgress?.({
        taskId: msg.task_id,
        description: msg.description,
        summary: msg.summary,
        usage: msg.usage,
        lastToolName: msg.last_tool_name ?? null,
      });
    }
    if (isVerbose()) {
      console.error(`[pancode:sdk] Task progress: ${msg.task_id} ${msg.summary ?? msg.description}`);
    }
  }

  private handleTaskNotification(msg: SDKMessage): void {
    const notification = msg as {
      task_id?: string;
      status?: string;
      summary?: string;
      usage?: { total_tokens?: number; tool_uses?: number };
    };
    if (isVerbose()) {
      console.error(
        `[pancode:sdk] Task ${notification.status}: ${notification.task_id} ` +
          `(${notification.summary ?? "no summary"})`,
      );
    }
  }

  // -----------------------------------------------------------------------
  // Stream event handling
  // -----------------------------------------------------------------------

  private handleStreamEvent(msg: SDKPartialAssistantMessage): void {
    const event = msg.event;
    if (!event) return;

    // BetaRawMessageStreamEvent with type "content_block_delta"
    if (event.type === "content_block_delta") {
      const delta = (event as { delta?: { type?: string; text?: string } }).delta;
      if (delta?.type === "text_delta" && delta.text) {
        this.emitProgress({ textDelta: delta.text });
      }
      // Extended thinking models emit thinking_delta blocks.
      if (delta?.type === "thinking_delta" && delta.text) {
        this.emitProgress({ thinkingDelta: delta.text });
      }
    }
  }

  // -----------------------------------------------------------------------
  // Assistant message handling
  // -----------------------------------------------------------------------

  private handleAssistantMessage(msg: SDKAssistantMessage): void {
    if (!msg.message) return;

    // Capture session_id from the first assistant message if init didn't provide it.
    if (!this.sessionId && msg.session_id) {
      this.sessionId = msg.session_id;
    }

    // Extract text and tool_use blocks from content.
    const content = msg.message.content;
    if (Array.isArray(content)) {
      const textParts: string[] = [];
      for (const block of content) {
        if (block.type === "text" && "text" in block && typeof block.text === "string") {
          textParts.push(block.text);
        }
        if (block.type === "tool_use") {
          const toolBlock = block as { name?: string; input?: unknown };
          this.onToolStart(toolBlock.name ?? "unknown", toolBlock.input);
        }
      }
      if (textParts.length > 0) {
        this.resultText = textParts.join("");
      }
    }

    // Accumulate per-turn usage from the assistant message.
    const usage = msg.message.usage;
    if (usage) {
      this.inputTokens += usage.input_tokens ?? 0;
      this.outputTokens += usage.output_tokens ?? 0;
      this.cacheReadTokens += usage.cache_read_input_tokens ?? 0;
      this.cacheWriteTokens += usage.cache_creation_input_tokens ?? 0;
    }

    this.turns++;

    // Classify assistant errors.
    if (msg.error) {
      this.errorText = this.classifySdkError(msg.error);
    }

    // Rotate current tool to recent ring buffer.
    this.rotateCurrentTool();
    this.emitProgress();
  }

  // -----------------------------------------------------------------------
  // Result message handling
  // -----------------------------------------------------------------------

  private handleResultMessage(msg: SDKResultSuccess | SDKResultError): void {
    // The result message carries authoritative totals.
    if (msg.subtype === "success") {
      const success = msg as SDKResultSuccess;
      this.resultText = success.result ?? this.resultText;
    } else {
      const error = msg as SDKResultError;
      this.errorText = error.errors?.join("; ") || this.classifyResultError(error.subtype);
    }

    // Duration tracking.
    this.durationMs = msg.duration_ms ?? 0;
    this.durationApiMs = msg.duration_api_ms ?? 0;

    // Authoritative usage from the result message.
    if (msg.usage) {
      this.inputTokens = msg.usage.input_tokens ?? this.inputTokens;
      this.outputTokens = msg.usage.output_tokens ?? this.outputTokens;
      this.cacheReadTokens = msg.usage.cache_read_input_tokens ?? this.cacheReadTokens;
      this.cacheWriteTokens = msg.usage.cache_creation_input_tokens ?? this.cacheWriteTokens;
    }
    if (typeof msg.total_cost_usd === "number") {
      this.cost = msg.total_cost_usd;
    }
    if (typeof msg.num_turns === "number") {
      this.turns = msg.num_turns;
    }

    // Extract model from modelUsage if not already known.
    if (!this.model && msg.modelUsage) {
      const modelKeys = Object.keys(msg.modelUsage);
      if (modelKeys.length > 0) {
        // Strip context window suffix: "claude-opus-4-6[1m]" -> "claude-opus-4-6"
        this.model = modelKeys[0].replace(/\[.*\]$/, "");
      }
    }

    // Accumulate per-model cost if total_cost_usd is zero.
    if (this.cost === 0 && msg.modelUsage) {
      for (const mu of Object.values(msg.modelUsage)) {
        this.cost += mu.costUSD ?? 0;
      }
    }

    // Always capture session_id from result (authoritative source).
    if (msg.session_id) {
      this.sessionId = msg.session_id;
    }
  }

  // -----------------------------------------------------------------------
  // Diagnostic message handlers
  // -----------------------------------------------------------------------

  private handleAuthStatus(msg: SDKMessage): void {
    const auth = msg as { isAuthenticating?: boolean; output?: string[]; error?: string };
    if (auth.error) {
      // Auth errors are significant enough to surface as the execution error.
      if (!this.errorText) {
        this.errorText = `Authentication error: ${auth.error}`;
      }
    }
    if (isVerbose()) {
      console.error(
        `[pancode:sdk] Auth status: authenticating=${auth.isAuthenticating ?? "?"} ` +
          `${auth.error ? `error=${auth.error}` : ""}`,
      );
    }
  }

  private handleRateLimitEvent(msg: SDKMessage): void {
    const rateLimit = msg as {
      rate_limit_info?: {
        requests_remaining?: number;
        requests_limit?: number;
        requests_reset?: string;
        tokens_remaining?: number;
        tokens_limit?: number;
      };
    };
    if (isVerbose() && rateLimit.rate_limit_info) {
      const info = rateLimit.rate_limit_info;
      console.error(
        `[pancode:sdk] Rate limit: requests=${info.requests_remaining ?? "?"}/${info.requests_limit ?? "?"} ` +
          `tokens=${info.tokens_remaining ?? "?"}/${info.tokens_limit ?? "?"}`,
      );
    }
  }

  private handleToolProgress(msg: SDKMessage): void {
    const progress = msg as {
      tool_use_id?: string;
      tool_name?: string;
      elapsed_time_seconds?: number;
    };
    // Update current tool name from tool_progress messages.
    // These fire during long-running tool execution (e.g., Bash commands).
    if (progress.tool_name && this.currentTool !== progress.tool_name) {
      this.rotateCurrentTool();
      this.currentTool = progress.tool_name;
      this.emitProgress();
    }
  }

  // -----------------------------------------------------------------------
  // Tool tracking
  // -----------------------------------------------------------------------

  private onToolStart(toolName: string, input: unknown): void {
    // Rotate any previous tool to the recent buffer first.
    this.rotateCurrentTool();

    this.currentTool = toolName;
    this.toolCount++;

    if (input) {
      try {
        const argsStr = JSON.stringify(input);
        this.currentToolArgs =
          argsStr.length > MAX_TOOL_ARGS_PREVIEW ? `${argsStr.slice(0, MAX_TOOL_ARGS_PREVIEW)}...` : argsStr;
      } catch {
        this.currentToolArgs = null;
      }
    } else {
      this.currentToolArgs = null;
    }

    this.emitProgress();
  }

  private rotateCurrentTool(): void {
    if (this.currentTool) {
      this.recentTools.push(this.currentTool);
      if (this.recentTools.length > MAX_RECENT_TOOLS) {
        this.recentTools.shift();
      }
      this.currentTool = null;
      this.currentToolArgs = null;
    }
  }

  // -----------------------------------------------------------------------
  // Progress emission
  // -----------------------------------------------------------------------

  private emitProgress(extra?: { textDelta?: string; thinkingDelta?: string }): void {
    this.callbacks?.onProgress?.({
      inputTokens: this.inputTokens,
      outputTokens: this.outputTokens,
      cacheReadTokens: this.cacheReadTokens,
      cacheWriteTokens: this.cacheWriteTokens,
      cost: this.cost,
      turns: this.turns,
      currentTool: this.currentTool,
      currentToolArgs: this.currentToolArgs,
      recentTools: [...this.recentTools],
      toolCount: this.toolCount,
      textDelta: extra?.textDelta,
    });
  }

  // -----------------------------------------------------------------------
  // Error classification
  // -----------------------------------------------------------------------

  private classifySdkError(error: string): string {
    switch (error) {
      case "authentication_failed":
        return "Authentication failed. Check your API key or run `claude login`.";
      case "billing_error":
        return "Billing error. Check your Anthropic account billing status.";
      case "rate_limit":
        return "Rate limited by the provider. Retry in 30 seconds.";
      case "invalid_request":
        return "Invalid request sent to the Claude API.";
      case "server_error":
        return "Claude API server error. Retry shortly.";
      case "max_output_tokens":
        return "Response exceeded maximum output token limit.";
      case "unknown":
        return "Unknown Claude SDK error.";
      default:
        return `Claude SDK error: ${error}`;
    }
  }

  private classifyResultError(subtype: string): string {
    switch (subtype) {
      case "error_during_execution":
        return "SDK execution encountered an error during processing.";
      case "error_max_turns":
        return "Worker exceeded maximum turn limit.";
      case "error_max_budget_usd":
        return "Worker exceeded budget cap.";
      case "error_max_structured_output_retries":
        return "Worker exceeded structured output retry limit.";
      default:
        return `SDK execution failed: ${subtype}`;
    }
  }
}
