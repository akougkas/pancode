/**
 * PanCode End-to-End Smoke Test
 *
 * Strategic validation of the entire PanCode stack:
 *
 *   Phase 1: Full orchestrator bootstrap (6-phase init)
 *   Phase 2: Native Pi agents with local AI (dev, reviewer, scout)
 *   Phase 3: CLI runtime agents with readonly tools
 *   Phase 4: CLI runtime agents with mutable (act) tools
 *
 * Run: npx tsx scripts/smoke-test-e2e.ts
 */

import { existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

// ---------------------------------------------------------------------------
// Environment bootstrap (mirrors loader.ts)
// ---------------------------------------------------------------------------

const PACKAGE_ROOT = join(import.meta.dirname, "..");
process.env.PANCODE_PACKAGE_ROOT = PACKAGE_ROOT;
process.env.PANCODE_HOME = process.env.PANCODE_HOME || join(homedir(), ".pancode");
process.env.PI_SKIP_VERSION_CHECK = "1";
process.env.PI_CODING_AGENT_DIR = join(process.env.PANCODE_HOME, "agent-engine");

// Load .env file manually (same as loader.ts)
import { readFileSync } from "node:fs";
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

// Ensure runtime dirs exist
const runtimeRoot = join(PACKAGE_ROOT, ".pancode", "runtime");
mkdirSync(runtimeRoot, { recursive: true });
mkdirSync(join(runtimeRoot, "results"), { recursive: true });
process.env.PANCODE_RUNTIME_ROOT = runtimeRoot;

// ---------------------------------------------------------------------------
// Imports (after env is set)
// ---------------------------------------------------------------------------

import { discoverAndRegisterRuntimes } from "../src/engine/runtimes/discovery";
import { runtimeRegistry } from "../src/engine/runtimes/registry";
import type { RuntimeTaskConfig } from "../src/engine/runtimes/types";
import { agentRegistry, ensureAgentsYaml, loadAgentsFromYaml } from "../src/domains/agents/spec-registry";
import { spawnWorker } from "../src/domains/dispatch/worker-spawn";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const TIMEOUT_MS = 120_000;
const SIMPLE_TASK = "What is the capital of France? Answer in exactly one word with no punctuation.";
const CODE_TASK = "List the files in the current directory. Report only their names, one per line.";

type Status = "pass" | "skip" | "fail" | "timeout";

interface TestResult {
  name: string;
  agent: string;
  runtime: string;
  readonly: boolean;
  status: Status;
  output: string;
  elapsed: string;
  error: string;
}

const results: TestResult[] = [];

function truncate(s: string, max: number): string {
  const clean = s.replace(/\n/g, " ").trim();
  return clean.length > max ? clean.slice(0, max) + "..." : clean;
}

// ---------------------------------------------------------------------------
// Phase 1: Orchestrator Bootstrap
// ---------------------------------------------------------------------------

async function phase1(): Promise<boolean> {
  console.log("\n========================================");
  console.log("  Phase 1: Orchestrator Bootstrap");
  console.log("========================================\n");

  // Step 1: Runtime discovery
  console.log("  [1/4] Discovering runtimes...");
  const discovery = discoverAndRegisterRuntimes();
  console.log(`         Registered: ${discovery.registered.join(", ")}`);
  console.log(`         Available:  ${discovery.available.join(", ")}`);
  if (discovery.unavailable.length > 0) {
    console.log(`         Unavailable: ${discovery.unavailable.join(", ")}`);
  }

  // Step 2: Load agent specs
  console.log("\n  [2/4] Loading agent specs...");
  const specs = loadAgentsFromYaml(process.env.PANCODE_HOME!);
  for (const spec of specs) {
    if (!agentRegistry.has(spec.name)) {
      agentRegistry.register(spec);
    }
  }
  const agentNames = agentRegistry.names();
  console.log(`         Agents: ${agentNames.join(", ")}`);

  // Step 3: Verify local AI endpoints
  console.log("\n  [3/4] Checking local AI endpoints...");
  const localMachines = process.env.PANCODE_LOCAL_MACHINES || "";
  if (localMachines) {
    console.log(`         PANCODE_LOCAL_MACHINES: ${localMachines}`);
  }
  const workerModel = process.env.PANCODE_WORKER_MODEL || "(not set)";
  const orchModel = process.env.PANCODE_MODEL || "(not set)";
  console.log(`         PANCODE_MODEL: ${orchModel}`);
  console.log(`         PANCODE_WORKER_MODEL: ${workerModel}`);

  // Step 4: Ensure panagents.yaml
  console.log("\n  [4/4] Ensuring panagents.yaml...");
  const agentsPath = ensureAgentsYaml(process.env.PANCODE_HOME!);
  console.log(`         Path: ${agentsPath}`);
  console.log(`         Exists: ${existsSync(agentsPath)}`);

  console.log("\n  Phase 1: COMPLETE\n");
  return true;
}

// ---------------------------------------------------------------------------
// Worker dispatch helper
// ---------------------------------------------------------------------------

async function dispatchTest(
  testName: string,
  agentName: string,
  runtimeId: string,
  task: string,
  readonly: boolean,
  runtimeArgs: string[] = [],
): Promise<TestResult> {
  const start = Date.now();
  const result: TestResult = {
    name: testName,
    agent: agentName,
    runtime: runtimeId,
    readonly,
    status: "skip",
    output: "",
    elapsed: "0.0s",
    error: "",
  };

  // Check runtime availability
  const runtime = runtimeRegistry.get(runtimeId);
  if (!runtime) {
    result.status = "fail";
    result.error = `Runtime "${runtimeId}" not registered`;
    result.elapsed = `${((Date.now() - start) / 1000).toFixed(1)}s`;
    return result;
  }
  if (!runtime.isAvailable()) {
    result.status = "skip";
    result.error = `Runtime "${runtimeId}" not available on PATH`;
    result.elapsed = `${((Date.now() - start) / 1000).toFixed(1)}s`;
    return result;
  }

  // Resolve agent spec
  const spec = agentRegistry.get(agentName);
  const tools = spec?.tools ?? (readonly ? "read,grep,find,ls" : "read,bash,grep,find,ls,write,edit");
  const systemPrompt = spec?.systemPrompt ?? "";
  // CLI runtimes use their own model config. Only pass the PanCode model to native Pi runtime.
  const model = runtimeId === "pi" ? (spec?.model ?? process.env.PANCODE_WORKER_MODEL ?? null) : null;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const workerResult = await spawnWorker({
      task,
      tools,
      model,
      systemPrompt,
      cwd: process.cwd(),
      agentName,
      runtime: runtimeId,
      runtimeArgs,
      readonly,
      signal: controller.signal,
    });

    clearTimeout(timer);
    result.elapsed = `${((Date.now() - start) / 1000).toFixed(1)}s`;

    if (workerResult.result.trim().length > 0) {
      result.status = "pass";
      result.output = truncate(workerResult.result, 120);
    } else if (workerResult.error) {
      result.status = "fail";
      result.error = truncate(workerResult.error, 120);
    } else {
      result.status = "fail";
      result.error = `Empty result, exit ${workerResult.exitCode}`;
    }
  } catch (err) {
    clearTimeout(timer);
    result.elapsed = `${((Date.now() - start) / 1000).toFixed(1)}s`;
    if (controller.signal.aborted) {
      result.status = "timeout";
      result.error = "Timed out";
    } else {
      result.status = "fail";
      result.error = truncate(err instanceof Error ? err.message : String(err), 120);
    }
  }

  return result;
}

