import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { atomicWriteJsonSync } from "../../core/config-writer";

export interface PanCodeTask {
  id: string;
  title: string;
  description: string;
  status: "todo" | "doing" | "done" | "blocked";
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
  runIds: string[];
}

const tasks = new Map<string, PanCodeTask>();
let persistPath = "";

export function initTaskStore(runtimeRoot: string): void {
  persistPath = join(runtimeRoot, "tasks.json");
  loadTasks();
}

function loadTasks(): void {
  if (!existsSync(persistPath)) return;
  try {
    const data = JSON.parse(readFileSync(persistPath, "utf8")) as PanCodeTask[];
    for (const task of data) tasks.set(task.id, task);
  } catch {
    /* non-fatal: corrupted task file is silently ignored */
  }
}

function persistTasks(): void {
  if (!persistPath) return;
  atomicWriteJsonSync(persistPath, [...tasks.values()]);
}

export function taskWrite(title: string, description: string): PanCodeTask {
  const task: PanCodeTask = {
    id: `t-${randomUUID().slice(0, 6)}`,
    title,
    description,
    status: "todo",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    completedAt: null,
    runIds: [],
  };
  tasks.set(task.id, task);
  persistTasks();
  return task;
}

export function taskCheck(id: string): PanCodeTask | null {
  const task = tasks.get(id);
  if (!task) return null;
  task.status = "done";
  task.completedAt = new Date().toISOString();
  task.updatedAt = new Date().toISOString();
  persistTasks();
  return task;
}

export function taskUpdate(
  id: string,
  patch: Partial<Pick<PanCodeTask, "title" | "description" | "status">>,
): PanCodeTask | null {
  const task = tasks.get(id);
  if (!task) return null;
  if (patch.title !== undefined) task.title = patch.title;
  if (patch.description !== undefined) task.description = patch.description;
  if (patch.status !== undefined) task.status = patch.status;
  task.updatedAt = new Date().toISOString();
  if (patch.status === "done") task.completedAt = new Date().toISOString();
  persistTasks();
  return task;
}

export function taskList(): PanCodeTask[] {
  return [...tasks.values()];
}

export function taskGet(id: string): PanCodeTask | null {
  return tasks.get(id) ?? null;
}

export function linkTaskToRun(taskId: string, runId: string): void {
  const task = tasks.get(taskId);
  if (task && !task.runIds.includes(runId)) {
    task.runIds.push(runId);
    task.updatedAt = new Date().toISOString();
    persistTasks();
  }
}
