import { randomUUID } from "node:crypto";

export interface BatchState {
  id: string;
  taskCount: number;
  completedCount: number;
  failedCount: number;
  runIds: string[];
  startedAt: string;
  completedAt: string | null;
}

export class BatchTracker {
  private readonly batches = new Map<string, BatchState>();

  create(taskCount: number): BatchState {
    const batch: BatchState = {
      id: randomUUID().slice(0, 8),
      taskCount,
      completedCount: 0,
      failedCount: 0,
      runIds: [],
      startedAt: new Date().toISOString(),
      completedAt: null,
    };
    this.batches.set(batch.id, batch);
    return batch;
  }

  addRun(batchId: string, runId: string): void {
    const batch = this.batches.get(batchId);
    if (batch) batch.runIds.push(runId);
  }

  markCompleted(batchId: string, success: boolean): void {
    const batch = this.batches.get(batchId);
    if (!batch) return;
    if (success) batch.completedCount++;
    else batch.failedCount++;
    if (batch.completedCount + batch.failedCount >= batch.taskCount) {
      batch.completedAt = new Date().toISOString();
    }
  }

  get(batchId: string): BatchState | undefined {
    return this.batches.get(batchId);
  }

  getAll(): BatchState[] {
    return [...this.batches.values()];
  }

  getRecent(count: number): BatchState[] {
    return [...this.batches.values()].slice(-count);
  }
}

export const batchTracker = new BatchTracker();
