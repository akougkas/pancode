import { execSync } from "node:child_process";
import { EXIT_FAILURE, EXIT_SUCCESS, isTmuxAvailable, listPancodeSessions } from "./shared";

/**
 * Kill PanCode tmux sessions.
 *
 *   pancode down         Kill the most recent session.
 *   pancode down <name>  Kill a specific session by name.
 *   pancode down --all   Kill all PanCode sessions.
 */
export function down(args: string[]): number {
  if (!isTmuxAvailable()) {
    console.error("[pancode] tmux is not installed.");
    return EXIT_FAILURE;
  }

  const sessions = listPancodeSessions();
  if (sessions.length === 0) {
    console.log("No PanCode sessions running.");
    return EXIT_SUCCESS;
  }

  // pancode down --all
  if (args.includes("--all")) {
    let failed = 0;
    for (const s of sessions) {
      if (!killSession(s.name)) failed++;
    }
    console.log(`Killed ${sessions.length - failed} of ${sessions.length} sessions.`);
    return failed > 0 ? EXIT_FAILURE : EXIT_SUCCESS;
  }

  // pancode down <name>
  if (args.length > 0 && !args[0].startsWith("-")) {
    const requested = args[0];
    const match = sessions.find((s) => s.name === requested);
    if (!match) {
      console.error(`[pancode] Session "${requested}" not found.`);
      return EXIT_FAILURE;
    }
    return killSession(match.name) ? EXIT_SUCCESS : EXIT_FAILURE;
  }

  // pancode down (most recent)
  return killSession(sessions[0].name) ? EXIT_SUCCESS : EXIT_FAILURE;
}

function killSession(name: string): boolean {
  try {
    // Send Ctrl-C for graceful shutdown, wait briefly, then kill
    execSync(`tmux send-keys -t ${name} C-c`, { stdio: "pipe" });
    execSync("sleep 1", { stdio: "pipe" });
    try {
      execSync(`tmux has-session -t ${name}`, { stdio: "pipe" });
      execSync(`tmux kill-session -t ${name}`, { stdio: "pipe" });
    } catch {
      // Already exited from Ctrl-C
    }
    console.log(`Session "${name}" stopped.`);
    return true;
  } catch {
    console.error(`[pancode] Failed to stop session "${name}".`);
    return false;
  }
}
