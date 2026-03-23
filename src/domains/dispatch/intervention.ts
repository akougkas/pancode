/**
 * Worker intervention and cooperative lifecycle.
 *
 * Enables the orchestrator to inject real-time guidance into running
 * workers and to pause/resume worker execution.
 *
 * Two IPC mechanisms:
 * 1. Signal + file: send SIGUSR1, worker reads intervention file (low latency)
 * 2. File-based polling: worker checks for intervention file periodically (fallback)
 *
 * Cooperative pause/resume:
 * - Pause: worker suspends its agent loop on SIGTSTP or NDJSON event
 * - Resume: worker resumes on SIGCONT or NDJSON resume event
 */

import { existsSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { atomicWriteJsonSync } from "../../core/config-writer";

export interface Intervention {
  runId: string;
  /** Guidance text to inject into the worker's context. */
  guidance: string;
  /** When the intervention was created. */
  createdAt: string;
  /** Whether the worker has acknowledged the intervention. */
  acknowledged: boolean;
}

export interface WorkerLifecycleState {
  runId: string;
  status: "running" | "paused" | "intervened" | "completed";
  pauseReason?: string;
  lastInterventionAt?: string;
}

const RUNTIME_DIR = ".pancode/runtime";

/**
 * Get the intervention file path for a given run ID.
 */
function interventionPath(projectRoot: string, runId: string): string {
  return join(projectRoot, RUNTIME_DIR, `intervention-${runId}.json`);
}

/**
 * Write an intervention for a running worker.
 * The worker polls for this file or receives SIGUSR1 to read it.
 */
export function writeIntervention(projectRoot: string, runId: string, guidance: string): string {
  const dir = join(projectRoot, RUNTIME_DIR);
  mkdirSync(dir, { recursive: true });

  const intervention: Intervention = {
    runId,
    guidance,
    createdAt: new Date().toISOString(),
    acknowledged: false,
  };

  const path = interventionPath(projectRoot, runId);
  atomicWriteJsonSync(path, intervention);
  return path;
}

/**
 * Check if an intervention exists for a run.
 */
export function hasIntervention(projectRoot: string, runId: string): boolean {
  return existsSync(interventionPath(projectRoot, runId));
}

/**
 * Read and consume an intervention file.
 * Returns the intervention if it exists, null otherwise.
 * Removes the file after reading (consume-once semantics).
 */
export function consumeIntervention(projectRoot: string, runId: string): Intervention | null {
  const path = interventionPath(projectRoot, runId);
  if (!existsSync(path)) return null;

  try {
    const { readFileSync } = require("node:fs") as typeof import("node:fs");
    const raw = readFileSync(path, "utf8");
    const intervention = JSON.parse(raw) as Intervention;
    rmSync(path, { force: true });
    return intervention;
  } catch {
    return null;
  }
}

/**
 * Send an intervention signal to a worker process.
 * Writes the intervention file, then sends SIGUSR1 to trigger immediate read.
 */
export function sendIntervention(projectRoot: string, runId: string, workerPid: number, guidance: string): boolean {
  writeIntervention(projectRoot, runId, guidance);

  try {
    process.kill(workerPid, "SIGUSR1");
    return true;
  } catch {
    // Process may not exist or signal not supported.
    // The worker will pick up the intervention via polling.
    return false;
  }
}

/**
 * Send a pause signal to a worker process.
 */
export function pauseWorker(workerPid: number): boolean {
  try {
    process.kill(workerPid, "SIGTSTP");
    return true;
  } catch {
    return false;
  }
}

/**
 * Send a resume signal to a paused worker process.
 */
export function resumeWorker(workerPid: number): boolean {
  try {
    process.kill(workerPid, "SIGCONT");
    return true;
  } catch {
    return false;
  }
}

/**
 * Clean up all intervention files for a project.
 */
export function cleanupInterventions(projectRoot: string): void {
  const dir = join(projectRoot, RUNTIME_DIR);
  if (!existsSync(dir)) return;

  try {
    const { readdirSync } = require("node:fs") as typeof import("node:fs");
    const files = readdirSync(dir);
    for (const file of files) {
      if (file.startsWith("intervention-")) {
        rmSync(join(dir, file), { force: true });
      }
    }
  } catch {
    // Best effort cleanup
  }
}
