/**
 * Multi-Runtime Integration Test
 *
 * Proves PanCode's Pan-runtime promise by dispatching real coding tasks
 * across mixed runtimes in chains, batches, and pipelines.
 *
 * 6 scenarios:
 *   1. Single dispatch per runtime (readonly)
 *   2. Cross-runtime chain (Pi scout then CLI review)
 *   3. Parallel batch across mixed runtimes
 *   4. File mutation verification
 *   5. Readonly enforcement
 *   6. Full pipeline: write, review, fix
 *
 * Run:  npx tsx scripts/test-multi-runtime.ts
 * Dry:  npx tsx scripts/test-multi-runtime.ts --dry-run
 */

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";

// ---------------------------------------------------------------------------
// Environment bootstrap (mirrors diag-single-dispatch.ts pattern)
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
import { spawnWorker, stopAllWorkers } from "../src/domains/dispatch/worker-spawn";
import { discoverEngines, writeProvidersYaml } from "../src/domains/providers/discovery";
import { discoverAndRegisterRuntimes } from "../src/engine/runtimes/discovery";
import { runtimeRegistry } from "../src/engine/runtimes/registry";
import type { RuntimeUsage } from "../src/engine/runtimes/types";

// ---------------------------------------------------------------------------
// CLI flags
// ---------------------------------------------------------------------------

const isDryRun = process.argv.includes("--dry-run");

/** Per-dispatch timeout in milliseconds. */
const DISPATCH_TIMEOUT_MS = 90_000;

/** Pipeline-level timeout. */
const PIPELINE_TIMEOUT_MS = 120_000;

// ---------------------------------------------------------------------------
// Test project seed files
// ---------------------------------------------------------------------------

const SEED_CALCULATOR = `export function add(a: number, b: number): number { return a + b; }
export function subtract(a: number, b: number): number { return a - b; }
// TODO: implement multiply and divide
`;

const SEED_README = `# Test Project
A minimal TypeScript calculator for integration testing.
`;

const SEED_PACKAGE_JSON = JSON.stringify(
  {
    name: "pancode-test-project",
    version: "0.0.1",
    private: true,
    scripts: { build: "echo ok" },
  },
  null,
  2,
);

// ---------------------------------------------------------------------------
// Result tracking types
// ---------------------------------------------------------------------------

interface ScenarioResult {
  scenario: number;
  name: string;
  status: "PASS" | "FAIL" | "SKIP";
  details: string;
  wallTimeMs: number;
  steps: StepResult[];
}

interface StepResult {
  label: string;
  runtime: string;
  status: "PASS" | "FAIL" | "SKIP";
  wallTimeMs: number;
  exitCode: number;
  resultPreview: string;
  usage: RuntimeUsage | null;
  model: string | null;
  error: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let runIdCounter = 0;
function nextRunId(): string {
  return `mrt-${Date.now()}-${runIdCounter++}`;
}

function formatMs(ms: number): string {
  return `${(ms / 1000).toFixed(1)}s`;
}

function formatTokens(usage: RuntimeUsage | null): string {
  if (!usage) return "--";
  const total = (usage.inputTokens ?? 0) + (usage.outputTokens ?? 0);
  return total > 0 ? `${total} tok` : "--";
}

function formatCost(usage: RuntimeUsage | null): string {
  if (!usage || usage.cost === null) return "--";
  return `$${usage.cost.toFixed(4)}`;
}

function preview(text: string, maxLen: number): string {
  const clean = text.replace(/\n/g, " ").trim();
  if (clean.length <= maxLen) return clean;
  return `${clean.slice(0, maxLen)}...`;
}

function createTempProject(): string {
  const tmpDir = mkdtempSync(join(tmpdir(), "pancode-mrt-"));
  writeFileSync(join(tmpDir, "calculator.ts"), SEED_CALCULATOR);
  writeFileSync(join(tmpDir, "README.md"), SEED_README);
  writeFileSync(join(tmpDir, "package.json"), SEED_PACKAGE_JSON);
  return tmpDir;
}

function cleanupTempProject(dir: string): void {
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    console.error(`[cleanup] Warning: could not remove ${dir}`);
  }
}