function printResult(r: TestResult): void {
  const statusTag = r.status.toUpperCase().padEnd(7);
  const icon = r.status === "pass" ? "OK" : r.status === "skip" ? "--" : "!!";
  const detail = r.status === "pass" ? r.output : r.error;
  console.log(`  [${icon}] ${statusTag} ${r.name.padEnd(30)} (${r.elapsed})`);
  if (detail) {
    console.log(`                                          ${truncate(detail, 100)}`);
  }
}

// ---------------------------------------------------------------------------
// Phase 2: Native Pi Agents + Local AI
// ---------------------------------------------------------------------------

async function phase2(): Promise<void> {
  console.log("========================================");
  console.log("  Phase 2: Native Pi Agents + Local AI");
  console.log("========================================\n");

  const nativeTests = [
    { name: "pi:dev (mutable)", agent: "dev", readonly: false, task: SIMPLE_TASK },
    { name: "pi:reviewer (readonly)", agent: "reviewer", readonly: true, task: SIMPLE_TASK },
    { name: "pi:scout (readonly)", agent: "scout", readonly: true, task: SIMPLE_TASK },
  ];

  for (const test of nativeTests) {
    const r = await dispatchTest(test.name, test.agent, "pi", test.task, test.readonly);
    results.push(r);
    printResult(r);
    console.log();
  }
}

// ---------------------------------------------------------------------------
// Phase 3: CLI Runtimes (readonly)
// ---------------------------------------------------------------------------

