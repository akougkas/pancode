/**
 * Dispatch durability modes for worker lifecycle management.
 *
 * Three modes:
 *   "ephemeral"  - worker spawns, executes one task, exits (current default)
 *   "standard"   - worker persists across dispatches within a session
 *   "daemon"     - worker outlives the orchestrator session
 *
 * The ephemeral mode is the current implementation. Standard and daemon
 * modes extend the worker pool with persistent process management.
 */

export type DurabilityMode = "ephemeral" | "standard" | "daemon";

export interface DurabilityConfig {
  mode: DurabilityMode;
  /** Maximum idle time before a standard worker is reaped (milliseconds). */
  maxIdleMs: number;
  /** Maximum memory growth before a standard worker is recycled (bytes). */
  maxMemoryBytes: number;
  /** Unix socket path for daemon workers (auto-generated if null). */
  socketPath: string | null;
}

export interface PersistentWorker {
  /** Unique worker ID. */
  id: string;
  /** Agent type this worker serves. */
  agentType: string;
  /** Runtime ID. */
  runtime: string;
  /** Process ID of the worker. */
  pid: number;
  /** When the worker was spawned. */
  spawnedAt: number;
  /** Last task completion time. */
  lastActiveAt: number;
  /** Number of tasks completed by this worker. */
  tasksCompleted: number;
  /** Current durability mode. */
  durability: DurabilityMode;
  /** Whether the worker is currently executing a task. */
  busy: boolean;
}

/** Default durability config: ephemeral, no persistence. */
export const DEFAULT_DURABILITY: DurabilityConfig = {
  mode: "ephemeral",
  maxIdleMs: 300_000, // 5 minutes
  maxMemoryBytes: 512 * 1024 * 1024, // 512 MB
  socketPath: null,
};

/**
 * Parse durability mode from environment or agent spec.
 */
export function parseDurabilityMode(value: string | undefined): DurabilityMode {
  switch (value?.toLowerCase()) {
    case "standard":
      return "standard";
    case "daemon":
      return "daemon";
    default:
      return "ephemeral";
  }
}

/**
 * Check whether a persistent worker should be reaped due to idle timeout.
 */
export function shouldReapWorker(worker: PersistentWorker, config: DurabilityConfig): boolean {
  if (worker.busy) return false;
  if (worker.durability === "ephemeral") return true;
  if (worker.durability === "daemon") return false;

  // Standard mode: reap if idle too long
  const idleMs = Date.now() - worker.lastActiveAt;
  return idleMs > config.maxIdleMs;
}

/**
 * In-memory registry of persistent workers.
 * Tracks workers that outlive a single dispatch.
 */
export class PersistentWorkerRegistry {
  private readonly workers = new Map<string, PersistentWorker>();

  register(worker: PersistentWorker): void {
    this.workers.set(worker.id, worker);
  }

  unregister(workerId: string): void {
    this.workers.delete(workerId);
  }

  get(workerId: string): PersistentWorker | undefined {
    return this.workers.get(workerId);
  }

  /**
   * Find an idle worker for the given agent type and runtime.
   * Returns the longest-idle worker to maximize context freshness.
   */
  findIdle(agentType: string, runtime: string): PersistentWorker | null {
    let best: PersistentWorker | null = null;
    let bestIdleTime = -1;

    for (const worker of this.workers.values()) {
      if (worker.agentType !== agentType || worker.runtime !== runtime) continue;
      if (worker.busy) continue;

      const idleTime = Date.now() - worker.lastActiveAt;
      if (idleTime > bestIdleTime) {
        bestIdleTime = idleTime;
        best = worker;
      }
    }

    return best;
  }

  /**
   * Get all workers that should be reaped based on the durability config.
   */
  getReapable(config: DurabilityConfig): PersistentWorker[] {
    return [...this.workers.values()].filter((w) => shouldReapWorker(w, config));
  }

  getAll(): PersistentWorker[] {
    return [...this.workers.values()];
  }

  clear(): void {
    this.workers.clear();
  }
}

export const persistentWorkerRegistry = new PersistentWorkerRegistry();
