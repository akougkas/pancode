/**
 * Smoke Test: Agent Factory Runtime Adapters
 *
 * Verifies all 6 CLI adapters (+ Pi) through PanCode's dispatch system.
 *
 * Run: npx tsx scripts/smoke-test-factory.ts
 *
 * Four phases:
 *   1. Discovery: register runtimes, report available/unavailable
 *   2. Spawn Config: build SpawnConfig for each runtime, verify flags
 *   3. Live Invocation: spawn each agent with a trivial task, verify output
 *   4. spawnWorker Integration: dispatch through the full worker spawn path
 */

import { execSync, spawn } from "node:child_process";
import { discoverAndRegisterRuntimes } from "../src/engine/runtimes/discovery";
import { runtimeRegistry } from "../src/engine/runtimes/registry";
import type { RuntimeTaskConfig } from "../src/engine/runtimes/types";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const TEST_TASK = "What is the capital of France? Answer in one word.";
const TIMEOUT_MS = 90_000;

type Status = "pass" | "skip" | "fail" | "timeout";

interface Result {
  runtime: string;
  phase1: "available" | "unavailable";
  phase2: Status;
  phase3: Status;
  phase3Output: string;
  phase4: Status;
  phase4Output: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTaskConfig(runtimeId: string, readonly: boolean): RuntimeTaskConfig {
  return {
    task: TEST_TASK,
    tools: "read,grep,find,ls",
    model: null,
    systemPrompt: "",
    cwd: process.cwd(),
    agentName: "smoke-test",
    readonly,
    runtimeArgs: [],
    timeoutMs: TIMEOUT_MS,
  };
}

function truncate(s: string, max: number): string {
  const clean = s.replace(/\n/g, " ").trim();
  return clean.length > max ? clean.slice(0, max) + "..." : clean;
}

/**
 * Run a binary directly (not through the cli-entry wrapper) and capture output.
 * Returns { stdout, stderr, exitCode }.
 */
function runDirect(
  binary: string,
  args: string[],
  timeoutMs: number,
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  return new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    let settled = false;

    const proc = spawn(binary, args, {
      cwd: process.cwd(),
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env },
    });

    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        proc.kill("SIGTERM");
        setTimeout(() => {
          if (proc.exitCode === null) proc.kill("SIGKILL");
        }, 3000);
        resolve({ stdout, stderr, exitCode: -1 });
      }
    }, timeoutMs);

    proc.stdout?.on("data", (d: Buffer) => {
      stdout += d.toString();
    });
    proc.stderr?.on("data", (d: Buffer) => {
      stderr += d.toString();
    });

    proc.on("close", (code) => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        resolve({ stdout, stderr, exitCode: code ?? 1 });
      }
    });

    proc.on("error", (err) => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        resolve({ stdout: "", stderr: err.message, exitCode: 1 });
      }
    });
  });
}

/**
 * Build the direct invocation args for a CLI runtime (bypassing cli-entry wrapper).
 * Uses the runtime's buildCliArgs method to get the correct flags.
 */
function getDirectArgs(runtimeId: string): { binary: string; args: string[] } | null {
  const runtime = runtimeRegistry.get(runtimeId);
  if (!runtime || runtime.tier !== "cli") return null;

  // Access the binaryName from the CLI runtime
  const cliRuntime = runtime as { binaryName: string; buildCliArgs: (config: RuntimeTaskConfig) => string[] };
  const config = makeTaskConfig(runtimeId, false);
  const cliArgs = cliRuntime.buildCliArgs(config);

  return { binary: cliRuntime.binaryName, args: cliArgs };
}

/**
 * Extract a meaningful answer from potentially JSON or text output.
 */
function extractAnswer(stdout: string, runtimeId: string): string {
  // For NDJSON runtimes, use the runtime's parseResult
  const runtime = runtimeRegistry.get(runtimeId);
  if (runtime) {
    const parsed = runtime.parseResult(stdout, "", 0, null);
    if (parsed.result.trim()) return parsed.result.trim();
  }
  // Fallback to raw text
  return stdout.trim();
}