async function phase3(): Promise<void> {
  console.log("========================================");
  console.log("  Phase 3: CLI Runtimes (readonly)");
  console.log("========================================\n");

  const cliTests = [
    { name: "claude-code:readonly", runtime: "cli:claude-code", runtimeArgs: [] as string[] },
    { name: "codex:readonly", runtime: "cli:codex", runtimeArgs: [] as string[] },
    { name: "gemini:readonly", runtime: "cli:gemini", runtimeArgs: [] as string[] },
    { name: "opencode:readonly", runtime: "cli:opencode", runtimeArgs: [] as string[] },
    { name: "copilot-cli:readonly", runtime: "cli:copilot-cli", runtimeArgs: [] as string[] },
  ];

  for (const test of cliTests) {
    // Use a fresh agent name that maps to the CLI runtime
    const r = await dispatchTest(
      test.name,
      "smoke-readonly",
      test.runtime,
      SIMPLE_TASK,
      true,
      test.runtimeArgs,
    );
    results.push(r);
    printResult(r);
    console.log();
  }
}

// ---------------------------------------------------------------------------
// Phase 4: CLI Runtimes (mutable / act mode)
// ---------------------------------------------------------------------------

async function phase4(): Promise<void> {
  console.log("========================================");
  console.log("  Phase 4: CLI Runtimes (mutable)");
  console.log("========================================\n");

  const cliTests = [
    { name: "claude-code:mutable", runtime: "cli:claude-code", runtimeArgs: [] as string[] },
    { name: "codex:mutable", runtime: "cli:codex", runtimeArgs: [] as string[] },
    { name: "gemini:mutable", runtime: "cli:gemini", runtimeArgs: [] as string[] },
    { name: "opencode:mutable", runtime: "cli:opencode", runtimeArgs: [] as string[] },
    { name: "copilot-cli:mutable", runtime: "cli:copilot-cli", runtimeArgs: [] as string[] },
  ];

  for (const test of cliTests) {
    const r = await dispatchTest(
      test.name,
      "smoke-mutable",
      test.runtime,
      SIMPLE_TASK,
      false,
      test.runtimeArgs,
    );
    results.push(r);
    printResult(r);
    console.log();
  }
}

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

function printSummary(): void {
  console.log("========================================");
  console.log("  Summary");
  console.log("========================================\n");

  const pad = (s: string, n: number) => s.padEnd(n);
  const header = `  ${pad("Test", 32)} ${pad("Runtime", 18)} ${pad("RO", 5)} ${pad("Status", 9)} ${pad("Time", 8)}`;
  console.log(header);
  console.log("  " + "-".repeat(header.length - 2));

  for (const r of results) {
    const ro = r.readonly ? "yes" : "no";
    const line = `  ${pad(r.name, 32)} ${pad(r.runtime, 18)} ${pad(ro, 5)} ${pad(r.status, 9)} ${r.elapsed}`;
    console.log(line);
  }

  const total = results.length;
  const passed = results.filter((r) => r.status === "pass").length;
  const skipped = results.filter((r) => r.status === "skip").length;
  const failed = results.filter((r) => r.status === "fail").length;
  const timedOut = results.filter((r) => r.status === "timeout").length;

  console.log();
  console.log(`  Total: ${total} | Pass: ${passed} | Skip: ${skipped} | Fail: ${failed} | Timeout: ${timedOut}`);

  // Group by category
  const piResults = results.filter((r) => r.runtime === "pi");
  const cliReadonly = results.filter((r) => r.runtime !== "pi" && r.readonly);
  const cliMutable = results.filter((r) => r.runtime !== "pi" && !r.readonly);

  const piPass = piResults.filter((r) => r.status === "pass").length;
  const cliROPass = cliReadonly.filter((r) => r.status === "pass").length;
  const cliROEligible = cliReadonly.filter((r) => r.status !== "skip").length;
  const cliMutPass = cliMutable.filter((r) => r.status === "pass").length;
  const cliMutEligible = cliMutable.filter((r) => r.status !== "skip").length;

  console.log();
  console.log(`  Native Pi agents:     ${piPass}/${piResults.length} pass`);
  console.log(`  CLI readonly agents:  ${cliROPass}/${cliROEligible} pass (${cliReadonly.length - cliROEligible} skipped)`);
  console.log(`  CLI mutable agents:   ${cliMutPass}/${cliMutEligible} pass (${cliMutable.length - cliMutEligible} skipped)`);
  console.log();
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  console.log("PanCode End-to-End Smoke Test");
  console.log("============================");

  const bootOk = await phase1();
  if (!bootOk) {
    console.error("Phase 1 failed. Aborting.");
    process.exit(1);
  }

  await phase2();
  await phase3();
  await phase4();
  printSummary();
}

main().catch((err) => {
  console.error("Smoke test crashed:", err);
  process.exit(1);
});
