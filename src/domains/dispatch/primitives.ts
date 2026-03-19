import { spawnWorker, type WorkerResult } from "./worker-spawn";
import type { SamplingPreset } from "../providers";
import { type OutputContract, type ValidationResult, validateOutput } from "./validation";

export interface ParallelTask {
  task: string;
  tools: string;
  model: string | null;
  systemPrompt: string;
  cwd: string;
  agentName?: string;
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
        agentName: task.agentName,
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

// === Chain dispatch ===

export interface ChainStep {
  task: string;
  agent?: string;
  outputContract?: OutputContract;
}

export interface ChainStepResult {
  stepIndex: number;
  agent: string;
  task: string;
  result: WorkerResult;
  validation?: ValidationResult;
  durationMs: number;
}

export interface ChainResult {
  steps: ChainStepResult[];
  finalOutput: string;
  success: boolean;
  failedAtStep?: number;
}

const MAX_SUBSTITUTED_OUTPUT = 8000;

export async function dispatchChain(
  steps: ChainStep[],
  originalTask: string,
  defaultAgent: string,
  spawnFn: (task: string, agent: string) => Promise<WorkerResult>,
  cwd: string,
  signal?: AbortSignal,
): Promise<ChainResult> {
  const results: ChainStepResult[] = [];
  let previousOutput = "";

  for (let i = 0; i < steps.length; i++) {
    if (signal?.aborted) {
      return { steps: results, finalOutput: previousOutput, success: false, failedAtStep: i };
    }

    const step = steps[i];
    const agent = step.agent ?? defaultAgent;
    const cappedPrevious = previousOutput.slice(0, MAX_SUBSTITUTED_OUTPUT);
    const cappedOriginal = originalTask.slice(0, MAX_SUBSTITUTED_OUTPUT);

    // Token substitution: $INPUT is previous step output, $ORIGINAL is the initial task
    const task = step.task
      .replace(/\$INPUT/g, cappedPrevious)
      .replace(/\$ORIGINAL/g, cappedOriginal);

    const startTime = Date.now();
    const result = await spawnFn(task, agent);
    const durationMs = Date.now() - startTime;

    // Optional output contract validation
    let validation: ValidationResult | undefined;
    if (step.outputContract) {
      validation = validateOutput(result.result, cwd, step.outputContract);
    }

    results.push({ stepIndex: i, agent, task, result, validation, durationMs });

    if (result.exitCode !== 0 || result.error) {
      return { steps: results, finalOutput: result.result, success: false, failedAtStep: i };
    }

    if (validation && !validation.valid) {
      return { steps: results, finalOutput: result.result, success: false, failedAtStep: i };
    }

    previousOutput = result.result;
  }

  return { steps: results, finalOutput: previousOutput, success: true };
}
