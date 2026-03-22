import { execSync } from "node:child_process";
import { EXIT_FAILURE, EXIT_SUCCESS, isTmuxAvailable, nextSessionName } from "./shared";

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

  const sessionName = nextSessionName();
  const binPath = process.env.PANCODE_BIN_PATH ?? "src/loader.ts";
  const isTsx = binPath.endsWith(".ts");
  const nodePrefix = isTsx ? "node --import tsx" : "node";
  const extraArgs = forwardedArgs.length > 0 ? ` ${forwardedArgs.join(" ")}` : "";
  const cmd = `PANCODE_INSIDE_TMUX=1 ${nodePrefix} ${binPath}${extraArgs}`;

  console.log(`Starting PanCode session "${sessionName}"...`);
  try {
    execSync(`tmux new-session -d -s ${sessionName} '${cmd}'`, { stdio: "pipe" });
    execSync(`tmux attach-session -t ${sessionName}`, { stdio: "inherit" });
  } catch {
    // User detached or session ended
  }

  return EXIT_SUCCESS;
}
