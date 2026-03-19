import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

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
    const dir = dirname(this.persistPath);
    mkdirSync(dir, { recursive: true });
    writeFileSync(this.persistPath, JSON.stringify(this.state, null, 2), "utf8");
  }

  recordCost(cost: number, inputTokens: number, outputTokens: number): void {
    this.state.totalCost += cost;
    this.state.totalInputTokens += inputTokens;
    this.state.totalOutputTokens += outputTokens;
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
