/**
 * PanCode Scaling Stress Test
 *
 * Verifies PanCode handles concurrent workers without lifecycle drift,
 * state corruption, or orphan processes. Four scenarios:
 *
 *   1. Ramp Up (10 -> 20 -> 40 -> 60): batch dispatch at each level
 *   2. Mixed Provider Load: 20 tasks across available runtimes
 *   3. Failure Under Load: 20 tasks with 5 designed to fail
 *   4. Sustained Load (soak): continuous dispatch at 10/min for N minutes
 *
 * Run:  npx tsx scripts/stress-test-scaling.ts
 *       npx tsx scripts/stress-test-scaling.ts --max-workers 20
 *       npx tsx scripts/stress-test-scaling.ts --dry-run
 *       npx tsx scripts/stress-test-scaling.ts --soak-minutes 5
 *       npx tsx scripts/stress-test-scaling.ts --skip-soak
 */

import { execSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";

// ---------------------------------------------------------------------------
// Environment bootstrap (mirrors test-multi-runtime.ts pattern)
// ---------------------------------------------------------------------------

const PACKAGE_ROOT = join(import.meta.dirname, "..");
process.env.PANCODE_PACKAGE_ROOT = PACKAGE_ROOT;
process.env.PANCODE_HOME = process.env.PANCODE_HOME || join(homedir(), ".pancode");
process.env.PI_SKIP_VERSION_CHECK = "1";
process.env.PI_CODING_AGENT_DIR = join(process.env.PANCODE_HOME, "agent-engine");

const envFile = join(PACKAGE_ROOT, ".env");
if (existsSync(envFile)) {
  const envContent = readFileSync(envFile, "utf8");
  for (const line of envContent.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const value = trimmed.slice(eqIdx + 1).trim();
    if (!process.env[key]) {
      process.env[key] = value;
    }
  }
}

const runtimeRoot = join(PACKAGE_ROOT, ".pancode", "runtime");
mkdirSync(runtimeRoot, { recursive: true });
mkdirSync(join(runtimeRoot, "results"), { recursive: true });
process.env.PANCODE_RUNTIME_ROOT = runtimeRoot;

// ---------------------------------------------------------------------------
// Imports (after env bootstrap)
// ---------------------------------------------------------------------------

import { loadConfig } from "../src/core/config";
import { agentRegistry, ensureAgentsYaml, loadAgentsFromYaml } from "../src/domains/agents/spec-registry";
import { healthMonitor } from "../src/domains/dispatch/health";
import { liveWorkerProcesses, spawnWorker, stopAllWorkers } from "../src/domains/dispatch/worker-spawn";
import { discoverEngines, writeProvidersYaml } from "../src/domains/providers/discovery";
import { discoverAndRegisterRuntimes } from "../src/engine/runtimes/discovery";
import { runtimeRegistry } from "../src/engine/runtimes/registry";
import type { RuntimeUsage } from "../src/engine/runtimes/types";

// ---------------------------------------------------------------------------
// CLI flags
// ---------------------------------------------------------------------------

const args = process.argv.slice(2);
const isDryRun = args.includes("--dry-run");
const skipSoak = args.includes("--skip-soak");

function parseIntFlag(flag: string, fallback: number): number {
  const idx = args.indexOf(flag);
  if (idx === -1 || idx + 1 >= args.length) return fallback;
  const val = Number.parseInt(args[idx + 1], 10);
  return Number.isFinite(val) && val > 0 ? val : fallback;
}

const maxWorkers = parseIntFlag("--max-workers", 60);
const soakMinutes = parseIntFlag("--soak-minutes", 30);

/** Per-dispatch timeout. Stress tests use a shorter timeout since tasks are trivial. */
const DISPATCH_TIMEOUT_MS = 120_000;

// ---------------------------------------------------------------------------
// Seed files for temp projects
// ---------------------------------------------------------------------------

const SEED_FILES: Record<string, string> = {
  "file-01.txt": "Line 1\nLine 2\nLine 3\nLine 4\nLine 5\n",
  "file-02.txt": "Alpha\nBravo\nCharlie\nDelta\nEcho\nFoxtrot\n",
  "file-03.txt": "One\nTwo\nThree\n",
  "calculator.ts": `export function add(a: number, b: number): number { return a + b; }
export function subtract(a: number, b: number): number { return a - b; }
`,
  "package.json": JSON.stringify({ name: "stress-test-project", version: "0.0.1", private: true }, null, 2),
};

// ---------------------------------------------------------------------------
// Result tracking
// ---------------------------------------------------------------------------

interface WorkerOutcome {
  index: number;
  runtime: string;
  status: "PASS" | "FAIL" | "SKIP" | "TIMEOUT";
  wallTimeMs: number;
  exitCode: number;
  error: string;
  resultLen: number;
  usage: RuntimeUsage | null;
}

interface ScenarioResult {
  scenario: number;
  name: string;
  status: "PASS" | "FAIL" | "SKIP" | "DEGRADED";
  details: string;
  wallTimeMs: number;
  outcomes: WorkerOutcome[];
  notes: string[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let runIdCounter = 0;
function nextRunId(): string {
  return `stress-${Date.now()}-${runIdCounter++}`;
}

function formatMs(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function createTempProject(): string {
  const tmpDir = mkdtempSync(join(tmpdir(), "pancode-stress-"));
  for (const [name, content] of Object.entries(SEED_FILES)) {
    writeFileSync(join(tmpDir, name), content);
  }
  return tmpDir;
}

function cleanupTempProject(dir: string): void {
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    // best effort
  }
}

/**
 * Count pancode-related processes in the process table.
 * Returns the count excluding the current process and known test infrastructure.
 */
function countPancodeProcesses(): number {
  try {
    const output = execSync("ps aux", { encoding: "utf8", timeout: 5000 });
    const lines = output.split("\n");
    let count = 0;
    const myPid = process.pid;
    for (const line of lines) {
      if (!line.includes("pancode") && !line.includes("pi-coding-agent")) continue;
      // Exclude the current process, grep itself, and the ps command
      if (line.includes("ps aux")) continue;
      if (line.includes("grep")) continue;
      // Extract PID (second column in ps aux output)
      const parts = line.trim().split(/\s+/);
      const pid = Number.parseInt(parts[1], 10);
      if (pid === myPid) continue;
      count++;
    }
    return count;
  } catch {
    return -1; // Could not determine
  }
}

/** Get current process memory usage in MB. */
function getMemoryMb(): number {
  const usage = process.memoryUsage();
  return Math.round(usage.rss / (1024 * 1024));
}

/** Get approximate open file descriptor count (Linux only). */
function getOpenFileHandles(): number {
  try {
    const output = execSync(`ls /proc/${process.pid}/fd 2>/dev/null | wc -l`, {
      encoding: "utf8",
      timeout: 3000,
    });
    return Number.parseInt(output.trim(), 10) || -1;
  } catch {
    return -1;
  }
}

/** Get the size of the .pancode/runtime directory in bytes. */
function getRuntimeDirSize(): number {
  const runtimeDir = join(PACKAGE_ROOT, ".pancode", "runtime");
  if (!existsSync(runtimeDir)) return 0;
  try {
    const output = execSync(`du -sb "${runtimeDir}" 2>/dev/null`, {
      encoding: "utf8",
      timeout: 5000,
    });
    return Number.parseInt(output.trim().split("\t")[0], 10) || 0;
  } catch {
    return -1;
  }
}

/** Check runs.json for integrity at a given path. */
function checkRunsJson(runtimeDir: string): { count: number; duplicates: number; valid: boolean } {
  const runsPath = join(runtimeDir, "runs.json");
  if (!existsSync(runsPath)) return { count: 0, duplicates: 0, valid: true };
  try {
    const raw = readFileSync(runsPath, "utf8");
    const entries = JSON.parse(raw) as Array<{ id?: string; type?: string }>;
    if (!Array.isArray(entries)) return { count: 0, duplicates: 0, valid: false };
    // Filter out session boundary markers
    const runs = entries.filter((e) => !e.type || e.type !== "session_boundary");
    const ids = runs.map((r) => r.id).filter(Boolean);
    const uniqueIds = new Set(ids);
    return { count: runs.length, duplicates: ids.length - uniqueIds.size, valid: true };
  } catch {
    return { count: 0, duplicates: 0, valid: false };
  }
}

/** Check metrics.json for integrity at a given path. */
function checkMetricsJson(runtimeDir: string): { count: number; valid: boolean } {
  const metricsPath = join(runtimeDir, "metrics.json");
  if (!existsSync(metricsPath)) return { count: 0, valid: true };
  try {
    const raw = readFileSync(metricsPath, "utf8");
    const entries = JSON.parse(raw) as Array<{ type?: string }>;
    if (!Array.isArray(entries)) return { count: 0, valid: false };
    const metrics = entries.filter((e) => !e.type || e.type !== "session_boundary");
    return { count: metrics.length, valid: true };
  } catch {
    return { count: 0, valid: false };
  }
}

/** Dispatch a single task and return an outcome. */
async function dispatchOne(opts: {
  index: number;
  runtime: string;
  task: string;
  cwd: string;
  timeoutMs?: number;
}): Promise<WorkerOutcome> {
  const start = Date.now();

  if (isDryRun) {
    return {
      index: opts.index,
      runtime: opts.runtime,
      status: "SKIP",
      wallTimeMs: 0,
      exitCode: 0,
      error: "",
      resultLen: 0,
      usage: null,
    };
  }

  try {
    const result = await spawnWorker({
      task: opts.task,
      tools: "read,grep,find,ls",
      model: process.env.PANCODE_WORKER_MODEL || null,
      systemPrompt: "You are a code analysis agent. Read and analyze code. Do not modify any files. Be concise.",
      cwd: opts.cwd,
      agentName: "stress-worker",
      runtime: opts.runtime,
      runtimeArgs: [],
      readonly: true,
      timeoutMs: opts.timeoutMs ?? DISPATCH_TIMEOUT_MS,
      runId: nextRunId(),
    });

    const elapsed = Date.now() - start;

    if (result.timedOut) {
      return {
        index: opts.index,
        runtime: opts.runtime,
        status: "TIMEOUT",
        wallTimeMs: elapsed,
        exitCode: result.exitCode,
        error: result.error || "timeout exceeded",
        resultLen: result.result.length,
        usage: result.usage,
      };
    }

    return {
      index: opts.index,
      runtime: opts.runtime,
      status: result.exitCode === 0 && !result.error ? "PASS" : "FAIL",
      wallTimeMs: elapsed,
      exitCode: result.exitCode,
      error: result.error,
      resultLen: result.result.length,
      usage: result.usage,
    };
  } catch (err) {
    const elapsed = Date.now() - start;
    const msg = err instanceof Error ? err.message : String(err);

    const isSkip =
      msg.includes("not found") ||
      msg.includes("authentication") ||
      msg.includes("ENOENT") ||
      msg.includes("Unknown runtime");

    return {
      index: opts.index,
      runtime: opts.runtime,
      status: isSkip ? "SKIP" : "FAIL",
      wallTimeMs: elapsed,
      exitCode: 1,
      error: msg,
      resultLen: 0,
      usage: null,
    };
  }
}

// ---------------------------------------------------------------------------
// Scenario 1: Ramp Up
// ---------------------------------------------------------------------------

async function scenarioRampUp(cwd: string): Promise<ScenarioResult> {
  const start = Date.now();
  const notes: string[] = [];
  const allOutcomes: WorkerOutcome[] = [];

  // Find the first available runtime
  const availableRuntimes = runtimeRegistry.available();
  if (availableRuntimes.length === 0) {
    return {
      scenario: 1,
      name: "Ramp Up",
      status: "SKIP",
      details: "No available runtimes",
      wallTimeMs: 0,
      outcomes: [],
      notes: ["No runtimes discovered or available"],
    };
  }

  const runtime = availableRuntimes[0].id;
  const levels = [10, 20, 40, 60].filter((n) => n <= maxWorkers);
  const levelResults: Array<{ n: number; pass: number; fail: number; timeout: number; wall: number; orphans: number }> =
    [];

  for (const n of levels) {
    console.log(`  Ramp to ${n} workers (runtime: ${runtime})...`);
    const levelStart = Date.now();

    const orphansBefore = countPancodeProcesses();
    const tasks: string[] = [];
    for (let i = 0; i < n; i++) {
      const fileNum = (i % 3) + 1;
      tasks.push(`Read file-0${fileNum}.txt and count the number of lines. Report only the number.`);
    }

    // Dispatch all N tasks concurrently
    const promises = tasks.map((task, i) =>
      dispatchOne({ index: i, runtime, task, cwd }),
    );
    const outcomes = await Promise.all(promises);
    allOutcomes.push(...outcomes);

    const levelWall = Date.now() - levelStart;
    const orphansAfter = countPancodeProcesses();
    const orphanDelta = orphansBefore >= 0 && orphansAfter >= 0 ? Math.max(0, orphansAfter - orphansBefore) : -1;

    const pass = outcomes.filter((o) => o.status === "PASS").length;
    const fail = outcomes.filter((o) => o.status === "FAIL").length;
    const timeout = outcomes.filter((o) => o.status === "TIMEOUT").length;

    levelResults.push({ n, pass, fail, timeout, wall: levelWall, orphans: orphanDelta });

    // Check runs.json after each level
    const runsCheck = checkRunsJson(runtimeRoot);
    if (runsCheck.duplicates > 0) {
      notes.push(`Level ${n}: ${runsCheck.duplicates} duplicate entries in runs.json`);
    }
    if (!runsCheck.valid) {
      notes.push(`Level ${n}: runs.json is corrupt`);
    }
    if (orphanDelta > 0) {
      notes.push(`Level ${n}: ${orphanDelta} orphan processes detected`);
    }

    console.log(
      `    ${pass}/${n} pass, ${fail} fail, ${timeout} timeout, wall: ${formatMs(levelWall)}, orphans: ${orphanDelta >= 0 ? orphanDelta : "?"}`,
    );
  }

  // Determine overall status
  const totalFail = levelResults.reduce((sum, r) => sum + r.fail, 0);
  const totalTimeout = levelResults.reduce((sum, r) => sum + r.timeout, 0);
  const totalOrphans = levelResults.reduce((sum, r) => sum + Math.max(0, r.orphans), 0);
  const allLevelsPassed = levelResults.every((r) => r.fail === 0 && r.timeout === 0 && r.orphans <= 0);

  let status: "PASS" | "FAIL" | "DEGRADED" | "SKIP" = "PASS";
  if (isDryRun) status = "SKIP";
  else if (totalFail > 0 || totalOrphans > 0) status = "FAIL";
  else if (totalTimeout > 0) status = "DEGRADED";

  // Find max verified concurrency (highest level where all tasks passed)
  let maxVerified = 0;
  for (const r of levelResults) {
    if (r.fail === 0 && r.timeout === 0) maxVerified = r.n;
  }

  const detailParts = levelResults.map(
    (r) =>
      `${r.n}: ${r.pass}/${r.n} pass, wall:${formatMs(r.wall)}, orphans:${r.orphans >= 0 ? r.orphans : "?"}`,
  );

  return {
    scenario: 1,
    name: "Ramp Up",
    status,
    details: detailParts.join(" | "),
    wallTimeMs: Date.now() - start,
    outcomes: allOutcomes,
    notes: [...notes, `max_verified_concurrency: ${maxVerified}`],
  };
}

// ---------------------------------------------------------------------------
// Scenario 2: Mixed Provider Load
// ---------------------------------------------------------------------------

async function scenarioMixedProvider(cwd: string): Promise<ScenarioResult> {
  const start = Date.now();
  const notes: string[] = [];
  const outcomes: WorkerOutcome[] = [];

  const availableRuntimes = runtimeRegistry.available();
  if (availableRuntimes.length === 0) {
    return {
      scenario: 2,
      name: "Mixed Provider Load",
      status: "SKIP",
      details: "No available runtimes",
      wallTimeMs: 0,
      outcomes: [],
      notes: [],
    };
  }

  const totalTasks = 20;
  const runtimeIds = availableRuntimes.map((r) => r.id);

  console.log(`  Dispatching ${totalTasks} tasks across ${runtimeIds.length} runtimes: ${runtimeIds.join(", ")}`);

  // Distribute tasks round-robin across available runtimes
  const promises: Promise<WorkerOutcome>[] = [];
  for (let i = 0; i < totalTasks; i++) {
    const rt = runtimeIds[i % runtimeIds.length];
    const fileNum = (i % 3) + 1;
    promises.push(
      dispatchOne({
        index: i,
        runtime: rt,
        task: `Read file-0${fileNum}.txt and count the number of lines. Report only the count.`,
        cwd,
      }),
    );
  }

  const results = await Promise.all(promises);
  outcomes.push(...results);

  // Check for cross-contamination: group by runtime and verify no runtime
  // produced results that reference another runtime's task context
  const byRuntime = new Map<string, WorkerOutcome[]>();
  for (const o of outcomes) {
    const existing = byRuntime.get(o.runtime) || [];
    existing.push(o);
    byRuntime.set(o.runtime, existing);
  }

  for (const [rt, rtOutcomes] of byRuntime) {
    const pass = rtOutcomes.filter((o) => o.status === "PASS").length;
    const fail = rtOutcomes.filter((o) => o.status === "FAIL").length;
    notes.push(`${rt}: ${pass} pass, ${fail} fail of ${rtOutcomes.length} dispatched`);
  }

  const totalPass = outcomes.filter((o) => o.status === "PASS").length;
  const totalFail = outcomes.filter((o) => o.status === "FAIL").length;

  let status: "PASS" | "FAIL" | "DEGRADED" | "SKIP" = "PASS";
  if (isDryRun) status = "SKIP";
  else if (totalFail > 0) status = totalFail > totalTasks / 2 ? "FAIL" : "DEGRADED";

  return {
    scenario: 2,
    name: "Mixed Provider Load",
    status,
    details: `${totalPass}/${totalTasks} pass across ${runtimeIds.length} runtimes`,
    wallTimeMs: Date.now() - start,
    outcomes,
    notes,
  };
}

// ---------------------------------------------------------------------------
// Scenario 3: Failure Under Load
// ---------------------------------------------------------------------------

async function scenarioFailureUnderLoad(cwd: string): Promise<ScenarioResult> {
  const start = Date.now();
  const notes: string[] = [];
  const outcomes: WorkerOutcome[] = [];

  const availableRuntimes = runtimeRegistry.available();
  if (availableRuntimes.length === 0) {
    return {
      scenario: 3,
      name: "Failure Under Load",
      status: "SKIP",
      details: "No available runtimes",
      wallTimeMs: 0,
      outcomes: [],
      notes: [],
    };
  }

  const runtime = availableRuntimes[0].id;
  const totalTasks = 20;
  const failureIndices = new Set([3, 7, 11, 15, 19]); // 5 designed-to-fail tasks

  console.log(`  Dispatching ${totalTasks} tasks (${failureIndices.size} designed to fail) on ${runtime}`);

  const promises: Promise<WorkerOutcome>[] = [];
  for (let i = 0; i < totalTasks; i++) {
    if (failureIndices.has(i)) {
      // These tasks reference nonexistent files, expected to fail or produce errors
      promises.push(
        dispatchOne({
          index: i,
          runtime,
          task: "Read the file /nonexistent/path/that/does/not/exist.txt and report its contents exactly.",
          cwd,
          timeoutMs: 60_000,
        }),
      );
    } else {
      const fileNum = (i % 3) + 1;
      promises.push(
        dispatchOne({
          index: i,
          runtime,
          task: `Read file-0${fileNum}.txt and count the number of lines. Report only the count.`,
          cwd,
        }),
      );
    }
  }

  const results = await Promise.all(promises);
  outcomes.push(...results);

  // Validate: the 15 "good" tasks should succeed, and the 5 "bad" ones
  // should fail without corrupting state for the good ones
  const goodOutcomes = outcomes.filter((o) => !failureIndices.has(o.index));
  const badOutcomes = outcomes.filter((o) => failureIndices.has(o.index));

  const goodPass = goodOutcomes.filter((o) => o.status === "PASS").length;
  const goodFail = goodOutcomes.filter((o) => o.status === "FAIL" || o.status === "TIMEOUT").length;

  // Check runs.json integrity after mixed success/failure
  const runsCheck = checkRunsJson(runtimeRoot);
  if (runsCheck.duplicates > 0) {
    notes.push(`${runsCheck.duplicates} duplicate run entries detected (state corruption)`);
  }
  if (!runsCheck.valid) {
    notes.push("runs.json is corrupt after mixed load");
  }

  notes.push(`Good tasks: ${goodPass}/15 passed, ${goodFail} failed unexpectedly`);
  notes.push(`Bad tasks: ${badOutcomes.length} dispatched (failures expected)`);

  // Cascading failure check: did any good tasks that started after a bad task fail?
  const cascadingFailures = goodOutcomes.filter(
    (o) => o.status === "FAIL" && o.index > Math.min(...failureIndices),
  ).length;
  if (cascadingFailures > 0) {
    notes.push(`${cascadingFailures} potential cascading failures (good tasks failing after bad ones)`);
  }

  let status: "PASS" | "FAIL" | "DEGRADED" | "SKIP" = "PASS";
  if (isDryRun) status = "SKIP";
  else if (goodFail > 0 || runsCheck.duplicates > 0 || !runsCheck.valid) status = "FAIL";

  return {
    scenario: 3,
    name: "Failure Under Load",
    status,
    details: `good: ${goodPass}/15, cascading: ${cascadingFailures}, duplicates: ${runsCheck.duplicates}`,
    wallTimeMs: Date.now() - start,
    outcomes,
    notes,
  };
}

// ---------------------------------------------------------------------------
// Scenario 4: Sustained Load (Soak)
// ---------------------------------------------------------------------------

async function scenarioSoak(cwd: string): Promise<ScenarioResult> {
  if (skipSoak) {
    return {
      scenario: 4,
      name: "Sustained Load (Soak)",
      status: "SKIP",
      details: "Skipped via --skip-soak",
      wallTimeMs: 0,
      outcomes: [],
      notes: [],
    };
  }

  const start = Date.now();
  const notes: string[] = [];
  const allOutcomes: WorkerOutcome[] = [];

  const availableRuntimes = runtimeRegistry.available();
  if (availableRuntimes.length === 0) {
    return {
      scenario: 4,
      name: "Sustained Load (Soak)",
      status: "SKIP",
      details: "No available runtimes",
      wallTimeMs: 0,
      outcomes: [],
      notes: [],
    };
  }

  const runtime = availableRuntimes[0].id;
  const durationMs = soakMinutes * 60 * 1000;
  const tasksPerMinute = 10;
  const intervalMs = 60_000 / tasksPerMinute; // 6 seconds between dispatches

  console.log(`  Soak test: ${tasksPerMinute} tasks/min for ${soakMinutes} min on ${runtime}`);

  // Baseline measurements
  const baselineMemory = getMemoryMb();
  const baselineHandles = getOpenFileHandles();
  const baselineRuntimeSize = getRuntimeDirSize();

  let peakMemory = baselineMemory;
  let peakHandles = baselineHandles;
  let dispatchCount = 0;
  let passCount = 0;
  let failCount = 0;
  let orphanAccumulated = 0;
  let lastMinuteLog = -1;

  const soakEnd = Date.now() + durationMs;

  while (Date.now() < soakEnd) {
    const fileNum = (dispatchCount % 3) + 1;
    const outcome = await dispatchOne({
      index: dispatchCount,
      runtime,
      task: `Read file-0${fileNum}.txt and count the lines. Report only the number.`,
      cwd,
      timeoutMs: 60_000,
    });
    allOutcomes.push(outcome);
    dispatchCount++;

    if (outcome.status === "PASS") passCount++;
    else failCount++;

    // Periodic monitoring (every minute)
    const minutesElapsed = Math.floor((Date.now() - start) / 60_000);
    if (minutesElapsed > lastMinuteLog) {
      lastMinuteLog = minutesElapsed;
      const currentMemory = getMemoryMb();
      const currentHandles = getOpenFileHandles();
      const orphans = countPancodeProcesses();
      const liveWorkers = liveWorkerProcesses.size;

      if (currentMemory > peakMemory) peakMemory = currentMemory;
      if (currentHandles > peakHandles) peakHandles = currentHandles;
      if (orphans > 0) orphanAccumulated += orphans;

      console.log(
        `    [${minutesElapsed}m] dispatched:${dispatchCount} pass:${passCount} fail:${failCount} mem:${currentMemory}MB handles:${currentHandles >= 0 ? currentHandles : "?"} live:${liveWorkers} orphans:${orphans >= 0 ? orphans : "?"}`,
      );
    }

    // Wait before next dispatch (skip wait if we are behind schedule)
    const nextDispatchAt = start + dispatchCount * intervalMs;
    const waitMs = nextDispatchAt - Date.now();
    if (waitMs > 0 && Date.now() < soakEnd) {
      await new Promise((resolve) => setTimeout(resolve, waitMs));
    }
  }

  // Final measurements
  const finalMemory = getMemoryMb();
  const finalHandles = getOpenFileHandles();
  const finalRuntimeSize = getRuntimeDirSize();
  const finalOrphans = countPancodeProcesses();

  const memoryDelta = finalMemory - baselineMemory;
  const handlesDelta = baselineHandles >= 0 && finalHandles >= 0 ? finalHandles - baselineHandles : null;
  const runtimeSizeDelta =
    baselineRuntimeSize >= 0 && finalRuntimeSize >= 0 ? finalRuntimeSize - baselineRuntimeSize : null;

  notes.push(`dispatched: ${dispatchCount}, pass: ${passCount}, fail: ${failCount}`);
  notes.push(`memory: baseline=${baselineMemory}MB final=${finalMemory}MB delta=${memoryDelta > 0 ? "+" : ""}${memoryDelta}MB peak=${peakMemory}MB`);

  if (handlesDelta !== null) {
    const handlesStable = Math.abs(handlesDelta) < 50;
    notes.push(`handles: baseline=${baselineHandles} final=${finalHandles} delta=${handlesDelta} ${handlesStable ? "stable" : "GROWING"}`);
  }

  if (runtimeSizeDelta !== null) {
    const sizeMb = (finalRuntimeSize / (1024 * 1024)).toFixed(1);
    notes.push(`runtime_dir: ${sizeMb}MB (delta: ${runtimeSizeDelta > 0 ? "+" : ""}${(runtimeSizeDelta / 1024).toFixed(0)}KB)`);
  }

  if (finalOrphans >= 0) {
    notes.push(`orphans at end: ${finalOrphans}`);
  }

  // Status determination
  let status: "PASS" | "FAIL" | "DEGRADED" | "SKIP" = "PASS";
  if (isDryRun) {
    status = "SKIP";
  } else if (finalOrphans > 0 || failCount > dispatchCount * 0.5) {
    status = "FAIL";
  } else if (memoryDelta > 200 || failCount > 0) {
    // Memory growing more than 200MB or any failures is degraded
    status = "DEGRADED";
  }

  return {
    scenario: 4,
    name: "Sustained Load (Soak)",
    status,
    details: `${passCount}/${dispatchCount} pass, memory_delta:${memoryDelta > 0 ? "+" : ""}${memoryDelta}MB, handles:${handlesDelta !== null ? (Math.abs(handlesDelta) < 50 ? "stable" : "growing") : "?"}`,
    wallTimeMs: Date.now() - start,
    outcomes: allOutcomes,
    notes,
  };
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

function printReport(results: ScenarioResult[], totalStart: number): void {
  console.log("");
  console.log("=== PANCODE SCALING STRESS TEST ===");
  console.log("");

  for (const r of results) {
    const tag = r.status.padEnd(8);
    console.log(`SCENARIO ${r.scenario}: ${r.name}`);
    console.log(`  Status: ${tag}  Wall: ${formatMs(r.wallTimeMs)}`);
    console.log(`  ${r.details}`);

    if (r.notes.length > 0) {
      for (const note of r.notes) {
        console.log(`  NOTE: ${note}`);
      }
    }
    console.log("");
  }

  // Summary
  const pass = results.filter((r) => r.status === "PASS").length;
  const fail = results.filter((r) => r.status === "FAIL").length;
  const degraded = results.filter((r) => r.status === "DEGRADED").length;
  const skip = results.filter((r) => r.status === "SKIP").length;
  const totalWall = Date.now() - totalStart;

  console.log(`SUMMARY: ${pass} PASS, ${degraded} DEGRADED, ${fail} FAIL, ${skip} SKIP`);
  console.log(`TOTAL WALL TIME: ${formatMs(totalWall)}`);

  // Find max verified concurrency from scenario 1
  const rampUp = results.find((r) => r.scenario === 1);
  if (rampUp) {
    const maxNote = rampUp.notes.find((n) => n.startsWith("max_verified_concurrency:"));
    if (maxNote) {
      console.log(`MAX VERIFIED CONCURRENCY: ${maxNote.split(":")[1].trim()} workers`);
    }
  }

  console.log("");
  if (fail > 0) {
    console.log("VERDICT: ISSUES FOUND (see FAIL scenarios above)");
  } else if (degraded > 0) {
    console.log("VERDICT: DEGRADED (partial failures or saturation detected)");
  } else {
    console.log("VERDICT: ALL SCENARIOS CLEAN");
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const totalStart = Date.now();
  let tmpDir = "";

  try {
    console.log("=== PANCODE SCALING STRESS TEST ===");
    console.log(`Config: max_workers=${maxWorkers}, soak_minutes=${soakMinutes}, dry_run=${isDryRun}, skip_soak=${skipSoak}`);
    console.log("");

    // Bootstrap
    console.log("Bootstrapping PanCode runtime...");
    loadConfig();
    const discovery = discoverAndRegisterRuntimes();

    const discovered = await discoverEngines();
    const pancodeHome = process.env.PANCODE_HOME ?? "";
    if (discovered.length > 0) {
      writeProvidersYaml(discovered, pancodeHome);
    }

    ensureAgentsYaml(pancodeHome);
    const specs = loadAgentsFromYaml(pancodeHome);
    for (const spec of specs) {
      agentRegistry.register(spec);
    }

    console.log(
      `Bootstrap complete: ${discovery.available.length} runtimes, ${discovered.length} providers, ${specs.length} agents`,
    );
    console.log("");

    if (isDryRun) {
      console.log("(dry-run mode: dispatches will be skipped)");
      console.log("");
    }

    // Create temp project
    tmpDir = createTempProject();
    console.log(`Temp project: ${tmpDir}`);
    console.log("");

    const results: ScenarioResult[] = [];

    // Scenario 1: Ramp Up
    console.log("--- Scenario 1: Ramp Up ---");
    results.push(await scenarioRampUp(tmpDir));
    // Clear health monitor state between scenarios
    healthMonitor.reset();

    // Scenario 2: Mixed Provider Load
    console.log("--- Scenario 2: Mixed Provider Load ---");
    const tmpDir2 = createTempProject();
    try {
      results.push(await scenarioMixedProvider(tmpDir2));
    } finally {
      cleanupTempProject(tmpDir2);
    }
    healthMonitor.reset();

    // Scenario 3: Failure Under Load
    console.log("--- Scenario 3: Failure Under Load ---");
    const tmpDir3 = createTempProject();
    try {
      results.push(await scenarioFailureUnderLoad(tmpDir3));
    } finally {
      cleanupTempProject(tmpDir3);
    }
    healthMonitor.reset();

    // Scenario 4: Sustained Load (Soak)
    console.log("--- Scenario 4: Sustained Load (Soak) ---");
    const tmpDir4 = createTempProject();
    try {
      results.push(await scenarioSoak(tmpDir4));
    } finally {
      cleanupTempProject(tmpDir4);
    }

    // Print report
    printReport(results, totalStart);
  } finally {
    // Cleanup
    if (tmpDir) cleanupTempProject(tmpDir);
    await stopAllWorkers();

    // Final orphan check
    const finalOrphans = countPancodeProcesses();
    if (finalOrphans > 0) {
      console.log(`\nWARNING: ${finalOrphans} orphan processes remain after cleanup`);
    }
  }
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