/** Find the first available CLI runtime, optionally preferring a specific one. */
function findCliRuntime(prefer?: string): { id: string; available: boolean } | null {
  const available = runtimeRegistry.available().filter((r) => r.id.startsWith("cli:"));
  if (available.length === 0) return null;

  if (prefer) {
    const preferred = available.find((r) => r.id === prefer);
    if (preferred) return { id: preferred.id, available: true };
  }

  return { id: available[0].id, available: true };
}

/** Find N distinct available CLI runtimes. */
function findNCliRuntimes(n: number): string[] {
  const available = runtimeRegistry.available().filter((r) => r.id.startsWith("cli:"));
  return available.slice(0, n).map((r) => r.id);
}

/** Dispatch a task and return a StepResult. */
async function dispatch(opts: {
  label: string;
  runtime: string;
  task: string;
  cwd: string;
  readonly: boolean;
  timeoutMs?: number;
}): Promise<StepResult> {
  const start = Date.now();

  if (isDryRun) {
    return {
      label: opts.label,
      runtime: opts.runtime,
      status: "SKIP",
      wallTimeMs: 0,
      exitCode: 0,
      resultPreview: "(dry-run)",
      usage: null,
      model: null,
      error: "",
    };
  }

  try {
    const result = await spawnWorker({
      task: opts.task,
      tools: opts.readonly ? "read,grep,find,ls" : "read,write,edit,bash,grep,find,ls",
      model: process.env.PANCODE_WORKER_MODEL || null,
      systemPrompt: opts.readonly
        ? "You are a code analysis agent. Read and analyze code. Do not modify any files."
        : "You are a coding agent. Complete the task efficiently. Modify files as needed.",
      cwd: opts.cwd,
      agentName: "test-worker",
      runtime: opts.runtime,
      runtimeArgs: [],
      readonly: opts.readonly,
      timeoutMs: opts.timeoutMs ?? DISPATCH_TIMEOUT_MS,
      runId: nextRunId(),
    });

    const elapsed = Date.now() - start;
    const isError = result.exitCode !== 0 || !!result.error;

    return {
      label: opts.label,
      runtime: opts.runtime,
      status: isError ? "FAIL" : "PASS",
      wallTimeMs: elapsed,
      exitCode: result.exitCode,
      resultPreview: preview(result.result || result.error || "(empty)", 200),
      usage: result.usage,
      model: result.model,
      error: result.error,
    };
  } catch (err) {
    const elapsed = Date.now() - start;
    const msg = err instanceof Error ? err.message : String(err);

    // Auth or binary-not-found errors are SKIPs, not FAILs.
    const isSkip =
      msg.includes("not found") ||
      msg.includes("authentication") ||
      msg.includes("ENOENT") ||
      msg.includes("Unknown runtime");

    return {
      label: opts.label,
      runtime: opts.runtime,
      status: isSkip ? "SKIP" : "FAIL",
      wallTimeMs: elapsed,
      exitCode: 1,
      resultPreview: "",
      usage: null,
      model: null,
      error: msg,
    };
  }
}

// ---------------------------------------------------------------------------
// Scenario implementations
// ---------------------------------------------------------------------------

async function scenario1(cwd: string): Promise<ScenarioResult> {
  const start = Date.now();
  const steps: StepResult[] = [];
  const task = "Read calculator.ts and list every exported function with its signature.";

  const allRuntimes = runtimeRegistry.all();
  for (const rt of allRuntimes) {
    if (!rt.isAvailable()) {
      steps.push({
        label: rt.id,
        runtime: rt.id,
        status: "SKIP",
        wallTimeMs: 0,
        exitCode: 0,
        resultPreview: `not installed`,
        usage: null,
        model: null,
        error: "",
      });
      continue;
    }

    const step = await dispatch({
      label: rt.id,
      runtime: rt.id,
      task,
      cwd,
      readonly: true,
    });
    steps.push(step);
  }

  const fails = steps.filter((s) => s.status === "FAIL").length;
  const passes = steps.filter((s) => s.status === "PASS").length;

  return {
    scenario: 1,
    name: "Single Dispatch Per Runtime",
    status: fails > 0 ? "FAIL" : passes > 0 ? "PASS" : "SKIP",
    details: `${passes} pass, ${fails} fail, ${steps.length - passes - fails} skip`,
    wallTimeMs: Date.now() - start,
    steps,
  };
}

