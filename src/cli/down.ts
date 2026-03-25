import { execSync } from "node:child_process";
import { sweepStaleLocks } from "../core/session-lock";
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

  let result: number;

  // pancode down --all
  if (args.includes("--all")) {
    let failed = 0;
    for (const s of sessions) {
      if (!killSession(s.name)) failed++;
    }
    console.log(`Killed ${sessions.length - failed} of ${sessions.length} sessions.`);
    result = failed > 0 ? EXIT_FAILURE : EXIT_SUCCESS;
  } else if (args.length > 0 && !args[0].startsWith("-")) {
    // pancode down <name>
    const requested = args[0];
    const match = sessions.find((s) => s.name === requested);
    if (!match) {
      console.error(`[pancode] Session "${requested}" not found.`);
      return EXIT_FAILURE;
    }
    result = killSession(match.name) ? EXIT_SUCCESS : EXIT_FAILURE;
  } else {
    // pancode down (most recent)
    result = killSession(sessions[0].name) ? EXIT_SUCCESS : EXIT_FAILURE;
  }

  // Sweep stale lock files left by processes that did not clean up gracefully.
  // This runs after session kills to catch locks from processes that were
  // force-killed (SIGKILL) or exited before the ShutdownCoordinator ran.
  const swept = sweepStaleLocks();
  if (swept > 0) {
    console.log(`Swept ${swept} stale lock(s).`);
  }

  return result;
}

/** Grace period (ms) after sending Ctrl+C before forcibly killing the session. */
const GRACEFUL_WAIT_MS = 5000;
const POLL_INTERVAL_MS = 250;

function sessionExists(name: string): boolean {
  try {
    execSync(`tmux has-session -t ${name}`, { stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}

function killSession(name: string): boolean {
  try {
    // Phase 1: Send Ctrl+C (SIGINT) to trigger ShutdownCoordinator in the
    // orchestrator. This gives workers time to receive SIGTERM and flush state.
    execSync(`tmux send-keys -t ${name} C-c`, { stdio: "pipe" });

    // Phase 2: Poll for up to GRACEFUL_WAIT_MS for the session to exit cleanly.
    const deadline = Date.now() + GRACEFUL_WAIT_MS;
    while (Date.now() < deadline) {
      if (!sessionExists(name)) {
        console.log(`Session "${name}" stopped.`);
        return true;
      }
      execSync(`sleep ${POLL_INTERVAL_MS / 1000}`, { stdio: "pipe" });
    }

    // Phase 3: Force kill if still alive after the grace period.
    if (sessionExists(name)) {
      execSync(`tmux kill-session -t ${name}`, { stdio: "pipe" });
    }

    console.log(`Session "${name}" stopped.`);
    return true;
  } catch {
    console.error(`[pancode] Failed to stop session "${name}".`);
    return false;
  }
}
