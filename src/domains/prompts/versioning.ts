// Prompt version persistence.
// Tracks compilation manifests in .pancode/state/prompt-versions/ for
// development iteration, debugging, and regression detection.

import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { PromptManifest, PromptRole } from "./types";

/** Subdirectory under runtimeRoot for prompt version state. */
const PROMPT_DIR = "prompt-versions";

function ensureDir(dirPath: string): void {
  if (!existsSync(dirPath)) {
    mkdirSync(dirPath, { recursive: true });
  }
}

function manifestPath(runtimeRoot: string, role: PromptRole): string {
  return join(runtimeRoot, PROMPT_DIR, `${role}-latest.json`);
}

function historyPath(runtimeRoot: string): string {
  return join(runtimeRoot, PROMPT_DIR, "history.ndjson");
}

/**
 * Persist a compilation manifest to disk (atomic write).
 */
export function persistPromptManifest(runtimeRoot: string, manifest: PromptManifest): void {
  const filePath = manifestPath(runtimeRoot, manifest.role);
  ensureDir(dirname(filePath));
  const tmp = `${filePath}.tmp.${process.pid}`;
  writeFileSync(tmp, JSON.stringify(manifest, null, 2), "utf8");
  const { renameSync } = require("node:fs") as typeof import("node:fs");
  renameSync(tmp, filePath);
}

/**
 * Load the latest manifest for a given role.
 * Returns null if no manifest exists or the file is corrupt.
 */
export function loadLatestManifest(runtimeRoot: string, role: PromptRole): PromptManifest | null {
  const filePath = manifestPath(runtimeRoot, role);
  if (!existsSync(filePath)) return null;
  try {
    return JSON.parse(readFileSync(filePath, "utf8")) as PromptManifest;
  } catch {
    return null;
  }
}

/**
 * Append a compilation record to the NDJSON history log.
 * Each line is a complete JSON object for easy parsing and streaming.
 */
export function appendToHistory(runtimeRoot: string, manifest: PromptManifest): void {
  const filePath = historyPath(runtimeRoot);
  ensureDir(dirname(filePath));
  appendFileSync(filePath, `${JSON.stringify(manifest)}\n`, "utf8");
}

/**
 * Load recent compilation history (most recent N entries).
 * Reads the NDJSON file and returns parsed entries in chronological order.
 */
export function loadHistory(runtimeRoot: string, count = 20): PromptManifest[] {
  const filePath = historyPath(runtimeRoot);
  if (!existsSync(filePath)) return [];
  try {
    const lines = readFileSync(filePath, "utf8").trim().split("\n").filter(Boolean);
    const entries: PromptManifest[] = [];
    for (const line of lines) {
      try {
        entries.push(JSON.parse(line) as PromptManifest);
      } catch {
        // Skip corrupt lines.
      }
    }
    return entries.slice(-count);
  } catch {
    return [];
  }
}

/**
 * Compare two manifests and produce a human-readable diff summary.
 */
export function diffManifests(a: PromptManifest, b: PromptManifest): string {
  const lines: string[] = [];

  if (a.role !== b.role) lines.push(`Role: ${a.role} -> ${b.role}`);
  if (a.tier !== b.tier) lines.push(`Tier: ${a.tier} -> ${b.tier}`);
  if (a.mode !== b.mode) lines.push(`Mode: ${a.mode} -> ${b.mode}`);
  if (a.estimatedTokens !== b.estimatedTokens) {
    lines.push(`Tokens: ${a.estimatedTokens} -> ${b.estimatedTokens}`);
  }
  if (a.hash !== b.hash) lines.push(`Hash: ${a.hash.slice(0, 12)} -> ${b.hash.slice(0, 12)}`);

  const addedFragments = b.fragmentIds.filter((id) => !a.fragmentIds.includes(id));
  const removedFragments = a.fragmentIds.filter((id) => !b.fragmentIds.includes(id));
  if (addedFragments.length > 0) lines.push(`Added: ${addedFragments.join(", ")}`);
  if (removedFragments.length > 0) lines.push(`Removed: ${removedFragments.join(", ")}`);

  return lines.length > 0 ? lines.join("\n") : "No changes.";
}