async function scenario2(cwd: string): Promise<ScenarioResult> {
  const start = Date.now();
  const steps: StepResult[] = [];

  // Step 1: Pi scout explores the project
  const piAvailable = runtimeRegistry.get("pi")?.isAvailable() ?? false;
  if (!piAvailable) {
    return {
      scenario: 2,
      name: "Cross-Runtime Chain",
      status: "SKIP",
      details: "Pi runtime not available",
      wallTimeMs: 0,
      steps: [],
    };
  }

  const step1 = await dispatch({
    label: "Step 1 (pi:scout)",
    runtime: "pi",
    task: "List all TypeScript files and summarize what functions exist in calculator.ts",
    cwd,
    readonly: true,
  });
  steps.push(step1);

  if (step1.status === "FAIL" && !isDryRun) {
    return {
      scenario: 2,
      name: "Cross-Runtime Chain",
      status: "FAIL",
      details: `Step 1 failed: ${step1.error}`,
      wallTimeMs: Date.now() - start,
      steps,
    };
  }

  // Step 2: Best CLI runtime reviews based on findings
  const cli = findCliRuntime("cli:claude-code");
  if (!cli) {
    steps.push({
      label: "Step 2 (cli:none)",
      runtime: "none",
      status: "SKIP",
      wallTimeMs: 0,
      exitCode: 0,
      resultPreview: "No CLI runtime available",
      usage: null,
      model: null,
      error: "",
    });

    return {
      scenario: 2,
      name: "Cross-Runtime Chain",
      status: "SKIP",
      details: "No CLI runtime available for step 2",
      wallTimeMs: Date.now() - start,
      steps,
    };
  }

  const step2 = await dispatch({
    label: `Step 2 (${cli.id})`,
    runtime: cli.id,
    task: `Given this analysis: ${step1.resultPreview}\n\nReview calculator.ts for code quality and suggest improvements.`,
    cwd,
    readonly: true,
  });
  steps.push(step2);

  // Validate chain reference: step 2 should reference functions from step 1
  const referencesValid =
    isDryRun ||
    step2.resultPreview.toLowerCase().includes("add") ||
    step2.resultPreview.toLowerCase().includes("subtract") ||
    step2.resultPreview.toLowerCase().includes("function");

  const allPass = steps.every((s) => s.status !== "FAIL");

  return {
    scenario: 2,
    name: "Cross-Runtime Chain",
    status: allPass ? "PASS" : "FAIL",
    details: `Chain references valid: ${referencesValid ? "YES" : "NO"}`,
    wallTimeMs: Date.now() - start,
    steps,
  };
}

async function scenario3(cwd: string): Promise<ScenarioResult> {
  const start = Date.now();

  // Need Pi + at least 2 CLI runtimes for full parallel batch; adapt to what is available.
  const piAvailable = runtimeRegistry.get("pi")?.isAvailable() ?? false;
  const cliRuntimes = findNCliRuntimes(2);

  const dispatches: Array<{ label: string; runtime: string; task: string; readonly: boolean }> = [];

  if (piAvailable) {
    dispatches.push({
      label: "Pi dev: multiply",
      runtime: "pi",
      task: "Add a multiply function to calculator.ts that takes two numbers and returns their product.",
      readonly: false,
    });
  }

  if (cliRuntimes[0]) {
    dispatches.push({
      label: `${cliRuntimes[0]}: divide`,
      runtime: cliRuntimes[0],
      task: "Add a divide function with zero-division guard to calculator.ts",
      readonly: false,
    });
  }

  if (cliRuntimes[1]) {
    dispatches.push({
      label: `${cliRuntimes[1]}: test cases`,
      runtime: cliRuntimes[1],
      task: "Suggest unit test cases for calculator.ts. Do not create files, just list the test cases.",
      readonly: true,
    });
  } else if (cliRuntimes[0]) {
    // Reuse the first CLI for the third task if only one CLI is available
    dispatches.push({
      label: `${cliRuntimes[0]}: test cases`,
      runtime: cliRuntimes[0],
      task: "Suggest unit test cases for calculator.ts. Do not create files, just list the test cases.",
      readonly: true,
    });
  }

  if (dispatches.length === 0) {
    return {
      scenario: 3,
      name: "Parallel Batch Across Mixed Runtimes",
      status: "SKIP",
      details: "No runtimes available for parallel batch",
      wallTimeMs: 0,
      steps: [],
    };
  }

  // Launch all dispatches in parallel
  const batchStart = Date.now();
  const promises = dispatches.map((d) =>
    dispatch({
      label: d.label,
      runtime: d.runtime,
      task: d.task,
      cwd,
      readonly: d.readonly,
    }),
  );

  const steps = await Promise.all(promises);
  const batchWall = Date.now() - batchStart;

  // Check parallelism: wall time should be less than sum of individual times + 10s
  const maxIndividual = Math.max(...steps.map((s) => s.wallTimeMs));
  const parallelismProved = isDryRun || batchWall < maxIndividual + 10_000;

  const fails = steps.filter((s) => s.status === "FAIL").length;

  return {
    scenario: 3,
    name: "Parallel Batch Across Mixed Runtimes",
    status: fails > 0 ? "FAIL" : "PASS",
    details: `${steps.length} dispatches, wall=${formatMs(batchWall)}, max_individual=${formatMs(maxIndividual)}, parallelism=${parallelismProved ? "YES" : "NO"}`,
    wallTimeMs: Date.now() - start,
    steps,
  };
}

