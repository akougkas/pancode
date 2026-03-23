/**
 * Smoke Test: Adapter Discovery & Invocation
 *
 * Verifies PanCode discovers all installed CLI agents correctly, constructs
 * valid spawn configs, and can invoke each adapter with a trivial task.
 *
 * Run: npx tsx scripts/smoke-test-factory.ts
 *
 * Four phases:
 *   1. Discovery: register runtimes, report available/unavailable with detail
 *   2. Spawn Config: build SpawnConfig, verify adapter-specific CLI flags
 *   3. Live Invocation: spawn each agent directly, classify pass/skip/fail
 *   4. spawnWorker Integration: dispatch through the full worker spawn path
 */

import { spawn } from "node:child_process";
import { discoverAndRegisterRuntimes } from "../src/engine/runtimes/discovery";
import { runtimeRegistry } from "../src/engine/runtimes/registry";
import type { RuntimeTaskConfig, SpawnConfig } from "../src/engine/runtimes/types";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const PHASE2_TASK = "What is 2+2?";
const PHASE3_TASK = "What is the capital of France? Answer in one word.";
const PHASE2_TIMEOUT_MS = 30_000;
const PHASE3_TIMEOUT_MS = 60_000;
const PHASE4_TIMEOUT_MS = 30_000;

type Verdict = "PASS" | "SKIP" | "FAIL" | "TIMEOUT";

/**
 * Per-adapter expected CLI flags for Phase 2 validation.
 * Each entry lists flags that MUST appear in the SpawnConfig args when
 * invoked with the Phase 2 config (readonly: true, systemPrompt: "Answer concisely").
 */
const EXPECTED_FLAGS: Record<string, string[]> = {
  "cli:claude-code": ["--output-format", "--allowedTools", "--append-system-prompt"],
  "cli:codex": ["--json", "--cd"],
  "cli:gemini": ["--output-format", "--allowed-tools"],
  "cli:opencode": ["--format", "--dir", "--agent"],
  "cli:cline": ["--json", "-c"],
  "cli:copilot-cli": ["--autopilot", "--no-color"],
};

// ---------------------------------------------------------------------------
// Aggregate counters
// ---------------------------------------------------------------------------

const counters = { pass: 0, skip: 0, fail: 0, timeout: 0, adapters: 0 };

