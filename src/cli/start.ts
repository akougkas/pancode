import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { EXIT_FAILURE, EXIT_SUCCESS, isTmuxAvailable, nextSessionName } from "./shared";

/**
 * Auto-configure tmux extended-keys for proper key handling.
 * Sets extended-keys=on and extended-keys-format=csi-u globally.
 * Silently succeeds or fails (old tmux versions lack the option).
 */
function ensureTmuxExtendedKeys(): void {
  try {
    execSync("tmux set -g extended-keys on", { stdio: "pipe" });
  } catch {
    // Old tmux or server not yet running; will retry after session creation.
  }
  try {
    execSync("tmux set -g extended-keys-format csi-u", { stdio: "pipe" });
  } catch {
    // Old tmux version without extended-keys-format support.
  }
}

/**
 * Create a new PanCode tmux session and attach to it.
 * Each invocation creates a fresh session. Multiple sessions can coexist.
 * Session names: "pancode", "pancode-2", "pancode-3", etc.
 *
 * All forwarded args (--preset, --model, etc.) are passed to the inner loader.
 */
/**
 * Extract the value of --cwd from forwarded CLI args, if present.
 * Handles both "--cwd /path" (space-separated) and "--cwd=/path" (equals) forms.
 */
function extractCwd(args: string[]): string | undefined {
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--cwd" && i + 1 < args.length) {
      return args[i + 1];
    }
    if (arg.startsWith("--cwd=")) {
      return arg.slice("--cwd=".length);
    }
  }
  return undefined;
}

/**
 * Collect environment variables that should be forwarded into the nested tmux session.
 * Returns an array of tmux-compatible `-e KEY=VALUE` flag pairs.
 * Includes all PANCODE_* and PI_* vars plus well-known provider API key vars when set.
 */
function collectTmuxEnvFlags(): string[] {
  const wellKnownKeys = ["ANTHROPIC_API_KEY", "OPENAI_API_KEY", "GOOGLE_API_KEY", "DEEPSEEK_API_KEY"];
  const flags: string[] = [];

  for (const [key, value] of Object.entries(process.env)) {
    if (value === undefined) continue;
    const forward = key.startsWith("PANCODE_") || key.startsWith("PI_") || wellKnownKeys.includes(key);
    if (forward) {
      // Shell-escape single quotes in values by ending the quote, adding an escaped quote, and reopening.
      const escaped = value.replace(/'/g, "'\\''");
      flags.push("-e", `${key}='${escaped}'`);
    }
  }

  return flags;
}

export function start(forwardedArgs: string[]): number {
  if (!isTmuxAvailable()) {
    console.error("[pancode] tmux is not installed. Install tmux to use PanCode.");
    return EXIT_FAILURE;
  }

  // Validate --cwd before launching the tmux session so the user sees the error directly.
  const cwdArg = extractCwd(forwardedArgs);
  if (cwdArg !== undefined) {
    const resolved = resolve(cwdArg);
    if (!existsSync(resolved)) {
      process.stderr.write(`[pancode] Fatal: Working directory "${resolved}" does not exist.\n`);
      return EXIT_FAILURE;
    }
  }

  const sessionName = nextSessionName(process.cwd());
  const binPath = process.env.PANCODE_BIN_PATH ?? "src/loader.ts";
  const isTsx = binPath.endsWith(".ts");
  const nodePrefix = isTsx ? "node --import tsx" : "node";
  const extraArgs = forwardedArgs.length > 0 ? ` ${forwardedArgs.join(" ")}` : "";
  const envFlags = collectTmuxEnvFlags();
  const envFlagsStr = envFlags.length > 0 ? ` ${envFlags.join(" ")}` : "";
  const innerCmd = `PANCODE_INSIDE_TMUX=1 ${nodePrefix} ${binPath}${extraArgs}`;

  console.log(`Starting PanCode session "${sessionName}"...`);
  try {
    execSync(`tmux new-session -d -s ${sessionName}${envFlagsStr} '${innerCmd}'`, { stdio: "pipe" });
    // Auto-configure extended-keys after the session exists (tmux server is running).
    ensureTmuxExtendedKeys();
    execSync(`tmux attach-session -t ${sessionName}`, { stdio: "inherit" });
  } catch {
    // User detached or session ended
  }

  return EXIT_SUCCESS;
}