async function scenario4(cwd: string): Promise<ScenarioResult> {
  const start = Date.now();

  // Prefer codex for mutable tasks; fall back to any available CLI
  const cli = findCliRuntime("cli:codex") ?? findCliRuntime();
  const piAvailable = runtimeRegistry.get("pi")?.isAvailable() ?? false;

  const runtime = cli?.id ?? (piAvailable ? "pi" : null);
  if (!runtime) {
    return {
      scenario: 4,
      name: "File Mutation Verification",
      status: "SKIP",
      details: "No mutable runtime available",
      wallTimeMs: 0,
      steps: [],
    };
  }

  // Read file before dispatch
  const calcPath = join(cwd, "calculator.ts");
  const before = readFileSync(calcPath, "utf8");

  const step = await dispatch({
    label: `Mutate (${runtime})`,
    runtime,
    task: "Add a multiply function to calculator.ts that takes two numbers and returns their product. Write the function into the file.",
    cwd,
    readonly: false,
  });

  // Read file after dispatch
  const after = readFileSync(calcPath, "utf8");
  const fileModified = after !== before;
  const multiplyPresent = after.includes("multiply") || after.includes("Multiply");

  let status: "PASS" | "FAIL" | "SKIP" = "SKIP";
  let details: string;

  if (isDryRun) {
    details = "dry-run, no dispatch";
  } else if (step.status === "FAIL") {
    details = `Dispatch failed: ${step.error}`;
    status = "FAIL";
  } else if (fileModified && multiplyPresent) {
    details = "File modified, multiply function present";
    status = "PASS";
  } else if (!fileModified) {
    // Check if the agent printed the code instead of writing it
    const resultMentionsMultiply =
      step.resultPreview.toLowerCase().includes("multiply") || step.resultPreview.toLowerCase().includes("function");
    details = resultMentionsMultiply
      ? "File NOT modified but agent printed code in output (common misconfiguration)"
      : "File NOT modified, no code in output either";
    status = "FAIL";
  } else {
    details = "File modified but multiply function not detected";
    status = "FAIL";
  }

  return {
    scenario: 4,
    name: "File Mutation Verification",
    status,
    details,
    wallTimeMs: Date.now() - start,
    steps: [step],
  };
}

async function scenario5(cwd: string): Promise<ScenarioResult> {
  const start = Date.now();

  // Use any available runtime
  const piAvailable = runtimeRegistry.get("pi")?.isAvailable() ?? false;
  const cli = findCliRuntime();
  const runtime = piAvailable ? "pi" : cli?.id ?? null;

  if (!runtime) {
    return {
      scenario: 5,
      name: "Readonly Enforcement",
      status: "SKIP",
      details: "No runtime available",
      wallTimeMs: 0,
      steps: [],
    };
  }

  // Read file before dispatch
  const calcPath = join(cwd, "calculator.ts");
  const before = readFileSync(calcPath, "utf8");

  const step = await dispatch({
    label: `Readonly (${runtime})`,
    runtime,
    task: "Modify calculator.ts to add error handling to the add and subtract functions.",
    cwd,
    readonly: true,
  });

  // Read file after dispatch: it should be unchanged
  const after = readFileSync(calcPath, "utf8");
  const fileChanged = after !== before;

  let status: "PASS" | "FAIL" | "SKIP" = "SKIP";
  let details: string;

  if (isDryRun) {
    details = "dry-run, no dispatch";
  } else if (fileChanged) {
    details = "VIOLATION: file was modified despite readonly=true";
    status = "FAIL";
  } else {
    details = "File unchanged, readonly enforced correctly";
    status = step.status === "FAIL" ? "FAIL" : "PASS";
  }

  return {
    scenario: 5,
    name: "Readonly Enforcement",
    status,
    details,
    wallTimeMs: Date.now() - start,
    steps: [step],
  };
}

