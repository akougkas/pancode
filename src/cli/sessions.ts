import { EXIT_FAILURE, EXIT_SUCCESS, isTmuxAvailable, listPancodeSessions } from "./shared";

/**
 * List all PanCode tmux sessions.
 */
export function sessions(): number {
  if (!isTmuxAvailable()) {
    console.error("[pancode] tmux is not installed.");
    return EXIT_FAILURE;
  }

  const all = listPancodeSessions();
  if (all.length === 0) {
    console.log("No PanCode sessions running.");
    return EXIT_SUCCESS;
  }

  console.log(`${all.length} session${all.length === 1 ? "" : "s"}:\n`);
  for (const s of all) {
    const status = s.attached ? "attached" : "detached";
    console.log(`  ${s.name.padEnd(16)} ${status}`);
  }

  return EXIT_SUCCESS;
}
