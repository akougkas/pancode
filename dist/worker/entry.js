import {
  ensureProjectRuntime,
  loadConfig
} from "../chunk-SVC5PBP3.js";
import "../chunk-RRR3VFYK.js";
import "../chunk-DGUM43GV.js";

// src/worker/entry.ts
import { closeSync, existsSync as existsSync2, mkdirSync as mkdirSync2, openSync, readFileSync, writeFileSync } from "fs";
import { dirname, join as join2 } from "path";
import { spawn } from "child_process";

// src/worker/provider-bridge.ts
import { copyFileSync, existsSync, mkdirSync } from "fs";
import { homedir } from "os";
import { join } from "path";
function buildWorkerModelArgs(config) {
  const args = [];
  if (config.provider) args.push("--provider", config.provider);
  if (config.model) args.push("--model", config.model);
  return args;
}
var PANCODE_HOME = process.env.PANCODE_HOME;
var PANCODE_AGENT_DIR = join(PANCODE_HOME, "agent-engine");
function copyLegacyFileIfMissing(fileName) {
  const legacyPiDir = join(homedir(), ".pi", "agent");
  const sourcePath = join(legacyPiDir, fileName);
  const targetPath = join(PANCODE_AGENT_DIR, fileName);
  if (existsSync(sourcePath) && !existsSync(targetPath)) {
    copyFileSync(sourcePath, targetPath);
  }
}
function ensureWorkerAgentDir() {
  mkdirSync(PANCODE_AGENT_DIR, { recursive: true });
  copyLegacyFileIfMissing("auth.json");
  copyLegacyFileIfMissing("models.json");
  copyLegacyFileIfMissing("settings.json");
  return PANCODE_AGENT_DIR;
}
function createWorkerEnvironment(baseEnv = process.env) {
  return {
    ...baseEnv,
    PI_CODING_AGENT_DIR: ensureWorkerAgentDir()
  };
}

// src/worker/entry.ts
function printUsage() {
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
function parseArgs(argv) {
  const parsed = {
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
    help: false
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
function extractAssistantText(message) {
  if (!message || message.role !== "assistant" || !Array.isArray(message.content)) return "";
  return message.content.filter((part) => part?.type === "text" && typeof part.text === "string").map((part) => part.text).join("");
}
function collectAssistantStateFromEvent(event, state) {
  if (event?.type === "message_end") {
    const message = event.message;
    const text = extractAssistantText(message);
    if (text) {
      state.assistantText = text;
      state.assistantError = "";
    }
    if (message?.role === "assistant" && message.stopReason === "error" && typeof message.errorMessage === "string") {
      state.assistantError = message.errorMessage;
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
function parseCapturedStdout(stdoutText) {
  const state = { assistantText: "", assistantError: "", stdoutNoise: [], eventsCount: 0 };
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
function resolveSafetyExtPath() {
  const dir = dirname(new URL(import.meta.url).pathname);
  const jsPath = join2(dir, "safety-ext.js");
  if (existsSync2(jsPath)) return jsPath;
  return join2(dir, "safety-ext.ts");
}
function buildPiArgs(config, prompt) {
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
    ...buildWorkerModelArgs(config)
  ];
  if (config.safetyExtPath) {
    args.push("--extension", config.safetyExtPath);
  } else {
    args.push("--no-extensions");
  }
  if (config.systemPrompt) {
    args.push("--system-prompt", config.systemPrompt);
  }
  if (config.appendSystemPrompt) {
    args.push("--append-system-prompt", config.appendSystemPrompt);
  }
  args.push(prompt);
  return args;
}
function monitorParent() {
  const parentPid = Number.parseInt(process.env.PANCODE_PARENT_PID ?? "", 10);
  if (!Number.isInteger(parentPid) || parentPid <= 0) return;
  const heartbeat = setInterval(() => {
    try {
      process.kill(parentPid, 0);
    } catch {
      clearInterval(heartbeat);
      process.exit(1);
    }
  }, 5e3);
  heartbeat.unref();
}
async function runPi(config) {
  const piArgs = buildPiArgs(config, config.prompt);
  const stdoutPath = `${config.resultsDir}/last-worker.stdout.jsonl`;
  const stderrPath = `${config.resultsDir}/last-worker.stderr.log`;
  const stdoutFd = openSync(stdoutPath, "w");
  const stderrFd = openSync(stderrPath, "w");
  return new Promise((resolve, reject) => {
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
        PANCODE_PARENT_PID: String(process.pid)
      },
      stdio: ["ignore", stdoutFd, stderrFd]
    });
    let spawnError = null;
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
      const stderrText = readFileSync(stderrPath, "utf8");
      const parsed = parseCapturedStdout(stdoutText);
      resolve({
        exitCode,
        signal,
        timedOut,
        assistantText: parsed.assistantText,
        assistantError: parsed.assistantError,
        stdoutNoise: parsed.stdoutNoise.join(""),
        stderr: stderrText,
        eventsCount: parsed.eventsCount,
        stdoutPath,
        stderrPath
      });
    });
  });
}
function writeResultFile(resultFile, payload) {
  mkdirSync2(dirname(resultFile), { recursive: true });
  writeFileSync(resultFile, `${JSON.stringify(payload, null, 2)}
`, "utf8");
}
async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printUsage();
    return;
  }
  if (!args.resultFile) throw new Error("Missing required --result-file argument.");
  const baseConfig = loadConfig({
    prompt: args.prompt ?? void 0,
    provider: args.provider,
    model: args.model,
    cwd: args.cwd ?? void 0,
    tools: args.tools ?? void 0,
    timeoutMs: Number.isFinite(args.timeoutMs) ? args.timeoutMs : void 0
  });
  ensureProjectRuntime(baseConfig);
  const safetyPath = args.safetyExtPath ?? resolveSafetyExtPath();
  const workerConfig = {
    prompt: baseConfig.prompt,
    cwd: baseConfig.cwd,
    tools: baseConfig.tools,
    provider: baseConfig.provider,
    model: baseConfig.model,
    timeoutMs: baseConfig.timeoutMs,
    resultsDir: baseConfig.resultsDir,
    systemPrompt: args.systemPrompt,
    appendSystemPrompt: args.appendSystemPrompt,
    safetyExtPath: safetyPath
  };
  monitorParent();
  try {
    const result = await runPi(workerConfig);
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
      stdoutNoise: result.stdoutNoise,
      stderr: result.stderr,
      stdoutPath: result.stdoutPath,
      stderrPath: result.stderrPath
    });
    if (result.exitCode !== 0 || result.assistantError) {
      process.exitCode = result.exitCode ?? 1;
    }
  } catch (error) {
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
      stderr: error instanceof Error ? error.message : String(error),
      stdoutPath: "",
      stderrPath: ""
    });
    process.exitCode = 1;
  }
}
main().catch((error) => {
  console.error(`[pancode:worker] ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
//# sourceMappingURL=entry.js.map