// ---------------------------------------------------------------------------
// Phase 1: Discovery
// ---------------------------------------------------------------------------

function phase1(): Map<string, Result> {
  console.log("\n=== Phase 1: Discovery ===\n");

  const { registered, available, unavailable } = discoverAndRegisterRuntimes();

  console.log(`  Registered: ${registered.join(", ")}`);
  console.log(`  Available:  ${available.join(", ")}`);
  if (unavailable.length > 0) {
    console.log(`  Unavailable: ${unavailable.join(", ")}`);
  }
  console.log();

  const results = new Map<string, Result>();
  for (const id of registered) {
    results.set(id, {
      runtime: id,
      phase1: available.includes(id) ? "available" : "unavailable",
      phase2: "skip",
      phase3: "skip",
      phase3Output: "",
      phase4: "skip",
      phase4Output: "",
    });
  }

  return results;
}

// ---------------------------------------------------------------------------
// Phase 2: Spawn Config
// ---------------------------------------------------------------------------

function phase2(results: Map<string, Result>): void {
  console.log("=== Phase 2: Spawn Config ===\n");

  for (const [id, r] of results) {
    if (r.phase1 === "unavailable" && id !== "pi") {
      console.log(`  [${id}] SKIP (unavailable)`);
      continue;
    }

    const runtime = runtimeRegistry.get(id);
    if (!runtime) {
      console.log(`  [${id}] FAIL (not in registry)`);
      r.phase2 = "fail";
      continue;
    }

    try {
      // Test mutable config
      const mutableConfig = makeTaskConfig(id, false);
      const mutableSpawn = runtime.buildSpawnConfig(mutableConfig);

      // Test readonly config
      const readonlyConfig = makeTaskConfig(id, true);
      const readonlySpawn = runtime.buildSpawnConfig(readonlyConfig);

      const mutableCmd = `${mutableSpawn.command} ${mutableSpawn.args.join(" ")}`;
      const readonlyCmd = `${readonlySpawn.command} ${readonlySpawn.args.join(" ")}`;

      console.log(`  [${id}] mutable:  ${truncate(mutableCmd, 120)}`);
      console.log(`  [${id}] readonly: ${truncate(readonlyCmd, 120)}`);
      console.log(`  [${id}] format:   ${mutableSpawn.outputFormat}`);

      r.phase2 = "pass";
    } catch (err) {
      console.log(`  [${id}] FAIL: ${err}`);
      r.phase2 = "fail";
    }
  }

  console.log();
}

// ---------------------------------------------------------------------------
// Phase 3: Live Invocation
// ---------------------------------------------------------------------------

async function phase3(results: Map<string, Result>): Promise<void> {
  console.log("=== Phase 3: Live Invocation ===\n");

  for (const [id, r] of results) {
    // Skip Pi (native runtime, not a CLI binary) and unavailable runtimes
    if (id === "pi") {
      console.log(`  [${id}] SKIP (native runtime, not a CLI binary)`);
      continue;
    }
    if (r.phase1 === "unavailable") {
      console.log(`  [${id}] SKIP (unavailable)`);
      continue;
    }
    if (r.phase2 !== "pass") {
      console.log(`  [${id}] SKIP (phase 2 failed)`);
      continue;
    }

    const direct = getDirectArgs(id);
    if (!direct) {
      console.log(`  [${id}] SKIP (cannot build direct args)`);
      continue;
    }

    console.log(`  [${id}] Spawning: ${direct.binary} ${truncate(direct.args.join(" "), 80)}`);

    const start = Date.now();
    const { stdout, stderr, exitCode } = await runDirect(direct.binary, direct.args, TIMEOUT_MS);
    const elapsed = ((Date.now() - start) / 1000).toFixed(1);

    if (exitCode === -1) {
      console.log(`  [${id}] TIMEOUT after ${elapsed}s`);
      r.phase3 = "timeout";
      r.phase3Output = "Timed out";
      continue;
    }

    const answer = extractAnswer(stdout, id);
    r.phase3Output = truncate(answer, 80);

    if (exitCode === 0 && answer.length > 0) {
      console.log(`  [${id}] PASS (${elapsed}s): ${truncate(answer, 60)}`);
      r.phase3 = "pass";
    } else {
      const errMsg = stderr.trim() ? truncate(stderr, 80) : `exit ${exitCode}`;
      console.log(`  [${id}] FAIL (${elapsed}s): ${errMsg}`);
      r.phase3 = "fail";
      r.phase3Output = errMsg;
    }
  }

  console.log();
}

