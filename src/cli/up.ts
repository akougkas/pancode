import { execSync } from "node:child_process";
import {
  EXIT_FAILURE,
  EXIT_SUCCESS,
  type PancodeSession,
  isTmuxAvailable,
  listPancodeSessions,
} from "./shared";

/**
 * Attach to an existing PanCode tmux session.
 *
 *   pancode up         Attach to the most recent session.
 *   pancode up <name>  Attach to a specific session by name.
 */
export function up(args: string[]): number {
  if (!isTmuxAvailable()) {
    console.error("[pancode] tmux is not installed.");
    return EXIT_FAILURE;
  }

  const sessions = listPancodeSessions();
  if (sessions.length === 0) {
    console.error("[pancode] No sessions running. Start one with: pancode");
    return EXIT_FAILURE;
  }

  let target: PancodeSession;

  if (args.length > 0 && !args[0].startsWith("-")) {
    // Attach to a specific session by name
    const requested = args[0];
    const match = sessions.find((s) => s.name === requested);
    if (!match) {
      console.error(`[pancode] Session "${requested}" not found.`);
      printSessionList(sessions);
      return EXIT_FAILURE;
    }
    target = match;
  } else {
    // Attach to the most recent session
    target = sessions[0];
  }

  if (target.attached) {
    console.log(`Session "${target.name}" is already attached in another terminal.`);
    return EXIT_FAILURE;
  }

  try {
    execSync(`tmux attach-session -t ${target.name}`, { stdio: "inherit" });
  } catch {
    // User detached or session ended
  }

  return EXIT_SUCCESS;
}

function printSessionList(sessions: PancodeSession[]): void {
  console.log("Available sessions:");
  for (const s of sessions) {
    const status = s.attached ? "(attached)" : "(detached)";
    console.log(`  ${s.name} ${status}`);
  }
}
