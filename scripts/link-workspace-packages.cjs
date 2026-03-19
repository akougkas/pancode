#!/usr/bin/env node
/**
 * link-workspace-packages.cjs
 *
 * Creates node_modules/@pancode/* symlinks pointing to packages/* directories.
 *
 * During development, npm workspaces creates these automatically. But in the
 * published tarball, workspace packages are shipped under packages/ (via the
 * "files" field) and the @pancode/* imports in compiled code need
 * node_modules/@pancode/* to resolve. This script bridges the gap.
 *
 * Runs as part of postinstall (before any ESM code that imports @pancode/*).
 *
 * On Windows without Developer Mode or administrator rights, creating symlinks
 * (even NTFS junctions) can fail with EPERM. Falls back to cpSync.
 */
const { existsSync, mkdirSync, symlinkSync, cpSync, lstatSync, readlinkSync, unlinkSync } = require("fs");
const { resolve, join } = require("path");

const root = resolve(__dirname, "..");
const packagesDir = join(root, "packages");
const nodeModulesPancode = join(root, "node_modules", "@pancode");

const packageMap = {
  "pi-agent-core": "pi-agent-core",
  "pi-ai": "pi-ai",
  "pi-coding-agent": "pi-coding-agent",
  "pi-tui": "pi-tui",
};

if (!existsSync(nodeModulesPancode)) {
  mkdirSync(nodeModulesPancode, { recursive: true });
}

let linked = 0;
let copied = 0;
for (const [dir, name] of Object.entries(packageMap)) {
  const source = join(packagesDir, dir);
  const target = join(nodeModulesPancode, name);

  if (!existsSync(source)) continue;

  if (existsSync(target)) {
    try {
      const stat = lstatSync(target);
      if (stat.isSymbolicLink()) {
        const linkTarget = readlinkSync(target);
        if (resolve(join(nodeModulesPancode, linkTarget)) === source || linkTarget === source) {
          continue;
        }
        unlinkSync(target);
      } else {
        continue;
      }
    } catch {
      continue;
    }
  }

  let symlinkOk = false;
  try {
    symlinkSync(source, target, "junction");
    symlinkOk = true;
    linked++;
  } catch {
    // Symlink failed, fall back to copy
  }

  if (!symlinkOk) {
    try {
      cpSync(source, target, { recursive: true });
      copied++;
    } catch {
      // Non-fatal
    }
  }
}

if (linked > 0) process.stderr.write(`  Linked ${linked} workspace package${linked !== 1 ? "s" : ""}\n`);
if (copied > 0) process.stderr.write(`  Copied ${copied} workspace package${copied !== 1 ? "s" : ""} (symlinks unavailable)\n`);