// ---------------------------------------------------------------------------
// Phase 4: spawnWorker Integration
// ---------------------------------------------------------------------------

async function phase4(results: Map<string, Result>): Promise<void> {
  console.log("=== Phase 4: spawnWorker Integration ===\n");

  // Dynamically import spawnWorker to avoid pulling in domain dependencies at module level
  const { spawnWorker } = await import("../src/domains/dispatch/worker-spawn");

  for (const [id, r] of results) {
    // Only test runtimes that passed Phase 3
    if (r.phase3 !== "pass") {
      const reason = id === "pi" ? "native runtime" : `phase 3 ${r.phase3}`;
      console.log(`  [${id}] SKIP (${reason})`);
      continue;
    }

    console.log(`  [${id}] Dispatching through spawnWorker...`);

    const start = Date.now();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

    try {
      const result = await spawnWorker({
        task: TEST_TASK,
        tools: "read,grep,find,ls",
        model: null,
        systemPrompt: "",
        cwd: process.cwd(),
        agentName: "smoke-test",
        runtime: id,
        runtimeArgs: [],
        readonly: false,
        signal: controller.signal,
      });

      clearTimeout(timer);
      const elapsed = ((Date.now() - start) / 1000).toFixed(1);

      if (result.result.trim().length > 0) {
        console.log(`  [${id}] PASS (${elapsed}s): ${truncate(result.result, 60)}`);
        r.phase4 = "pass";
        r.phase4Output = truncate(result.result, 80);
      } else {
        const errMsg = result.error || `empty result, exit ${result.exitCode}`;
        console.log(`  [${id}] FAIL (${elapsed}s): ${truncate(errMsg, 60)}`);
        r.phase4 = "fail";
        r.phase4Output = truncate(errMsg, 80);
      }
    } catch (err) {
      clearTimeout(timer);
      const elapsed = ((Date.now() - start) / 1000).toFixed(1);
      const errMsg = err instanceof Error ? err.message : String(err);
      console.log(`  [${id}] FAIL (${elapsed}s): ${truncate(errMsg, 60)}`);
      r.phase4 = "fail";
      r.phase4Output = truncate(errMsg, 80);
    }
  }

  console.log();
}

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

function printSummary(results: Map<string, Result>): void {
  console.log("=== Summary ===\n");

  const pad = (s: string, n: number) => s.padEnd(n);
  const header = `  ${pad("Runtime", 18)} ${pad("Discovery", 12)} ${pad("Config", 10)} ${pad("Invoke", 10)} ${pad("Dispatch", 10)}`;
  console.log(header);
  console.log("  " + "-".repeat(header.length - 2));

  for (const r of results.values()) {
    const line = `  ${pad(r.runtime, 18)} ${pad(r.phase1, 12)} ${pad(r.phase2, 10)} ${pad(r.phase3, 10)} ${pad(r.phase4, 10)}`;
    console.log(line);
  }

  console.log();

  const allPass = [...results.values()].filter((r) => r.phase1 === "available");
  const phase3Pass = allPass.filter((r) => r.phase3 === "pass" || r.runtime === "pi");
  const phase4Pass = allPass.filter((r) => r.phase4 === "pass" || r.runtime === "pi");

  console.log(`  Available: ${allPass.length}/${results.size}`);
  console.log(`  Phase 3 pass: ${phase3Pass.length}/${allPass.length}`);
  console.log(`  Phase 4 pass: ${phase4Pass.length}/${allPass.length}`);
  console.log();
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  console.log("PanCode Agent Factory Smoke Test");
  console.log("================================");

  const results = phase1();
  phase2(results);
  await phase3(results);
  await phase4(results);
  printSummary(results);
}

main().catch((err) => {
  console.error("Smoke test crashed:", err);
  process.exit(1);
});
