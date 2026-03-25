import { existsSync, readdirSync, rmSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { getDataDir } from "../core/xdg.js";
import { EXIT_SUCCESS } from "./shared";

/**
 * Remove all files inside a directory without deleting the directory itself.
 * Recurses into subdirectories. Returns the number of items removed.
 */
function clearDirContents(dir: string, log: (msg: string) => void): number {
  if (!existsSync(dir)) return 0;
  let removed = 0;
  const entries = readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const entryPath = join(dir, entry.name);
    if (entry.isFile()) {
      unlinkSync(entryPath);
      log(`  removed ${entryPath}`);
      removed++;
    } else if (entry.isDirectory()) {
      rmSync(entryPath, { recursive: true, force: true });
      log(`  removed ${entryPath}/`);
      removed++;
    }
  }
  return removed;
}

/**
 * Wipe PanCode runtime state while preserving user and project configuration.
 *
 * Clears:
 *   <project>/.pancode/state/   (board, runs, metrics, budget, tasks)
 *   <project>/.pancode/results/ (worker-*.result.json)
 *   $DATA_DIR/agent-engine/sessions/
 *
 * Preserves:
 *   <project>/.pancode/config/  (project settings)
 *   All global XDG dirs (settings, presets, agents, auth)
 */
export function resetRuntimeState(projectRoot: string, opts?: { quiet?: boolean }): number {
  const quiet = opts?.quiet ?? false;
  const log = quiet ? (_msg: string) => {} : (msg: string) => console.log(msg);
  let cleaned = 0;

  // 1. Clear .pancode/state/ contents
  const stateDir = join(projectRoot, ".pancode", "state");
  cleaned += clearDirContents(stateDir, log);

  // 2. Clear .pancode/results/ contents
  const resultsDir = join(projectRoot, ".pancode", "results");
  cleaned += clearDirContents(resultsDir, log);

  // 3. Pi SDK session history
  const dataDir = getDataDir();
  const sessionsDir = join(dataDir, "agent-engine", "sessions");
  if (existsSync(sessionsDir)) {
    const sessionEntries = readdirSync(sessionsDir, { withFileTypes: true });
    let sessionCount = 0;
    for (const entry of sessionEntries) {
      const entryPath = join(sessionsDir, entry.name);
      if (entry.isFile()) {
        unlinkSync(entryPath);
        sessionCount++;
      } else if (entry.isDirectory()) {
        rmSync(entryPath, { recursive: true, force: true });
        sessionCount++;
      }
    }
    if (sessionCount > 0) {
      log(`  removed ${sessionCount} session(s) from ${sessionsDir}`);
      cleaned += sessionCount;
    }
  }

  if (cleaned === 0) {
    log("Nothing to clean.");
  } else {
    log(`Cleaned ${cleaned} item(s). User config preserved.`);
  }

  return EXIT_SUCCESS;
}

/**
 * CLI entry point for "pancode reset".
 */
export function reset(_args: string[]): number {
  const projectRoot = process.cwd();
  console.log("[pancode] Resetting runtime state...");
  return resetRuntimeState(projectRoot);
}