function record(verdict: Verdict): void {
  switch (verdict) {
    case "PASS":
      counters.pass++;
      break;
    case "SKIP":
      counters.skip++;
      break;
    case "FAIL":
      counters.fail++;
      break;
    case "TIMEOUT":
      counters.timeout++;
      break;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function pad(s: string, n: number): string {
  return s.padEnd(n);
}

function truncate(s: string, max: number): string {
  const clean = s.replace(/\n/g, " ").trim();
  return clean.length > max ? `${clean.slice(0, max)}...` : clean;
}

function formatTokens(n: number | null): string {
  if (n === null) return "-- tok";
  if (n === 0) return "0 tok";
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k tok`;
  return `${n} tok`;
}

function formatCost(c: number | null): string {
  if (c === null) return "$--";
  return `$${c.toFixed(2)}`;
}

/** Check if a process is still alive by sending signal 0. */
function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * Classify an error string to determine SKIP vs FAIL verdicts.
 * Auth errors and rate limits produce SKIP so they are not counted as failures.
 */
function classifyError(
  errorText: string,
  exitCode: number,
): { verdict: Verdict; reason: string } {
  const lower = errorText.toLowerCase();
  if (
    lower.includes("unauthorized") ||
    lower.includes("authentication") ||
    lower.includes("api key") ||
    lower.includes("login") ||
    lower.includes("not logged in") ||
    lower.includes("credentials")
  ) {
    return { verdict: "SKIP", reason: "auth error" };
  }
  if (
    lower.includes("rate limit") ||
    lower.includes("429") ||
    lower.includes("too many requests")
  ) {
    return { verdict: "SKIP", reason: "rate limited (retry later)" };
  }
  return {
    verdict: "FAIL",
    reason: truncate(errorText, 120) || `exit ${exitCode}`,
  };
}

/**
 * Extract the "logical" CLI command from a SpawnConfig.
 * The wrapped command goes through cli-entry.ts; this extracts the part
 * after "--" and prefixes with the binary name for readable display.
 */
function extractLogicalCommand(
  config: SpawnConfig,
  binaryName: string,
): string {
  const dashIdx = config.args.indexOf("--");
  if (dashIdx >= 0) {
    const cliArgs = config.args.slice(dashIdx + 1);
    return `${binaryName} ${cliArgs.join(" ")}`;
  }
  return `${config.command} ${config.args.join(" ")}`;
}

/**
 * Spawn a CLI binary directly and capture output.
 * Returns stdout, stderr, exit code, and the child PID for orphan checking.
 */
function runDirect(
  binary: string,
  args: string[],
  timeoutMs: number,
): Promise<{ stdout: string; stderr: string; exitCode: number; pid: number }> {
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

    const pid = proc.pid ?? 0;

    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        proc.kill("SIGTERM");
        setTimeout(() => {
          if (proc.exitCode === null) proc.kill("SIGKILL");
        }, 3000);
        resolve({ stdout, stderr, exitCode: -1, pid });
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
        resolve({ stdout, stderr, exitCode: code ?? 1, pid });
      }
    });

    proc.on("error", (err) => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        resolve({ stdout: "", stderr: err.message, exitCode: 1, pid });
      }
    });
  });
}

// ---------------------------------------------------------------------------
// CliRuntime accessor interface
// ---------------------------------------------------------------------------

/**
 * Subset of CliRuntime properties needed for direct invocation.
 * The AgentRuntime interface does not expose binaryName or buildCliArgs,
 * so we access them via type assertion on CLI-tier runtimes.
 */
interface CliRuntimeLike {
  binaryName: string;
  buildCliArgs(config: RuntimeTaskConfig): string[];
}

function asCliRuntime(runtime: unknown): CliRuntimeLike | null {
  const rt = runtime as Record<string, unknown>;
  if (typeof rt.binaryName === "string" && typeof rt.buildCliArgs === "function") {
    return rt as unknown as CliRuntimeLike;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Per-runtime info collected in Phase 1
// ---------------------------------------------------------------------------

interface RuntimeInfo {
  id: string;
  displayName: string;
  tier: string;
  telemetryTier: string;
  version: string | null;
  binaryName: string;
  available: boolean;
}

// ---------------------------------------------------------------------------
// Phase 1: Discovery
// ---------------------------------------------------------------------------

function phase1(): RuntimeInfo[] {
  console.log("\nPHASE 1: DISCOVERY\n");

  const { registered, available, unavailable } = discoverAndRegisterRuntimes();

  const infos: RuntimeInfo[] = [];

  for (const id of registered) {
    const runtime = runtimeRegistry.get(id);
    if (!runtime) continue;

    const isAvail = available.includes(id);
    const version = runtime.getVersion();
    const cli = asCliRuntime(runtime);
    const binaryName = cli?.binaryName ?? "built-in";

    infos.push({
      id,
      displayName: runtime.displayName,
      tier: runtime.tier,
      telemetryTier: runtime.telemetryTier,
      version,
      binaryName,
      available: isAvail,
    });

    const availStr = isAvail ? "available" : "unavailable";
    const vStr = version ?? "\u2014";
    console.log(
      `  ${pad(id, 18)} registered  ${pad(availStr, 13)} ${pad(runtime.tier, 10)} v:${vStr}`,
    );
  }

  console.log();
  console.log(
    `  Registered: ${registered.length}` +
      `  Available: ${available.length}` +
      `  Unavailable: ${unavailable.length}`,
  );
  console.log();

  counters.adapters = registered.length;
  return infos;
}

// ---------------------------------------------------------------------------
// Phase 2: Spawn Config Construction
// ---------------------------------------------------------------------------

function phase2(infos: RuntimeInfo[]): void {
  console.log("PHASE 2: SPAWN CONFIG\n");

  for (const info of infos) {
    // Phase 2 tests CLI runtimes only. Pi is native and tested in Phase 1.
    if (info.tier === "native") {
      console.log(`  ${pad(info.id, 18)} SKIP  (native runtime)`);
      record("SKIP");
      continue;
    }

    if (!info.available) {
      console.log(`  ${pad(info.id, 18)} SKIP  (unavailable)`);
      record("SKIP");
      continue;
    }

    const runtime = runtimeRegistry.get(info.id);
    if (!runtime) {
      console.log(`  ${pad(info.id, 18)} FAIL  (not in registry)`);
      record("FAIL");
      continue;
    }

    try {
      const config: RuntimeTaskConfig = {
        task: PHASE2_TASK,
        tools: "read,grep,find,ls",
        model: null,
        systemPrompt: "Answer concisely",
        cwd: process.cwd(),
        agentName: "test",
        readonly: true,
        runtimeArgs: [],
        timeoutMs: PHASE2_TIMEOUT_MS,
      };

      const spawnConfig = runtime.buildSpawnConfig(config);
      const logicalCmd = extractLogicalCommand(spawnConfig, info.binaryName);
      const argsJoined = spawnConfig.args.join(" ");

      // Verify expected flags for this adapter
      const expected = EXPECTED_FLAGS[info.id] ?? [];
      const missing: string[] = [];
      for (const flag of expected) {
        if (!argsJoined.includes(flag)) {
          missing.push(flag);
        }
      }

      if (missing.length > 0) {
        console.log(
          `  ${pad(info.id, 18)} FAIL  missing flags: ${missing.join(", ")}`,
        );
        console.log(
          `  ${pad("", 18)}       cmd: ${truncate(logicalCmd, 100)}`,
        );
        record("FAIL");
      } else {
        console.log(
          `  ${pad(info.id, 18)} PASS  ${truncate(logicalCmd, 100)}`,
        );
        const envKeys = Object.keys(spawnConfig.env);
        const envStr = envKeys.length > 0 ? envKeys.join(", ") : "(none)";
        console.log(
          `  ${pad("", 18)}       format: ${spawnConfig.outputFormat}  env: ${envStr}`,
        );
        record("PASS");
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.log(
        `  ${pad(info.id, 18)} FAIL  ${truncate(msg, 100)}`,
      );
      record("FAIL");
    }
  }

  console.log();
}

// ---------------------------------------------------------------------------
// Phase 3: Live CLI Invocation
// ---------------------------------------------------------------------------

async function phase3(infos: RuntimeInfo[]): Promise<void> {
  console.log("PHASE 3: LIVE INVOCATION\n");

  for (const info of infos) {
    // Phase 3 tests CLI runtimes only via direct binary invocation.
    if (info.tier === "native") {
      console.log(
        `  ${pad(info.id, 18)} SKIP  (native runtime, not a CLI binary)`,
      );
      record("SKIP");
      continue;
    }

    if (!info.available) {
      console.log(`  ${pad(info.id, 18)} SKIP  (unavailable)`);
      record("SKIP");
      continue;
    }

    const runtime = runtimeRegistry.get(info.id);
    if (!runtime) {
      console.log(`  ${pad(info.id, 18)} FAIL  (not in registry)`);
      record("FAIL");
      continue;
    }

    const cli = asCliRuntime(runtime);
    if (!cli) {
      console.log(`  ${pad(info.id, 18)} SKIP  (cannot access CLI interface)`);
      record("SKIP");
      continue;
    }

    // Build direct invocation args (bypassing cli-entry wrapper)
    const taskConfig: RuntimeTaskConfig = {
      task: PHASE3_TASK,
      tools: "read,grep,find,ls",
      model: null,
      systemPrompt: "Answer concisely",
      cwd: process.cwd(),
      agentName: "smoke-test",
      readonly: true,
      runtimeArgs: [],
      timeoutMs: PHASE3_TIMEOUT_MS,
    };
    const cliArgs = cli.buildCliArgs(taskConfig);

    console.log(
      `  ${pad(info.id, 18)} spawning: ${cli.binaryName} ${truncate(cliArgs.join(" "), 80)}`,
    );

    const start = Date.now();
    const { stdout, stderr, exitCode, pid } = await runDirect(
      cli.binaryName,
      cliArgs,
      PHASE3_TIMEOUT_MS,
    );
    const elapsed = ((Date.now() - start) / 1000).toFixed(1);

    // Parse result using the runtime's adapter parser
    const parsed = runtime.parseResult(
      stdout,
      stderr,
      exitCode >= 0 ? exitCode : 1,
      null,
    );
    const answer = parsed.result.trim();
    const totalTok =
      (parsed.usage.inputTokens ?? 0) + (parsed.usage.outputTokens ?? 0);
    const costStr = formatCost(parsed.usage.cost);
    const modelStr = parsed.model ?? "null";

    // Check for orphan processes: the spawned PID should be dead by now
    const orphanStr =
      pid > 0 && isProcessAlive(pid) ? "ORPHAN DETECTED" : "no orphans";

    if (exitCode === -1) {
      console.log(
        `  ${pad(info.id, 18)} TIMEOUT  ${elapsed}s  ${orphanStr}`,
      );
      record("TIMEOUT");
    } else if (exitCode === 0 && answer.length > 0) {
      console.log(
        `  ${pad(info.id, 18)} PASS  exit:${exitCode}  ` +
          `${answer.length} chars  ${formatTokens(totalTok)}  ` +
          `${costStr}  model:${modelStr}`,
      );
      console.log(
        `  ${pad("", 18)}       result: "${truncate(answer, 60)}"  ${orphanStr}`,
      );
      record("PASS");
    } else {
      // Classify stderr to distinguish auth/rate-limit (SKIP) from real failures
      const { verdict, reason } = classifyError(
        stderr || parsed.error,
        exitCode,
      );
      console.log(
        `  ${pad(info.id, 18)} ${verdict}  exit:${exitCode}  ${reason}  ${orphanStr}`,
      );
      record(verdict);
    }
  }

  console.log();
}

// ---------------------------------------------------------------------------
// Phase 4: spawnWorker Direct Path
// ---------------------------------------------------------------------------

async function phase4(infos: RuntimeInfo[]): Promise<void> {
  console.log("PHASE 4: SPAWNWORKER DIRECT\n");

  // Dynamically import spawnWorker to avoid pulling in domain dependencies
  // at module level. This also lets us access liveWorkerProcesses for orphan checks.
  let spawnWorkerFn: typeof import("../src/domains/dispatch/worker-spawn").spawnWorker;
  let liveProcesses: typeof import("../src/domains/dispatch/worker-spawn").liveWorkerProcesses;

  try {
    const mod = await import("../src/domains/dispatch/worker-spawn");
    spawnWorkerFn = mod.spawnWorker;
    liveProcesses = mod.liveWorkerProcesses;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.log(`  FAIL: cannot import worker-spawn: ${truncate(msg, 100)}`);
    record("FAIL");
    console.log();
    return;
  }

  for (const info of infos) {
    // Phase 4 tests CLI runtimes only through the full dispatch path.
    if (info.tier === "native") {
      console.log(
        `  ${pad(info.id, 18)} SKIP  (native runtime, requires PANCODE_HOME)`,
      );
      record("SKIP");
      continue;
    }

    if (!info.available) {
      console.log(`  ${pad(info.id, 18)} SKIP  (unavailable)`);
      record("SKIP");
      continue;
    }

    console.log(
      `  ${pad(info.id, 18)} dispatching through spawnWorker...`,
    );

    const preLive = liveProcesses.size;
    const start = Date.now();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), PHASE4_TIMEOUT_MS + 5000);

    try {
      const result = await spawnWorkerFn({
        task: PHASE3_TASK,
        tools: "read,grep",
        model: null,
        systemPrompt: "Be concise.",
        cwd: process.cwd(),
        agentName: "factory-test",
        runtime: info.id,
        runtimeArgs: [],
        readonly: true,
        signal: controller.signal,
        timeoutMs: PHASE4_TIMEOUT_MS,
      });

      clearTimeout(timer);
      const elapsed = ((Date.now() - start) / 1000).toFixed(1);

      // Check for orphan worker processes still tracked in the live set
      const postLive = liveProcesses.size;
      const orphanCount = postLive - preLive;
      const orphanStr =
        orphanCount <= 0
          ? "no orphans"
          : `ORPHAN: ${orphanCount} live processes remain`;

      if (result.result.trim().length > 0) {
        console.log(
          `  ${pad(info.id, 18)} PASS  (${elapsed}s)` +
            `  result:"${truncate(result.result, 40)}"  ${orphanStr}`,
        );
        record("PASS");
      } else {
        const errText = result.error || `empty result, exit ${result.exitCode}`;
        const { verdict, reason } = classifyError(errText, result.exitCode);
        console.log(
          `  ${pad(info.id, 18)} ${verdict}  (${elapsed}s)  ${reason}  ${orphanStr}`,
        );
        record(verdict);
      }
    } catch (err) {
      clearTimeout(timer);
      const elapsed = ((Date.now() - start) / 1000).toFixed(1);
      const errMsg = err instanceof Error ? err.message : String(err);
      const { verdict, reason } = classifyError(errMsg, 1);
      console.log(
        `  ${pad(info.id, 18)} ${verdict}  (${elapsed}s)  ${reason}`,
      );
      record(verdict);
    }
  }

  console.log();
}

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

function printSummary(): void {
  console.log(
    `SUMMARY: 4 phases, ${counters.adapters} adapters tested, ` +
      `${counters.pass} PASS, ${counters.skip} SKIP, ` +
      `${counters.fail} FAIL, ${counters.timeout} TIMEOUT`,
  );
  console.log();
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  console.log("=== ADAPTER DISCOVERY & INVOCATION TEST ===");

  const infos = phase1();
  phase2(infos);
  await phase3(infos);
  await phase4(infos);
  printSummary();
}

main().catch((err) => {
  console.error("Smoke test crashed:", err);
  process.exit(1);
});
