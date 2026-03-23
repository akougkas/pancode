import { spawn } from "node:child_process";
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { type PanCodeConfig, loadConfig } from "../core/config";
import { atomicWriteJsonSync, atomicWriteTextSync } from "../core/config-writer";
import { ensureProjectRuntime } from "../core/init";
import { redact } from "../core/redaction";
import { buildWorkerModelArgs, createWorkerEnvironment } from "./provider-bridge";

interface WorkerArgs {
  prompt: string | null;
  resultFile: string | null;
  provider: string | null;
  model: string | null;
  cwd: string | null;
  tools: string | null;
  timeoutMs: number | null;
  systemPrompt: string | null;
  appendSystemPrompt: string | null;
  safetyExtPath: string | null;
  help: boolean;
}

interface WorkerUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  cost: number;
  turns: number;
}

interface AssistantState {
  assistantText: string;
  assistantError: string;
  stdoutNoise: string[];
  eventsCount: number;
  usage: WorkerUsage;
}

interface PiRunResult {
  exitCode: number | null;
  signal: string | null;
  timedOut: boolean;
  assistantText: string;
  assistantError: string;
  usage: WorkerUsage;
  stdoutNoise: string;
  stderr: string;
  eventsCount: number;
  stdoutPath: string;
  stderrPath: string;
}

function printUsage(): void {
  console.log(`Usage:
  npx tsx src/worker/entry.ts --prompt "list files" --result-file result.json

Options:
  --prompt <text>              Prompt to send to pi
  --result-file <path>         JSON file written by the worker
  --provider <name>            Explicit provider override
  --model <id>                 Explicit model override
  --cwd <path>                 Working directory for the pi subprocess
  --tools <csv>                Tool allowlist passed to pi
  --timeout-ms <ms>            Kill the subprocess if it exceeds the timeout
  --system-prompt <text>       System prompt for agent identity and context
  --append-system-prompt <text> Additional context appended to system prompt
  --safety-ext <path>          Path to safety extension (default: auto-resolved)
  --help                       Show this help`);
}

function parseArgs(argv: string[]): WorkerArgs {
  const parsed: WorkerArgs = {
    prompt: null,
    resultFile: null,
    provider: null,
    model: null,
    cwd: null,
    tools: null,
    timeoutMs: null,
    systemPrompt: null,
    appendSystemPrompt: null,
    safetyExtPath: null,
    help: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") {
      parsed.help = true;
      continue;
    }
    if (arg === "--prompt") {
      parsed.prompt = argv[++index] ?? null;
      continue;
    }
    if (arg === "--result-file") {
      parsed.resultFile = argv[++index] ?? null;
      continue;
    }
    if (arg === "--provider") {
      parsed.provider = argv[++index] ?? null;
      continue;
    }
    if (arg === "--model") {
      parsed.model = argv[++index] ?? null;
      continue;
    }
    if (arg === "--cwd") {
      parsed.cwd = argv[++index] ?? null;
      continue;
    }
    if (arg === "--tools") {
      parsed.tools = argv[++index] ?? null;
      continue;
    }
    if (arg === "--system-prompt") {
      parsed.systemPrompt = argv[++index] ?? null;
      continue;
    }
    if (arg === "--append-system-prompt") {
      parsed.appendSystemPrompt = argv[++index] ?? null;
      continue;
    }
    if (arg === "--safety-ext") {
      parsed.safetyExtPath = argv[++index] ?? null;
      continue;
    }
    if (arg === "--timeout-ms") {
      const value = argv[++index] ?? null;
      parsed.timeoutMs = value == null ? null : Number.parseInt(value, 10);
      continue;
    }
    if (!arg.startsWith("--") && parsed.prompt == null) {
      parsed.prompt = arg;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  return parsed;
}

// biome-ignore lint: Pi SDK JSON events use dynamic shapes
function extractAssistantText(message: any): string {
  if (!message || message.role !== "assistant" || !Array.isArray(message.content)) return "";
  return (
    message.content
      // biome-ignore lint: Pi SDK content parts have dynamic shape
      .filter((part: any) => part?.type === "text" && typeof part.text === "string")
      // biome-ignore lint: Pi SDK content parts have dynamic shape
      .map((part: any) => part.text as string)
      .join("")
  );
}

// biome-ignore lint: Pi SDK JSON events use dynamic shapes
function collectAssistantStateFromEvent(event: any, state: AssistantState): void {
  if (event?.type === "message_end") {
    const message = event.message;
    const text = extractAssistantText(message);
    if (text) {
      state.assistantText = text;
      state.assistantError = "";
    }
    if (message?.role === "assistant") {
      state.usage.turns++;
      const usage = message.usage;
      if (usage) {
        state.usage.inputTokens += usage.input ?? 0;
        state.usage.outputTokens += usage.output ?? 0;
        state.usage.cacheReadTokens += usage.cacheRead ?? 0;
        state.usage.cacheWriteTokens += usage.cacheWrite ?? 0;
        state.usage.cost += usage.cost?.total ?? 0;
      }
      if (message.stopReason === "error" && typeof message.errorMessage === "string") {
        state.assistantError = message.errorMessage;
      }
    }
    return;
  }

  if (event?.type === "agent_end" && Array.isArray(event.messages)) {
    for (let index = event.messages.length - 1; index >= 0; index -= 1) {
      const message = event.messages[index];
      const text = extractAssistantText(message);
      if (text) {
        state.assistantText = text;
        state.assistantError = "";
        return;
      }
      if (message?.role === "assistant" && message.stopReason === "error" && typeof message.errorMessage === "string") {
        state.assistantError = message.errorMessage;
        return;
      }
    }
  }
}

function parseCapturedStdout(stdoutText: string): AssistantState {
  const state: AssistantState = {
    assistantText: "",
    assistantError: "",
    stdoutNoise: [],
    eventsCount: 0,
    usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, cost: 0, turns: 0 },
  };
  for (const line of stdoutText.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (!trimmed.startsWith("{")) {
      state.stdoutNoise.push(line);
      continue;
    }
    try {
      const event = JSON.parse(trimmed);
      state.eventsCount += 1;
      collectAssistantStateFromEvent(event, state);
    } catch {
      state.stdoutNoise.push(line);
    }
  }
  return state;
}

