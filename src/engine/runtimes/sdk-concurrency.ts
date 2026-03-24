/**
 * Concurrency limiter for SDK runtime in-process execution.
 *
 * The Claude Agent SDK's query() function runs as an in-process async generator.
 * Multiple concurrent SDK workers share the Node.js event loop. This module
 * provides a semaphore-based concurrency limiter with bounded queueing and
 * backpressure signaling.
 *
 * Default concurrency: 4 (configurable via PANCODE_SDK_CONCURRENCY).
 * Default max queue depth: 16 (configurable via PANCODE_SDK_QUEUE_DEPTH).
 */

/** Resolve the concurrency limit from environment or default. */
function resolveConcurrency(): number {
  const env = Number.parseInt(process.env.PANCODE_SDK_CONCURRENCY ?? "", 10);
  return Number.isFinite(env) && env > 0 ? env : 4;
}

/** Resolve the max queue depth from environment or default. */
function resolveMaxQueue(): number {
  const env = Number.parseInt(process.env.PANCODE_SDK_QUEUE_DEPTH ?? "", 10);
  return Number.isFinite(env) && env > 0 ? env : 16;
}

interface QueuedTask<T> {
  execute: () => Promise<T>;
  resolve: (value: T) => void;
  reject: (err: unknown) => void;
  signal?: AbortSignal;
}

export interface ConcurrencyLimiterStats {
  running: number;
  queued: number;
  maxConcurrency: number;
  maxQueue: number;
  totalExecuted: number;
  totalRejected: number;
}

/**
 * Semaphore-based concurrency limiter for SDK executions.
 *
 * When all slots are occupied, tasks are queued up to maxQueue depth.
 * Beyond that, new tasks are rejected with a backpressure error.
 */
export class SdkConcurrencyLimiter {
  private readonly maxConcurrency: number;
  private readonly maxQueue: number;
  private running = 0;
  private readonly queue: Array<QueuedTask<unknown>> = [];
  private totalExecuted = 0;
  private totalRejected = 0;

  constructor(maxConcurrency?: number, maxQueue?: number) {
    this.maxConcurrency = maxConcurrency ?? resolveConcurrency();
    this.maxQueue = maxQueue ?? resolveMaxQueue();
  }

  /**
   * Execute a task within the concurrency limit.
   * Returns immediately if a slot is available, otherwise queues the task.
   * Rejects if the queue is full (backpressure).
   */
  async execute<T>(task: () => Promise<T>, signal?: AbortSignal): Promise<T> {
    if (signal?.aborted) {
      throw new Error("SDK execution cancelled before start.");
    }

    if (this.running < this.maxConcurrency) {
      return this.runTask(task);
    }

    if (this.queue.length >= this.maxQueue) {
      this.totalRejected++;
      throw new Error(
        `SDK concurrency queue full (${this.queue.length}/${this.maxQueue}). ` +
          `${this.running} workers running. Try again later or increase PANCODE_SDK_QUEUE_DEPTH.`,
      );
    }

    return new Promise<T>((resolve, reject) => {
      const queued: QueuedTask<T> = {
        execute: task,
        resolve,
        reject,
        signal,
      };

      // If the signal aborts while queued, remove from queue and reject.
      if (signal) {
        const onAbort = () => {
          const idx = this.queue.indexOf(queued as QueuedTask<unknown>);
          if (idx !== -1) {
            this.queue.splice(idx, 1);
            reject(new Error("SDK execution cancelled while queued."));
          }
        };
        signal.addEventListener("abort", onAbort, { once: true });
      }

      this.queue.push(queued as QueuedTask<unknown>);
    });
  }

  /** Current limiter statistics for diagnostics. */
  stats(): ConcurrencyLimiterStats {
    return {
      running: this.running,
      queued: this.queue.length,
      maxConcurrency: this.maxConcurrency,
      maxQueue: this.maxQueue,
      totalExecuted: this.totalExecuted,
      totalRejected: this.totalRejected,
    };
  }

  /** True when at least one execution slot is available. */
  hasCapacity(): boolean {
    return this.running < this.maxConcurrency;
  }

  private async runTask<T>(task: () => Promise<T>): Promise<T> {
    this.running++;
    try {
      const result = await task();
      this.totalExecuted++;
      return result;
    } finally {
      this.running--;
      this.drainQueue();
    }
  }

  private drainQueue(): void {
    while (this.running < this.maxConcurrency && this.queue.length > 0) {
      const next = this.queue.shift();
      if (!next) break;

      // Skip tasks whose signal was aborted while queued.
      if (next.signal?.aborted) {
        next.reject(new Error("SDK execution cancelled while queued."));
        continue;
      }

      this.running++;
      next
        .execute()
        .then((result) => {
          this.totalExecuted++;
          next.resolve(result);
        })
        .catch((err) => {
          next.reject(err);
        })
        .finally(() => {
          this.running--;
          this.drainQueue();
        });

      // Only dequeue one at a time per slot release; the .finally above
      // will call drainQueue again when that task completes.
      break;
    }
  }
}

/**
 * Singleton concurrency limiter for SDK executions.
 * Used by spawnWorkerSdkPath in worker-spawn.ts to gate concurrent SDK workers.
 */
export const sdkLimiter = new SdkConcurrencyLimiter();
