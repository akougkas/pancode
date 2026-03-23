export type TerminationMode = "fail-fast" | "fail-tolerant" | "deadline";

export interface TerminationConfig {
  mode: TerminationMode;
  deadlineSeconds?: number;
}

export interface TerminationCheck {
  shouldTerminate: boolean;
  reason?: string;
}

export interface RunStatusEntry {
  id: string;
  status: "running" | "done" | "error" | "timeout" | "cancelled" | "interrupted" | "budget_exceeded";
}

export class TerminationPolicy {
  readonly config: TerminationConfig;
  private readonly batchStartTime: number;

  constructor(config: TerminationConfig = { mode: "fail-tolerant" }) {
    this.config = config;
    this.batchStartTime = Date.now();
  }

  check(runs: RunStatusEntry[]): TerminationCheck {
    switch (this.config.mode) {
      case "fail-fast":
        return this.checkFailFast(runs);
      case "deadline":
        return this.checkDeadline();
      default:
        return { shouldTerminate: false };
    }
  }

  isDeadlineExceeded(): boolean {
    if (this.config.mode !== "deadline" || !this.config.deadlineSeconds) return false;
    return Date.now() - this.batchStartTime > this.config.deadlineSeconds * 1000;
  }

  get elapsedMs(): number {
    return Date.now() - this.batchStartTime;
  }

  private checkFailFast(runs: RunStatusEntry[]): TerminationCheck {
    const failed = runs.find((run) => run.status === "error" || run.status === "timeout");
    if (!failed) return { shouldTerminate: false };

    return {
      shouldTerminate: true,
      reason: `Fail-fast: run ${failed.id} failed with status "${failed.status}"`,
    };
  }

  private checkDeadline(): TerminationCheck {
    if (!this.isDeadlineExceeded()) return { shouldTerminate: false };
    return {
      shouldTerminate: true,
      reason: `Deadline exceeded: ${this.config.deadlineSeconds}s`,
    };
  }
}

export const DEFAULT_TERMINATION: TerminationConfig = { mode: "fail-tolerant" };

/**
 * Multi-phase shutdown coordinator.
 *
 * Phase 1: DRAIN    Stop accepting new dispatch tasks.
 * Phase 2: TERMINATE  SIGTERM all workers, 3s timeout, SIGKILL survivors.
 *                     Update ledger: active runs marked "interrupted".
 * Phase 3: PERSIST   Safety net for any explicit flush handlers. Domain state
 *                     already persists on mutation (RunLedger, MetricsLedger,
 *                     BudgetTracker each write to their own file on change).
 * Phase 4: EXIT      UI tears down TUI, process.exit(0).
 */

export type ShutdownPhase = "idle" | "draining" | "terminating" | "persisting" | "exiting";

export type ShutdownHandler = () => void | Promise<void>;

export class ShutdownCoordinator {
  private phase: ShutdownPhase = "idle";
  private readonly drainHandlers: ShutdownHandler[] = [];
  private readonly terminateHandlers: ShutdownHandler[] = [];
  private readonly persistHandlers: ShutdownHandler[] = [];
  private readonly exitHandlers: ShutdownHandler[] = [];

  onDrain(handler: ShutdownHandler): void {
    this.drainHandlers.push(handler);
  }

  onTerminate(handler: ShutdownHandler): void {
    this.terminateHandlers.push(handler);
  }

  onPersist(handler: ShutdownHandler): void {
    this.persistHandlers.push(handler);
  }

  onExit(handler: ShutdownHandler): void {
    this.exitHandlers.push(handler);
  }

  getPhase(): ShutdownPhase {
    return this.phase;
  }

  isDraining(): boolean {
    return this.phase !== "idle";
  }

  async execute(): Promise<void> {
    if (this.phase !== "idle") return;

    // Phase 1: DRAIN
    this.phase = "draining";
    await this.runHandlers(this.drainHandlers, "drain");

    // Phase 2: TERMINATE
    this.phase = "terminating";
    await this.runHandlers(this.terminateHandlers, "terminate");

    // Phase 3: PERSIST
    this.phase = "persisting";
    await this.runHandlers(this.persistHandlers, "persist");

    // Phase 4: EXIT
    this.phase = "exiting";
    await this.runHandlers(this.exitHandlers, "exit");
  }

  private async runHandlers(handlers: ShutdownHandler[], phase: string): Promise<void> {
    for (const handler of handlers) {
      try {
        await handler();
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[pancode:shutdown:${phase}] Handler error: ${msg}`);
      }
    }
  }
}

export const shutdownCoordinator = new ShutdownCoordinator();