async function scenario6(cwd: string): Promise<ScenarioResult> {
  const start = Date.now();
  const steps: StepResult[] = [];

  // Need a mutable runtime and at least one reviewer runtime
  const piAvailable = runtimeRegistry.get("pi")?.isAvailable() ?? false;
  const cli = findCliRuntime("cli:claude-code");

  const writerRuntime = piAvailable ? "pi" : cli?.id ?? null;
  const reviewerRuntime = cli?.id ?? (piAvailable ? "pi" : null);

  if (!writerRuntime || !reviewerRuntime) {
    return {
      scenario: 6,
      name: "Full Pipeline (Write, Review, Fix)",
      status: "SKIP",
      details: "Insufficient runtimes for pipeline",
      wallTimeMs: 0,
      steps: [],
    };
  }

  const calcPath = join(cwd, "calculator.ts");

  // Step 1: Write an exponentiate function
  const beforeWrite = readFileSync(calcPath, "utf8");
  const step1 = await dispatch({
    label: `Step 1: Write (${writerRuntime})`,
    runtime: writerRuntime,
    task: "Add an exponentiate function to calculator.ts that takes a base and exponent and returns base raised to the exponent power. Write it into the file.",
    cwd,
    readonly: false,
    timeoutMs: PIPELINE_TIMEOUT_MS,
  });
  steps.push(step1);

  const afterWrite = readFileSync(calcPath, "utf8");
  const writeAdded = afterWrite !== beforeWrite && (afterWrite.includes("exponentiate") || afterWrite.includes("power"));

  if (step1.status === "FAIL" && !isDryRun) {
    return {
      scenario: 6,
      name: "Full Pipeline (Write, Review, Fix)",
      status: "FAIL",
      details: `Step 1 failed: ${step1.error}`,
      wallTimeMs: Date.now() - start,
      steps,
    };
  }

  // Step 2: Review the new code
  const step2 = await dispatch({
    label: `Step 2: Review (${reviewerRuntime})`,
    runtime: reviewerRuntime,
    task: "Review calculator.ts for code quality, edge cases, and potential improvements. List any concerns.",
    cwd,
    readonly: true,
    timeoutMs: DISPATCH_TIMEOUT_MS,
  });
  steps.push(step2);

  // Step 3: Fix based on review (use a different CLI if available, or same writer)
  const fixerCli = findCliRuntime();
  const fixerRuntime = fixerCli?.id ?? writerRuntime;

  const step3 = await dispatch({
    label: `Step 3: Fix (${fixerRuntime})`,
    runtime: fixerRuntime,
    task: `Based on this review: ${step2.resultPreview}\n\nFix any issues mentioned in calculator.ts. If no issues were found, add input validation to the exponentiate function.`,
    cwd,
    readonly: false,
    timeoutMs: PIPELINE_TIMEOUT_MS,
  });
  steps.push(step3);

  const afterFix = readFileSync(calcPath, "utf8");

  const allPass = steps.every((s) => s.status !== "FAIL");

  return {
    scenario: 6,
    name: "Full Pipeline (Write, Review, Fix)",
    status: isDryRun ? "SKIP" : allPass ? "PASS" : "FAIL",
    details: `write_added=${writeAdded}, review_has_content=${step2.resultPreview.length > 10}, file_after_fix=${afterFix.length} chars`,
    wallTimeMs: Date.now() - start,
    steps,
  };
}

// ---------------------------------------------------------------------------
// Report printer
// ---------------------------------------------------------------------------

