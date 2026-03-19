import { spawnWorker, type WorkerResult } from "./worker-spawn";
import type { SamplingPreset } from "../providers";

export interface ParallelTask {
  task: string;
  tools: string;
  model: string | null;
  systemPrompt: string;
  cwd: string;
  sampling?: SamplingPreset | null;
  runId?: string;
}

export interface ParallelResult {
  task: string;
  result: WorkerResult;
}

const DEFAULT_CONCURRENCY = 4;

export async function runParallel(
  tasks: ParallelTask[],
  concurrency: number = DEFAULT_CONCURRENCY,
  signal?: AbortSignal,
): Promise<ParallelResult[]> {
  const results: ParallelResult[] = [];
  const queue = [...tasks];
  const active: Promise<void>[] = [];

  const runNext = async (): Promise<void> => {
    while (queue.length > 0) {
      if (signal?.aborted) break;
      const task = queue.shift()!;
      const workerResult = await spawnWorker({
        task: task.task,
        tools: task.tools,
        model: task.model,
        systemPrompt: task.systemPrompt,
        cwd: task.cwd,
        sampling: task.sampling,
        signal,
        runId: task.runId,
      });
      results.push({ task: task.task, result: workerResult });
    }
  };

  const effectiveConcurrency = Math.min(concurrency, tasks.length);
  for (let i = 0; i < effectiveConcurrency; i++) {
    active.push(runNext());
  }

  await Promise.all(active);
  return results;
}
