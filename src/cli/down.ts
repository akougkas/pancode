import { execSync } from "node:child_process";
import { EXIT_FAILURE, EXIT_SUCCESS, PANCODE_TMUX_SESSION, isTmuxSessionRunning } from "./shared";

export function down(): number {
  if (!isTmuxSessionRunning()) {
    console.log("No PanCode tmux session is running.");
    return EXIT_SUCCESS;
  }

  console.log(`Stopping PanCode session "${PANCODE_TMUX_SESSION}"...`);
  try {
    // Send SIGTERM to the pancode process inside tmux
    execSync(`tmux send-keys -t ${PANCODE_TMUX_SESSION} C-c`, { stdio: "pipe" });
    // Give it a moment to shut down gracefully
    execSync("sleep 2", { stdio: "pipe" });
    // Kill the session if still running
    if (isTmuxSessionRunning()) {
      execSync(`tmux kill-session -t ${PANCODE_TMUX_SESSION}`, { stdio: "pipe" });
    }
    console.log("PanCode session stopped.");
  } catch {
    console.error("[pancode:cli] Failed to stop PanCode session.");
    return EXIT_FAILURE;
  }

  return EXIT_SUCCESS;
}
