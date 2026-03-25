import { existsSync, mkdirSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { getDataDir } from "./xdg";

interface LockInfo {
  pid: number;
  acquiredAt: string;
}

function getLocksDir(): string {
  const dir = join(getDataDir(), "locks");
  mkdirSync(dir, { recursive: true });
  return dir;
}

function lockPath(sessionId: string): string {
  return join(getLocksDir(), `${sessionId}.lock`);
}

function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * Acquire a session lock for the given session ID.
 *
 * If a lock file already exists, the owning PID is checked. Stale locks
 * (where the owning process has exited) are automatically removed. If the
 * owning process is still alive, an error is thrown.
 */
export function acquireSessionLock(sessionId: string): void {
  const path = lockPath(sessionId);

  if (existsSync(path)) {
    try {
      const raw = readFileSync(path, "utf8");
      const info: LockInfo = JSON.parse(raw);

      if (isPidAlive(info.pid)) {
        throw new Error(`Session "${sessionId}" is locked by PID ${info.pid}`);
      }

      // Stale lock from a dead process. Remove it.
      unlinkSync(path);
    } catch (err) {
      // If the error is our own "locked by PID" error, re-throw it.
      if (err instanceof Error && err.message.startsWith("Session")) {
        throw err;
      }
      // Otherwise the lock file was corrupted or unreadable. Remove and proceed.
      try {
        unlinkSync(path);
      } catch {
        // Ignore ENOENT if another process already removed it.
      }
    }
  }

  const info: LockInfo = {
    pid: process.pid,
    acquiredAt: new Date().toISOString(),
  };
  writeFileSync(path, JSON.stringify(info, null, 2), "utf8");
}

/**
 * Release the session lock for the given session ID.
 * No-op if the lock file does not exist.
 */
export function releaseSessionLock(sessionId: string): void {
  try {
    unlinkSync(lockPath(sessionId));
  } catch (err) {
    // Ignore ENOENT. Propagate unexpected errors.
    if (err instanceof Error && "code" in err && (err as NodeJS.ErrnoException).code !== "ENOENT") {
      throw err;
    }
  }
}

/**
 * Release all session locks owned by the current process.
 * Locks belonging to other processes are left intact.
 */
export function releaseAllSessionLocks(): void {
  const dir = getLocksDir();
  let files: string[];
  try {
    files = readdirSync(dir).filter((f) => f.endsWith(".lock"));
  } catch {
    return;
  }

  for (const file of files) {
    const fullPath = join(dir, file);
    try {
      const raw = readFileSync(fullPath, "utf8");
      const info: LockInfo = JSON.parse(raw);
      if (info.pid === process.pid) {
        unlinkSync(fullPath);
      }
    } catch {
      // Skip files that cannot be read or parsed.
    }
  }
}
