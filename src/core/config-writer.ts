import { mkdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

export interface AtomicWriteOptions {
  lock?: "none" | "adjacent";
}

const LOCK_SLEEP_BUFFER = new SharedArrayBuffer(4);
const LOCK_SLEEP_VIEW = new Int32Array(LOCK_SLEEP_BUFFER);

function writeTempFile(path: string, contents: string): string {
  mkdirSync(dirname(path), { recursive: true });
  const tempPath = `${path}.tmp-${process.pid}-${Date.now()}`;
  writeFileSync(tempPath, contents, "utf8");
  return tempPath;
}

function sleepSync(ms: number): void {
  Atomics.wait(LOCK_SLEEP_VIEW, 0, 0, ms);
}

export function withFileLockSync<T>(path: string, fn: () => T, timeoutMs = 2000): T {
  mkdirSync(dirname(path), { recursive: true });
  const lockPath = `${path}.lock`;
  const deadline = Date.now() + timeoutMs;

  for (;;) {
    try {
      mkdirSync(lockPath);
      break;
    } catch (error) {
      const err = error as NodeJS.ErrnoException;
      if (err.code !== "EEXIST") {
        throw error;
      }
      if (Date.now() >= deadline) {
        throw new Error(`Timed out acquiring file lock for ${path}`);
      }
      sleepSync(10);
    }
  }

  try {
    return fn();
  } finally {
    rmSync(lockPath, { recursive: true, force: true });
  }
}

export function atomicWriteTextSync(path: string, contents: string, options?: AtomicWriteOptions): void {
  const write = () => {
    const tempPath = writeTempFile(path, contents);
    renameSync(tempPath, path);
  };

  if (options?.lock === "adjacent") {
    withFileLockSync(path, write);
    return;
  }

  write();
}

export function atomicWriteJsonSync(path: string, value: unknown, options?: AtomicWriteOptions): void {
  atomicWriteTextSync(path, `${JSON.stringify(value, null, 2)}\n`, options);
}
