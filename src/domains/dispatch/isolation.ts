/**
 * Worktree isolation for dispatch workers.
 * When --isolate is set, the worker runs in a git worktree.
 * Changes are captured as a delta patch and merged back to the parent.
 */

import { execFile as execFileCb } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, readdirSync, writeFileSync, unlinkSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { promisify } from "node:util";

const execFile = promisify(execFileCb);

export interface DeltaPatch {
  path: string;
  content: string;
}

export interface MergeResult {
  success: boolean;
  appliedPatches: string[];
  failedPatches: string[];
  error?: string;
}

export interface IsolationEnvironment {
  workDir: string;
  cleanup: () => Promise<void>;
  captureDelta: () => Promise<DeltaPatch[]>;
}

async function git(args: string[], cwd: string): Promise<string> {
  const { stdout } = await execFile("git", args, { cwd, maxBuffer: 50 * 1024 * 1024 });
  return stdout;
}

async function gitSilent(args: string[], cwd: string): Promise<string> {
  try {
    return await git(args, cwd);
  } catch {
    return "";
  }
}

interface Baseline {
  stagedDiff: string;
  unstagedDiff: string;
  untrackedFiles: Array<{ relativePath: string; content: Buffer }>;
}

async function captureBaseline(repoRoot: string): Promise<Baseline> {
  const stagedDiff = await gitSilent(["diff", "--cached", "--binary"], repoRoot);
  const unstagedDiff = await gitSilent(["diff", "--binary"], repoRoot);

  const untrackedOutput = await gitSilent(
    ["ls-files", "--others", "--exclude-standard", "-z"],
    repoRoot,
  );
  const untrackedPaths = untrackedOutput.split("\0").filter((p) => p.length > 0);

  const untrackedFiles: Array<{ relativePath: string; content: Buffer }> = [];
  for (const relativePath of untrackedPaths) {
    const fullPath = join(repoRoot, relativePath);
    try {
      const stat = statSync(fullPath);
      if (stat.isFile() && stat.size < 10 * 1024 * 1024) {
        untrackedFiles.push({ relativePath, content: readFileSync(fullPath) });
      }
    } catch {
      // Skip unreadable
    }
  }

  return { stagedDiff, unstagedDiff, untrackedFiles };
}

async function applyBaseline(worktreeDir: string, baseline: Baseline): Promise<void> {
  if (baseline.stagedDiff.trim()) {
    const patchPath = join(worktreeDir, ".pancode-staged.patch");
    writeFileSync(patchPath, baseline.stagedDiff);
    try {
      await git(["apply", "--binary", patchPath], worktreeDir);
      await git(["add", "-A"], worktreeDir);
    } catch (err) {
      // Non-fatal: the worker starts without the staged changes in its baseline.
      console.warn(
        `[pancode:dispatch] Staged baseline apply failed for worktree (worker may start with partial state): ` +
        `${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      unlinkSync(patchPath);
    }
  }

  if (baseline.unstagedDiff.trim()) {
    const patchPath = join(worktreeDir, ".pancode-unstaged.patch");
    writeFileSync(patchPath, baseline.unstagedDiff);
    try {
      await git(["apply", "--binary", patchPath], worktreeDir);
    } catch (err) {
      // Non-fatal: the worker starts without the unstaged changes in its baseline.
      console.warn(
        `[pancode:dispatch] Unstaged baseline apply failed for worktree (worker may start with partial state): ` +
        `${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      unlinkSync(patchPath);
    }
  }

  for (const file of baseline.untrackedFiles) {
    const dest = join(worktreeDir, file.relativePath);
    mkdirSync(dirname(dest), { recursive: true });
    writeFileSync(dest, file.content);
  }

  await gitSilent(["add", "-A"], worktreeDir);
  await gitSilent(["commit", "--allow-empty", "-m", "pancode: baseline snapshot"], worktreeDir);
}

const activeWorktrees = new Set<string>();

export async function createWorktreeIsolation(
  repoRoot: string,
  taskId: string,
): Promise<IsolationEnvironment> {
  const worktreeDir = join(repoRoot, ".pancode", "worktrees", taskId);

  mkdirSync(dirname(worktreeDir), { recursive: true });

  try {
    await git(["worktree", "remove", "--force", worktreeDir], repoRoot);
  } catch {
    // Doesn't exist
  }
  rmSync(worktreeDir, { recursive: true, force: true });

  await git(["worktree", "add", "--detach", worktreeDir, "HEAD"], repoRoot);

  const baseline = await captureBaseline(repoRoot);
  await applyBaseline(worktreeDir, baseline);
  activeWorktrees.add(worktreeDir);

  return {
    workDir: worktreeDir,

    async captureDelta(): Promise<DeltaPatch[]> {
      const patches: DeltaPatch[] = [];
      await gitSilent(["add", "-A"], worktreeDir);
      const diff = await gitSilent(["diff", "--cached", "--binary", "HEAD"], worktreeDir);

      if (diff.trim()) {
        patches.push({ path: join(worktreeDir, "delta.patch"), content: diff });
      }
      return patches;
    },

    async cleanup(): Promise<void> {
      activeWorktrees.delete(worktreeDir);
      try {
        await Promise.race([
          git(["worktree", "remove", "--force", worktreeDir], repoRoot),
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error("Worktree cleanup timed out")), 10000),
          ),
        ]);
      } catch {
        rmSync(worktreeDir, { recursive: true, force: true });
      }
    },
  };
}

export async function mergeDeltaPatches(
  repoRoot: string,
  patches: DeltaPatch[],
): Promise<MergeResult> {
  if (patches.length === 0) {
    return { success: true, appliedPatches: [], failedPatches: [] };
  }

  const combined = patches.map((p) => p.content).join("\n");
  const patchFile = join(tmpdir(), `pancode-merge-${Date.now()}.patch`);
  const appliedPatches: string[] = [];
  const failedPatches: string[] = [];

  try {
    writeFileSync(patchFile, combined);

    try {
      await git(["apply", "--check", "--binary", patchFile], repoRoot);
    } catch (err) {
      for (const p of patches) failedPatches.push(p.path);
      return {
        success: false,
        appliedPatches,
        failedPatches,
        error: `Patch conflict: ${err instanceof Error ? err.message : String(err)}`,
      };
    }

    await git(["apply", "--binary", patchFile], repoRoot);
    for (const p of patches) appliedPatches.push(p.path);

    return { success: true, appliedPatches, failedPatches };
  } finally {
    try {
      unlinkSync(patchFile);
    } catch {
      // Best effort
    }
  }
}

export async function cleanupAllWorktrees(): Promise<void> {
  for (const dir of activeWorktrees) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // Best effort
    }
  }
  activeWorktrees.clear();
}
