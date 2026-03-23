import { existsSync, readdirSync, rmSync, unlinkSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { EXIT_SUCCESS } from "./shared";

/** Files in <project>/.pancode/ that are runtime state (safe to delete). */
const PROJECT_RUNTIME_FILES = ["runs.json", "metrics.json", "budget.json", "tasks.json"];

/**
 * Wipe PanCode runtime state while preserving user configuration.
 *
 * Clears:
 *   <project>/.pancode/runs.json, metrics.json, budget.json, tasks.json
 *   <project>/.pancode/runtime/ (board.json, worker-*.result.json)
 *   ~/.pancode/agent-engine/sessions/
 *
 * Preserves:
 *   ~/.pancode/panpresets.yaml, panagents.yaml, panproviders.yaml
 *   ~/.pancode/settings.json, model-cache.yaml
 *   ~/.pancode/agent-engine/auth.json
 */
export function resetRuntimeState(projectRoot: string, opts?: { quiet?: boolean }): number {
  const quiet = opts?.quiet ?? false;
  const log = quiet ? (_msg: string) => {} : (msg: string) => console.log(msg);
  let cleaned = 0;

  // 1. Project-local runtime files
  const projectPancode = join(projectRoot, ".pancode");
  if (existsSync(projectPancode)) {
    for (const file of PROJECT_RUNTIME_FILES) {
      const filePath = join(projectPancode, file);
      if (existsSync(filePath)) {
        unlinkSync(filePath);
        log(`  removed ${projectPancode}/${file}`);
        cleaned++;
      }
    }

    // 2. Project-local runtime directory (board.json, worker results)
    const runtimeDir = join(projectPancode, "runtime");
    if (existsSync(runtimeDir)) {
      const entries = readdirSync(runtimeDir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isFile()) {
          unlinkSync(join(runtimeDir, entry.name));
          log(`  removed ${runtimeDir}/${entry.name}`);
          cleaned++;
        } else if (entry.isDirectory()) {
          // Recurse into subdirectories (e.g. runtime/results/)
          const subDir = join(runtimeDir, entry.name);
          const subEntries = readdirSync(subDir, { withFileTypes: true });
          for (const sub of subEntries) {
            if (sub.isFile()) {
              unlinkSync(join(subDir, sub.name));
              log(`  removed ${subDir}/${sub.name}`);
              cleaned++;
            }
          }
        }
      }
    }
  }

  // 3. Pi SDK session history
  const pancodeHome = process.env.PANCODE_HOME?.trim() || join(homedir(), ".pancode");
  const sessionsDir = join(pancodeHome, "agent-engine", "sessions");
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
  const projectRoot = process.env.PANCODE_PACKAGE_ROOT ?? process.cwd();
  console.log("[pancode] Resetting runtime state...");
  return resetRuntimeState(projectRoot);
}
