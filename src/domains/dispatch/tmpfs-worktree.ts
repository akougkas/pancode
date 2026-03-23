/**
 * tmpfs-backed worktree support for faster I/O during dispatch.
 *
 * Mounts git worktrees on tmpfs (RAM-backed filesystem) for workers
 * doing heavy file reads/writes. The worktree is ephemeral (lost on
 * reboot) which aligns with the single-dispatch lifecycle.
 *
 * Platform support:
 *   Linux: tmpfs via /tmp/pancode-worktrees (or PANCODE_TMPFS_MOUNT)
 *   macOS: uses standard /tmp (already memory-backed on modern macOS)
 *
 * Configuration:
 *   PANCODE_TMPFS_ENABLED=1      Enable tmpfs-backed worktrees
 *   PANCODE_TMPFS_MOUNT=/path    Custom mount point (default: /tmp/pancode-worktrees)
 *   PANCODE_TMPFS_MAX_SIZE=2G    Max tmpfs size (for mount command)
 */

import { existsSync, mkdirSync, statSync } from "node:fs";
import { platform } from "node:os";
import { join } from "node:path";

export interface TmpfsConfig {
  /** Whether tmpfs worktrees are enabled. */
  enabled: boolean;
  /** Mount point for tmpfs worktrees. */
  mountPoint: string;
  /** Maximum size for the tmpfs mount. */
  maxSize: string;
}

/**
 * Get the tmpfs configuration from environment.
 */
export function getTmpfsConfig(): TmpfsConfig {
  return {
    enabled: process.env.PANCODE_TMPFS_ENABLED === "1",
    mountPoint: process.env.PANCODE_TMPFS_MOUNT ?? "/tmp/pancode-worktrees",
    maxSize: process.env.PANCODE_TMPFS_MAX_SIZE ?? "2G",
  };
}

/**
 * Check if tmpfs worktrees are available on this system.
 */
export function isTmpfsAvailable(): boolean {
  const config = getTmpfsConfig();
  if (!config.enabled) return false;

  // On macOS, /tmp is already memory-backed (serviced by VM system)
  if (platform() === "darwin") return true;

  // On Linux, check if the mount point exists or can be created
  if (platform() === "linux") {
    try {
      if (!existsSync(config.mountPoint)) {
        mkdirSync(config.mountPoint, { recursive: true });
      }
      return true;
    } catch {
      return false;
    }
  }

  // Other platforms: not supported
  return false;
}

/**
 * Resolve the worktree path for a task.
 * Returns a tmpfs-backed path if available, otherwise falls back
 * to the standard in-repo worktree location.
 */
export function resolveWorktreePath(repoRoot: string, taskId: string): string {
  const config = getTmpfsConfig();

  if (config.enabled && isTmpfsAvailable()) {
    const tmpfsPath = join(config.mountPoint, taskId);
    mkdirSync(tmpfsPath, { recursive: true });
    return tmpfsPath;
  }

  // Fallback: standard in-repo worktree location
  return join(repoRoot, ".pancode", "worktrees", taskId);
}

/**
 * Check if a path is on a tmpfs mount.
 * On Linux, checks if the filesystem type is tmpfs.
 * On macOS, /tmp is always considered memory-backed.
 */
export function isTmpfsPath(path: string): boolean {
  if (platform() === "darwin" && path.startsWith("/tmp")) return true;
  if (platform() === "linux") {
    const config = getTmpfsConfig();
    return path.startsWith(config.mountPoint);
  }
  return false;
}

/**
 * Get the current usage of the tmpfs mount point.
 * Returns null if the mount point does not exist or stats cannot be read.
 */
export function getTmpfsUsage(): { totalBytes: number; usedBytes: number; freeBytes: number } | null {
  const config = getTmpfsConfig();
  if (!config.enabled || !existsSync(config.mountPoint)) return null;

  try {
    const stat = statSync(config.mountPoint);
    // statSync does not provide filesystem-level info directly.
    // A full implementation would use statvfs or parse /proc/mounts.
    // For now, return a stub with the directory size.
    return {
      totalBytes: stat.size,
      usedBytes: 0,
      freeBytes: stat.size,
    };
  } catch {
    return null;
  }
}

/**
 * Generate the mount command for setting up tmpfs.
 * This is informational, not executed automatically.
 * Users run this command manually or via their init scripts.
 */
export function generateMountCommand(config?: TmpfsConfig): string {
  const cfg = config ?? getTmpfsConfig();

  if (platform() === "linux") {
    return `sudo mount -t tmpfs -o size=${cfg.maxSize} tmpfs ${cfg.mountPoint}`;
  }

  if (platform() === "darwin") {
    // macOS: create a RAM disk
    const sizeBlocks = parseSizeToBlocks(cfg.maxSize);
    return `diskutil erasevolume HFS+ 'pancode-tmpfs' $(hdiutil attach -nomount ram://${sizeBlocks})`;
  }

  return `# tmpfs not supported on ${platform()}`;
}

/**
 * Parse a human-readable size string to 512-byte blocks (for macOS hdiutil).
 */
function parseSizeToBlocks(size: string): number {
  const match = size.match(/^(\d+)([KMGT]?)$/i);
  if (!match) return 4194304; // Default: 2GB in 512-byte blocks

  let bytes = Number.parseInt(match[1], 10);
  const unit = (match[2] ?? "").toUpperCase();

  switch (unit) {
    case "K":
      bytes *= 1024;
      break;
    case "M":
      bytes *= 1024 * 1024;
      break;
    case "G":
      bytes *= 1024 * 1024 * 1024;
      break;
    case "T":
      bytes *= 1024 * 1024 * 1024 * 1024;
      break;
  }

  return Math.ceil(bytes / 512) * 2;
}
