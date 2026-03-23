import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { atomicWriteJsonSync } from "../../core/config-writer";

export interface BudgetState {
  totalCost: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  ceiling: number;
  runsCount: number;
}

export class BudgetTracker {
  private state: BudgetState;
  private readonly persistPath: string;

  constructor(runtimeRoot: string, ceiling = 10.0) {
    this.persistPath = join(runtimeRoot, "budget.json");
    this.state = {
      totalCost: 0,
      totalInputTokens: 0,
      totalOutputTokens: 0,
      ceiling,
      runsCount: 0,
    };
    this.load();
  }

  private load(): void {
    if (!existsSync(this.persistPath)) return;
    try {
      const raw = readFileSync(this.persistPath, "utf8");
      const saved = JSON.parse(raw) as Partial<BudgetState>;
      this.state = { ...this.state, ...saved };
    } catch {
      // Keep defaults
    }
  }

  persist(): void {
    atomicWriteJsonSync(this.persistPath, this.state);
  }

  recordCost(cost: number | null, inputTokens: number | null, outputTokens: number | null): void {
    if (cost != null) this.state.totalCost += cost;
    if (inputTokens != null) this.state.totalInputTokens += inputTokens;
    if (outputTokens != null) this.state.totalOutputTokens += outputTokens;
    this.state.runsCount += 1;
    this.persist();
  }

  canAdmit(estimatedCost = 0): boolean {
    return this.state.totalCost + estimatedCost <= this.state.ceiling;
  }

  getState(): BudgetState {
    return { ...this.state };
  }

  setCeiling(ceiling: number): void {
    this.state.ceiling = ceiling;
    this.persist();
  }

  remaining(): number {
    return Math.max(0, this.state.ceiling - this.state.totalCost);
  }

  resetSession(): void {
    this.state.totalCost = 0;
    this.state.totalInputTokens = 0;
    this.state.totalOutputTokens = 0;
    this.state.runsCount = 0;
    this.persist();
  }

  serialize(): BudgetState {
    return { ...this.state };
  }

  deserialize(data: BudgetState): void {
    this.state = { ...this.state, ...data };
  }
}