function resolveSafetyExtPath(): string {
  const dir = dirname(new URL(import.meta.url).pathname);

  // Check for compiled safety-ext first
  const jsPath = join(dir, "safety-ext.js");
  if (existsSync(jsPath)) return jsPath;

  // Fall back to source (dev mode)
  return join(dir, "safety-ext.ts");
}

interface WorkerPiConfig extends Pick<PanCodeConfig, "tools" | "provider" | "model"> {
  systemPrompt: string | null;
  appendSystemPrompt: string | null;
  safetyExtPath: string | null;
}

/** Threshold for writing prompts/system prompts to temp files instead of CLI args. */
const LONG_TEXT_THRESHOLD = 8000;

/** Tracks temp files created during a run so they can be cleaned up afterward. */
const tempFilesToCleanup: string[] = [];

/**
 * Write text to a temp file and return the path. Registers the path for cleanup.
 * Files are created with 0o600 permissions so prompt content is not world-readable.
 */
function writeTempFile(prefix: string, content: string): string {
  const dir = join(tmpdir(), "pancode-worker");
  mkdirSync(dir, { recursive: true });
  const filename = `${prefix}-${process.pid}-${Date.now()}.txt`;
  const filepath = join(dir, filename);
  atomicWriteTextSync(filepath, content, { mode: 0o600 });
  tempFilesToCleanup.push(filepath);
  return filepath;
}

/** Remove all temp files created during this worker run. */
function cleanupTempFiles(): void {
  for (const filepath of tempFilesToCleanup) {
    try {
      unlinkSync(filepath);
    } catch {
      // File may already be gone; ignore.
    }
  }
  tempFilesToCleanup.length = 0;
}

function buildPiArgs(config: WorkerPiConfig, prompt: string): string[] {
  const args = [
    "--mode",
    "json",
    "--print",
    "--no-session",
    "--no-skills",
    "--no-prompt-templates",
    "--no-themes",
    "--tools",
    config.tools,
    ...buildWorkerModelArgs(config),
  ];

  // Load worker safety extension (replaces --no-extensions)
  if (config.safetyExtPath) {
    args.push("--extension", config.safetyExtPath);
  } else {
    args.push("--no-extensions");
  }

  // System prompt: use temp file for long prompts to avoid arg length limits
  // and prevent prompt content from appearing in process listings.
  if (config.systemPrompt) {
    if (config.systemPrompt.length > LONG_TEXT_THRESHOLD) {
      const sysPromptPath = writeTempFile("sys-prompt", config.systemPrompt);
      args.push("--system-prompt", `@${sysPromptPath}`);
    } else {
      args.push("--system-prompt", config.systemPrompt);
    }
  }

  // Append additional context
  if (config.appendSystemPrompt) {
    if (config.appendSystemPrompt.length > LONG_TEXT_THRESHOLD) {
      const appendPath = writeTempFile("append-prompt", config.appendSystemPrompt);
      args.push("--append-system-prompt", `@${appendPath}`);
    } else {
      args.push("--append-system-prompt", config.appendSystemPrompt);
    }
  }

  // Task prompt: use temp file for long tasks to avoid OS arg length limits.
  // Pi CLI reads file content when the argument starts with "@".
  if (prompt.length > LONG_TEXT_THRESHOLD) {
    const taskPath = writeTempFile("task", prompt);
    args.push(`@${taskPath}`);
  } else {
    args.push(prompt);
  }

  return args;
}

