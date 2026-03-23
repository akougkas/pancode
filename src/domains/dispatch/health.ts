/**
 * Worker health classification based on heartbeat timing.
 *
 * Tracks heartbeat events per worker and classifies each worker's health
 * as healthy, stale, dead, or recovered. The health monitor runs a periodic
 * check timer (unref'd so it does not block process exit) and emits
 * WORKER_HEALTH_CHANGED bus events on state transitions.
 *
 * Health states:
 *   healthy   - Heartbeat received within 2 intervals
 *   stale     - No heartbeat for 3 intervals (warn in dispatch board)
 *   dead      - No heartbeat for 5 intervals OR process exited (cleanup)
 *   recovered - Heartbeat received after being stale (clears warning)
 */

import { BusChannel, type HealthState } from "../../core/bus-events";
import { sharedBus } from "../../core/shared-bus";

interface HealthEntry {
  runId: string;
  state: HealthState;
  lastHeartbeatAt: number;
  heartbeatCount: number;
}

/** Default heartbeat interval: 10 seconds. Workers emit at this frequency. */
export const DEFAULT_HEARTBEAT_INTERVAL_MS = 10_000;

export class WorkerHealthMonitor {
  private readonly workers = new Map<string, HealthEntry>();
  private readonly intervalMs: number;
  private checker: NodeJS.Timeout | null = null;

  constructor(heartbeatIntervalMs?: number) {
    this.intervalMs = heartbeatIntervalMs ?? DEFAULT_HEARTBEAT_INTERVAL_MS;
  }

  /** Stale threshold: no heartbeat for 3 intervals. */
  private get staleThresholdMs(): number {
    return this.intervalMs * 3;
  }

  /** Dead threshold: no heartbeat for 5 intervals. */
  private get deadThresholdMs(): number {
    return this.intervalMs * 5;
  }

  /**
   * Record a heartbeat from a worker. Creates an entry if none exists.
   * Returns the resulting health state after processing.
   */
  recordHeartbeat(runId: string): HealthState {
    const now = Date.now();
    let entry = this.workers.get(runId);
    if (!entry) {
      entry = { runId, state: "healthy", lastHeartbeatAt: now, heartbeatCount: 0 };
      this.workers.set(runId, entry);
      this.ensureChecker();
      return "healthy";
    }

    entry.lastHeartbeatAt = now;
    entry.heartbeatCount++;

    const prev = entry.state;
    if (prev === "stale") {
      // Heartbeat received after being stale: transition to recovered.
      this.transition(entry, "recovered");
    } else if (prev === "recovered") {
      // Second heartbeat after recovery: back to healthy.
      this.transition(entry, "healthy");
    } else if (prev === "dead") {
      // Resurrections are ignored. Once dead, a worker stays dead.
      return "dead";
    }
    // If already healthy, no state change needed.

    return entry.state;
  }

  /** Mark a worker as dead because its process exited. */
  recordProcessExit(runId: string): void {
    const entry = this.workers.get(runId);
    if (entry && entry.state !== "dead") {
      this.transition(entry, "dead");
    }
  }

  /** Get the current health state for a worker, or null if not tracked. */
  getState(runId: string): HealthState | null {
    return this.workers.get(runId)?.state ?? null;
  }

  /** Get all tracked workers and their health states. */
  getAllStates(): ReadonlyMap<string, HealthState> {
    const result = new Map<string, HealthState>();
    for (const [runId, entry] of this.workers) {
      result.set(runId, entry.state);
    }
    return result;
  }

  /** Remove a worker from tracking. Called during cleanup. */
  remove(runId: string): void {
    this.workers.delete(runId);
    if (this.workers.size === 0) {
      this.stopChecker();
    }
  }

  /** Start the periodic check timer if not already running. */
  private ensureChecker(): void {
    if (this.checker) return;
    // Check every interval for staleness.
    this.checker = setInterval(() => this.checkAll(), this.intervalMs);
    this.checker.unref();
  }

  /** Stop the periodic check timer. */
  private stopChecker(): void {
    if (this.checker) {
      clearInterval(this.checker);
      this.checker = null;
    }
  }

  /** Clear all tracked workers and stop the checker. */
  reset(): void {
    this.workers.clear();
    this.stopChecker();
  }

  /** Run periodic health checks on all tracked workers. */
  private checkAll(): void {
    const now = Date.now();
    for (const entry of this.workers.values()) {
      if (entry.state === "dead") continue;

      const elapsed = now - entry.lastHeartbeatAt;
      if (elapsed > this.deadThresholdMs) {
        this.transition(entry, "dead");
      } else if (elapsed > this.staleThresholdMs && entry.state !== "stale") {
        this.transition(entry, "stale");
      }
    }
  }

  /** Transition a worker to a new state and emit a bus event. */
  private transition(entry: HealthEntry, next: HealthState): void {
    const prev = entry.state;
    if (prev === next) return;
    entry.state = next;
    sharedBus.emit(BusChannel.WORKER_HEALTH_CHANGED, {
      runId: entry.runId,
      previousState: prev,
      currentState: next,
    });
  }
}

/**
 * Module-level health monitor singleton.
 * Used by worker-spawn.ts to record heartbeats and process exits.
 * Used by the dispatch extension to query health state.
 */
export const healthMonitor = new WorkerHealthMonitor(
  Number.parseInt(process.env.PANCODE_HEARTBEAT_INTERVAL_MS ?? "", 10) || DEFAULT_HEARTBEAT_INTERVAL_MS,
);