function printReport(
  discovery: { registered: string[]; available: string[]; unavailable: string[] },
  results: ScenarioResult[],
  totalStart: number,
): void {
  console.log("");
  console.log("=== PANCODE MULTI-RUNTIME INTEGRATION TEST ===");
  console.log("");

  // Runtime discovery summary
  const allIds = runtimeRegistry.all().map((r) => r.id);
  const availIds = runtimeRegistry.available().map((r) => r.id);
  const unavailIds = allIds.filter((id) => !availIds.includes(id));

  console.log(`RUNTIMES DISCOVERED: ${allIds.join(", ")}`);
  console.log(`RUNTIMES AVAILABLE:  ${availIds.join(", ")} (${availIds.length} of ${allIds.length})`);
  if (unavailIds.length > 0) {
    const unavailDetails = unavailIds.map((id) => `${id} (not installed)`);
    console.log(`RUNTIMES SKIPPED:   ${unavailDetails.join(", ")}`);
  }
  console.log("");

  // Print each scenario
  let totalDispatches = 0;

  for (const r of results) {
    const statusTag = r.status === "PASS" ? "PASS" : r.status === "FAIL" ? "FAIL" : "SKIP";
    console.log(`SCENARIO ${r.scenario}: ${r.name}`);
    console.log(`  Status: ${statusTag}  Wall: ${formatMs(r.wallTimeMs)}  ${r.details}`);

    for (const step of r.steps) {
      totalDispatches++;
      const tok = formatTokens(step.usage);
      const cost = formatCost(step.usage);
      const modelStr = step.model ?? "--";

      const line = `  ${step.label.padEnd(30)} ${step.status.padEnd(5)} ${formatMs(step.wallTimeMs).padStart(7)} ${tok.padStart(10)} ${cost.padStart(8)} ${modelStr.padStart(20)}`;
      console.log(line);

      if (step.status === "FAIL" && step.error) {
        console.log(`    Error: ${preview(step.error, 120)}`);
      }
      if (step.resultPreview && step.status !== "SKIP") {
        console.log(`    Result: ${preview(step.resultPreview, 120)}`);
      }
    }
    console.log("");
  }

  // Summary
  const pass = results.filter((r) => r.status === "PASS").length;
  const fail = results.filter((r) => r.status === "FAIL").length;
  const skip = results.filter((r) => r.status === "SKIP").length;
  const totalWall = Date.now() - totalStart;

  console.log(`SUMMARY: ${results.length} scenarios, ${pass} PASS, ${skip} SKIP, ${fail} FAIL`);
  console.log(`TOTAL DISPATCHES: ${totalDispatches}`);
  console.log(`TOTAL WALL TIME: ${formatMs(totalWall)}`);

  if (fail > 0) {
    console.log("\nVERDICT: ISSUES FOUND (see FAIL scenarios above)");
  } else {
    console.log("\nVERDICT: ALL SCENARIOS CLEAN");
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const totalStart = Date.now();
  let tmpDir = "";

  try {
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

    // Run all 6 scenarios sequentially.
    // Scenarios 3-6 mutate files, so each scenario that needs a clean state
    // gets a fresh temp directory. Scenarios 1-2 are readonly.
    const results: ScenarioResult[] = [];

    console.log("--- Scenario 1: Single Dispatch Per Runtime ---");
    results.push(await scenario1(tmpDir));

    console.log("--- Scenario 2: Cross-Runtime Chain ---");
    results.push(await scenario2(tmpDir));

    // Scenarios 3-6 may mutate files. Create fresh temp dirs for isolation.
    console.log("--- Scenario 3: Parallel Batch ---");
    const tmpDir3 = createTempProject();
    try {
      results.push(await scenario3(tmpDir3));
    } finally {
      cleanupTempProject(tmpDir3);
    }

    console.log("--- Scenario 4: File Mutation ---");
    const tmpDir4 = createTempProject();
    try {
      results.push(await scenario4(tmpDir4));
    } finally {
      cleanupTempProject(tmpDir4);
    }

    console.log("--- Scenario 5: Readonly Enforcement ---");
    const tmpDir5 = createTempProject();
    try {
      results.push(await scenario5(tmpDir5));
    } finally {
      cleanupTempProject(tmpDir5);
    }

    console.log("--- Scenario 6: Full Pipeline ---");
    const tmpDir6 = createTempProject();
    try {
      results.push(await scenario6(tmpDir6));
    } finally {
      cleanupTempProject(tmpDir6);
    }

    // Print final report
    printReport(discovery, results, totalStart);
  } finally {
    // Cleanup main temp dir and stop any orphan workers
    if (tmpDir) cleanupTempProject(tmpDir);
    await stopAllWorkers();
  }
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