function monitorParent(): void {
  const parentPid = Number.parseInt(process.env.PANCODE_PARENT_PID ?? "", 10);
  if (!Number.isInteger(parentPid) || parentPid <= 0) return;
  const parentCheck = setInterval(() => {
    try {
      process.kill(parentPid, 0);
    } catch {
      clearInterval(parentCheck);
      process.exit(1);
    }
  }, 5000);
  parentCheck.unref();
}

// ---------------------------------------------------------------------------
// Heartbeat and lifecycle event emission
// ---------------------------------------------------------------------------

/** Write a structured NDJSON event to stdout for the orchestrator to parse. */
function emitWorkerEvent(event: Record<string, unknown>): void {
  try {
    process.stdout.write(`${JSON.stringify(event)}\n`);
  } catch {
    // Stdout may be closed if the orchestrator terminated. Ignore silently.
  }
}

/**
 * Start a periodic heartbeat emitter. Each tick writes one NDJSON heartbeat
 * line to stdout. The orchestrator uses heartbeat timing to classify worker
 * health as healthy, stale, or dead.
 *
 * Frequency defaults to 10 seconds, configurable via PANCODE_HEARTBEAT_INTERVAL_MS.
 */
function startHeartbeat(runId: string): NodeJS.Timeout {
  const intervalMs = Number.parseInt(process.env.PANCODE_HEARTBEAT_INTERVAL_MS ?? "10000", 10);
  const timer = setInterval(() => {
    emitWorkerEvent({
      type: "heartbeat",
      ts: new Date().toISOString(),
      runId,
      turns: 0,
      lastToolCall: null,
      tokensThisBeat: { in: 0, out: 0 },
    });
  }, intervalMs);
  timer.unref();
  return timer;
}

/** Emit a structured lifecycle event to stdout. */
function emitLifecycle(event: string, runId: string, extra?: Record<string, unknown>): void {
  emitWorkerEvent({ type: "lifecycle", event, runId, ...extra });
}

interface FullWorkerConfig extends WorkerPiConfig {
  prompt: string;
  cwd: string;
  timeoutMs: number;
  resultsDir: string;
}

async function runPi(config: FullWorkerConfig): Promise<PiRunResult> {
  const piArgs = buildPiArgs(config, config.prompt);
  const stdoutPath = `${config.resultsDir}/last-worker.stdout.jsonl`;
  const stderrPath = `${config.resultsDir}/last-worker.stderr.log`;
  const stdoutFd = openSync(stdoutPath, "w");
  const stderrFd = openSync(stderrPath, "w");

  return new Promise<PiRunResult>((resolve, reject) => {
    const workerEnv = createWorkerEnvironment(process.env);
    const child = spawn("pi", piArgs, {
      cwd: config.cwd,
      env: {
        ...workerEnv,
        // Forward coordination env vars to pi subprocess so safety-ext.ts can read them
        PANCODE_BOARD_FILE: process.env.PANCODE_BOARD_FILE ?? "",
        PANCODE_CONTEXT_FILE: process.env.PANCODE_CONTEXT_FILE ?? "",
        PANCODE_AGENT_NAME: process.env.PANCODE_AGENT_NAME ?? "",
        PANCODE_SAFETY: process.env.PANCODE_SAFETY ?? "auto-edit",
        PANCODE_PARENT_PID: String(process.pid),
      },
      stdio: ["ignore", stdoutFd, stderrFd],
    });

    let spawnError: Error | null = null;
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, config.timeoutMs);
    timeout.unref();

    closeSync(stdoutFd);
    closeSync(stderrFd);

    child.on("error", (error) => {
      spawnError = error;
    });
    child.on("close", (exitCode, signal) => {
      clearTimeout(timeout);
      if (spawnError) {
        reject(spawnError);
        return;
      }

      const stdoutText = readFileSync(stdoutPath, "utf8");
      const stderrText = redact(readFileSync(stderrPath, "utf8"));
      const parsed = parseCapturedStdout(stdoutText);

      resolve({
        exitCode,
        signal,
        timedOut,
        assistantText: parsed.assistantText,
        assistantError: parsed.assistantError,
        usage: parsed.usage,
        stdoutNoise: parsed.stdoutNoise.join(""),
        stderr: stderrText,
        eventsCount: parsed.eventsCount,
        stdoutPath,
        stderrPath,
      });
    });
  });
}

