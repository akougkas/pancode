import { execSync } from "node:child_process";
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
export function start(forwardedArgs: string[]): number {
  if (!isTmuxAvailable()) {
    console.error("[pancode] tmux is not installed. Install tmux to use PanCode.");
    return EXIT_FAILURE;
  }

  const sessionName = nextSessionName(process.cwd());
  const binPath = process.env.PANCODE_BIN_PATH ?? "src/loader.ts";
  const isTsx = binPath.endsWith(".ts");
  const nodePrefix = isTsx ? "node --import tsx" : "node";
  const extraArgs = forwardedArgs.length > 0 ? ` ${forwardedArgs.join(" ")}` : "";
  const cmd = `PANCODE_INSIDE_TMUX=1 ${nodePrefix} ${binPath}${extraArgs}`;

  console.log(`Starting PanCode session "${sessionName}"...`);
  try {
    execSync(`tmux new-session -d -s ${sessionName} '${cmd}'`, { stdio: "pipe" });
    // Auto-configure extended-keys after the session exists (tmux server is running).
    ensureTmuxExtendedKeys();
    execSync(`tmux attach-session -t ${sessionName}`, { stdio: "inherit" });
  } catch {
    // User detached or session ended
  }

  return EXIT_SUCCESS;
}