function writeResultFile(resultFile: string, payload: Record<string, unknown>): void {
  atomicWriteJsonSync(resultFile, payload);
}

/**
 * Resolve a value that may be a `@/path/to/file` file reference.
 * Only absolute paths qualify as file refs (must start with `@/`).
 * This prevents false positives when a legitimate prompt starts with `@`.
 */
function resolveFileRef(value: string | null): string | null {
  if (!value || !value.startsWith("@/")) return value;
  const filepath = value.slice(1);
  try {
    return readFileSync(filepath, "utf8");
  } catch {
    // If the file does not exist, return the raw value as a fallback.
    return value;
  }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printUsage();
    return;
  }
  if (!args.resultFile) throw new Error("Missing required --result-file argument.");

  // Resolve @file references for system prompts passed from PiRuntime.
  args.systemPrompt = resolveFileRef(args.systemPrompt);
  args.appendSystemPrompt = resolveFileRef(args.appendSystemPrompt);

  const baseConfig = loadConfig({
    prompt: args.prompt ?? undefined,
    provider: args.provider,
    model: args.model,
    cwd: args.cwd ?? undefined,
    tools: args.tools ?? undefined,
    timeoutMs: Number.isFinite(args.timeoutMs) ? (args.timeoutMs as number) : undefined,
  });
  ensureProjectRuntime(baseConfig);

  // Build full worker config with new fields
  const safetyPath = args.safetyExtPath ?? resolveSafetyExtPath();
  const workerConfig: FullWorkerConfig = {
    prompt: baseConfig.prompt,
    cwd: baseConfig.cwd,
    tools: baseConfig.tools,
    provider: baseConfig.provider,
    model: baseConfig.model,
    timeoutMs: baseConfig.timeoutMs,
    resultsDir: baseConfig.resultsDir,
    systemPrompt: args.systemPrompt,
    appendSystemPrompt: args.appendSystemPrompt,
    safetyExtPath: safetyPath,
  };

  monitorParent();

  // Resolve run ID from orchestrator env var or extract from result file path.
  const runId =
    process.env.PANCODE_RUN_ID ??
    args.resultFile.match(/worker-([a-f0-9-]+)\.result\.json$/)?.[1] ??
    `w-${process.pid}`;

  const agentName = process.env.PANCODE_AGENT_NAME ?? "worker";

  // Emit lifecycle started event and begin heartbeat.
  emitLifecycle("started", runId, { agent: agentName, runtime: "pi" });
  const heartbeatTimer = startHeartbeat(runId);

  try {
    const result = await runPi(workerConfig);
    clearInterval(heartbeatTimer);
    emitLifecycle("completed", runId, { exitCode: result.exitCode ?? 0 });

    writeResultFile(args.resultFile, {
      ok: result.exitCode === 0 && !result.assistantError,
      prompt: workerConfig.prompt,
      cwd: workerConfig.cwd,
      exitCode: result.exitCode,
      signal: result.signal,
      timedOut: result.timedOut,
      eventsCount: result.eventsCount,
      assistantText: result.assistantText,
      assistantError: result.assistantError,
      usage: result.usage,
      stdoutNoise: result.stdoutNoise,
      stderr: result.stderr,
      stdoutPath: result.stdoutPath,
      stderrPath: result.stderrPath,
    });
    if (result.exitCode !== 0 || result.assistantError) {
      process.exitCode = result.exitCode ?? 1;
    }
  } catch (error) {
    clearInterval(heartbeatTimer);
    emitLifecycle("completed", runId, { exitCode: 1 });

    writeResultFile(args.resultFile, {
      ok: false,
      prompt: args.prompt,
      exitCode: null,
      signal: null,
      timedOut: false,
      eventsCount: 0,
      assistantText: "",
      assistantError: "",
      stdoutNoise: "",
      stderr: redact(error instanceof Error ? error.message : String(error)),
      stdoutPath: "",
      stderrPath: "",
    });
    process.exitCode = 1;
  } finally {
    cleanupTempFiles();
  }
}

main().catch((error) => {
  console.error(`[pancode:worker] ${redact(error instanceof Error ? error.message : String(error))}`);
  process.exitCode = 1;
});
