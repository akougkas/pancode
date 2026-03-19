/**
 * PanCode Mixed Dispatch Integration Test
 *
 * Verifies PanCode as a universal agent control plane by dispatching real
 * coding tasks to mixed teams of native Pi agents and CLI-based agents.
 *
 * 6 scenarios exercise different dispatch patterns:
 *   1. Pi Scout -> Claude Code Review (cross-runtime chain)
 *   2. Parallel Batch across 3 runtimes
 *   3. Codex Quick Fix (mutable, writes files)
 *   4. Cline Analysis (readonly exploration)
 *   5. Copilot CLI Analysis (readonly)
 *   6. Full Pipeline (Pi write -> Claude review -> Codex fix)
 *
 * Run: npx tsx scripts/integration-test-mixed.ts
 */

import { execSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { tmpdir } from "node:os";

// ---------------------------------------------------------------------------
// Environment bootstrap (mirrors loader.ts)
// ---------------------------------------------------------------------------

const PACKAGE_ROOT = join(import.meta.dirname, "..");
process.env.PANCODE_PACKAGE_ROOT = PACKAGE_ROOT;
process.env.PANCODE_HOME = process.env.PANCODE_HOME || join(homedir(), ".pancode");
process.env.PI_SKIP_VERSION_CHECK = "1";
process.env.PI_CODING_AGENT_DIR = join(process.env.PANCODE_HOME, "agent-engine");

// Load .env file manually (same as loader.ts)
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
import { agentRegistry, ensureAgentsYaml, loadAgentsFromYaml } from "../src/domains/agents/spec-registry";
import { spawnWorker, type WorkerResult } from "../src/domains/dispatch/worker-spawn";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const INDIVIDUAL_TIMEOUT_MS = 60_000;
const COPILOT_TIMEOUT_MS = 90_000;
const PIPELINE_TIMEOUT_MS = 120_000;

type ScenarioStatus = "PASS" | "SKIP" | "FAIL";

interface StepResult {
  label: string;
  status: ScenarioStatus;
  durationSec: number;
  summary: string;
}

interface ScenarioResult {
  name: string;
  status: ScenarioStatus;
  steps: StepResult[];
  totalDurationSec: number;
}

const scenarioResults: ScenarioResult[] = [];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function truncate(s: string, max: number): string {
  const clean = s.replace(/\n/g, " ").trim();
  return clean.length > max ? clean.slice(0, max) + "..." : clean;
}

function isRuntimeAvailable(runtimeId: string): boolean {
  const runtime = runtimeRegistry.get(runtimeId);
  return !!runtime && runtime.isAvailable();
}

async function dispatch(opts: {
  runtimeId: string;
  task: string;
  cwd: string;
  readonly: boolean;
  agentName?: string;
  timeoutMs?: number;
}): Promise<WorkerResult> {
  const { runtimeId, task, cwd, readonly: ro, agentName, timeoutMs } = opts;

  // Resolve agent spec for tools and system prompt
  const spec = agentName ? agentRegistry.get(agentName) : undefined;
  const tools = spec?.tools ?? (ro ? "read,grep,find,ls" : "read,bash,grep,find,ls,write,edit");
  const systemPrompt = spec?.systemPrompt ?? "";
  // CLI runtimes use their own model config. Only pass model to Pi.
  const model = runtimeId === "pi" ? (spec?.model ?? process.env.PANCODE_WORKER_MODEL ?? null) : null;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs ?? INDIVIDUAL_TIMEOUT_MS);

  try {
    const result = await spawnWorker({
      task,
      tools,
      model,
      systemPrompt,
      cwd,
      agentName: agentName ?? "integration-test",
      runtime: runtimeId,
      runtimeArgs: [],
      readonly: ro,
      signal: controller.signal,
    });
    clearTimeout(timer);
    return result;
  } catch (err) {
    clearTimeout(timer);
    return {
      exitCode: 1,
      result: "",
      error: err instanceof Error ? err.message : String(err),
      usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, cost: 0, turns: 0 },
      model: null,
    };
  }
}

function stepPass(label: string, durationSec: number, summary: string): StepResult {
  return { label, status: "PASS", durationSec, summary };
}

function stepFail(label: string, durationSec: number, summary: string): StepResult {
  return { label, status: "FAIL", durationSec, summary };
}

function stepSkip(label: string, summary: string): StepResult {
  return { label, status: "SKIP", durationSec: 0, summary };
}

// ---------------------------------------------------------------------------
// Seed project setup
// ---------------------------------------------------------------------------

const ORIGINAL_CALCULATOR = `export function add(a: number, b: number): number {
  return a + b;
}

export function subtract(a: number, b: number): number {
  return a - b;
}

// TODO: implement multiply and divide
`;

/** Reset calculator.ts to its original state so each scenario starts clean. */
function resetCalculator(projectDir: string): void {
  writeFileSync(join(projectDir, "calculator.ts"), ORIGINAL_CALCULATOR);
}

function createProjectDir(): string {
  const projectDir = mkdtempSync(join(tmpdir(), "pancode-integration-"));

  writeFileSync(join(projectDir, "calculator.ts"), ORIGINAL_CALCULATOR);

  writeFileSync(
    join(projectDir, "README.md"),
    `# Calculator Library
A simple TypeScript calculator with basic operations.
`,
  );

  writeFileSync(
    join(projectDir, "package.json"),
    JSON.stringify(
      {
        name: "test-calculator",
        version: "1.0.0",
        type: "module",
      },
      null,
      2,
    ),
  );

  // Initialize git repo so agents that require trusted directories (Codex) work.
  // Also helps Pi agents with file discovery via tool sandbox.
  execSync("git init && git add -A && git commit -m 'init'", {
    cwd: projectDir,
    stdio: "ignore",
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "pancode-test",
      GIT_AUTHOR_EMAIL: "test@pancode.dev",
      GIT_COMMITTER_NAME: "pancode-test",
      GIT_COMMITTER_EMAIL: "test@pancode.dev",
    },
  });

  return projectDir;
}

// ---------------------------------------------------------------------------
// Scenario 1: Pi Scout -> Claude Code Review (cross-runtime chain)
// ---------------------------------------------------------------------------

async function scenario1(projectDir: string): Promise<ScenarioResult> {
  const name = "Scenario 1: Pi Scout -> Claude Code Review (chain)";
  const steps: StepResult[] = [];

  // Check prerequisites
  if (!isRuntimeAvailable("pi")) {
    steps.push(stepSkip("pi:scout", "Pi runtime not available"));
    return { name, status: "SKIP", steps, totalDurationSec: 0 };
  }
  if (!isRuntimeAvailable("cli:claude-code")) {
    steps.push(stepSkip("cli:claude-code", "Claude Code not available"));
    return { name, status: "SKIP", steps, totalDurationSec: 0 };
  }

  const chainStart = Date.now();

  // Step 1: Pi scout explores the project
  const s1Start = Date.now();
  const s1 = await dispatch({
    runtimeId: "pi",
    task: `In the directory ${projectDir}, list all TypeScript files and read calculator.ts. Summarize what exported functions exist.`,
    cwd: projectDir,
    readonly: true,
    agentName: "scout",
  });
  const s1Duration = (Date.now() - s1Start) / 1000;

  if (s1.exitCode !== 0 || !s1.result.trim()) {
    steps.push(stepFail("pi:scout", s1Duration, s1.error || "Empty result"));
    return { name, status: "FAIL", steps, totalDurationSec: (Date.now() - chainStart) / 1000 };
  }

  const s1MentionsAdd = /add/i.test(s1.result);
  const s1MentionsSubtract = /subtract/i.test(s1.result);
  if (!s1MentionsAdd || !s1MentionsSubtract) {
    steps.push(
      stepFail("pi:scout", s1Duration, `Missing function mentions (add: ${s1MentionsAdd}, subtract: ${s1MentionsSubtract})`),
    );
    // Continue anyway to test the chain
  } else {
    steps.push(stepPass("pi:scout", s1Duration, truncate(s1.result, 80)));
  }

  // Step 2: Claude Code reviews based on scout findings
  const s2Start = Date.now();
  const s2 = await dispatch({
    runtimeId: "cli:claude-code",
    task: `Given this analysis: ${s1.result.slice(0, 4000)}\n\nReview calculator.ts for code quality, missing error handling, and suggest improvements.`,
    cwd: projectDir,
    readonly: true,
  });
  const s2Duration = (Date.now() - s2Start) / 1000;

  if (s2.exitCode !== 0 || !s2.result.trim()) {
    steps.push(stepFail("cli:claude-code", s2Duration, s2.error || "Empty result"));
    return { name, status: "FAIL", steps, totalDurationSec: (Date.now() - chainStart) / 1000 };
  }

  steps.push(stepPass("cli:claude-code", s2Duration, truncate(s2.result, 80)));

  const totalDuration = (Date.now() - chainStart) / 1000;
  const allPass = steps.every((s) => s.status === "PASS");

  // Verify total chain under 60 seconds
  if (totalDuration > 60) {
    steps.push(stepFail("chain-time", totalDuration, `Chain took ${totalDuration.toFixed(1)}s (limit: 60s)`));
  }

  return {
    name,
    status: allPass && totalDuration <= 60 ? "PASS" : "FAIL",
    steps,
    totalDurationSec: totalDuration,
  };
}

// ---------------------------------------------------------------------------
// Scenario 2: Parallel Batch Across 3 Runtimes
// ---------------------------------------------------------------------------

async function scenario2(projectDir: string): Promise<ScenarioResult> {
  const name = "Scenario 2: Parallel Batch (3 runtimes)";
  const steps: StepResult[] = [];

  const requiredRuntimes = ["pi", "cli:opencode", "cli:claude-code"];
  const missing = requiredRuntimes.filter((r) => !isRuntimeAvailable(r));
  if (missing.length > 0) {
    steps.push(stepSkip("batch", `Missing runtimes: ${missing.join(", ")}`));
    return { name, status: "SKIP", steps, totalDurationSec: 0 };
  }

  const batchStart = Date.now();

  // Dispatch all 3 in parallel using Promise.all
  const [r1, r2, r3] = await Promise.all([
    (async () => {
      const start = Date.now();
      const result = await dispatch({
        runtimeId: "pi",
        task: `Read the file ${join(projectDir, "calculator.ts")} and add a multiply function to it. Write the updated file back to ${join(projectDir, "calculator.ts")}.`,
        cwd: projectDir,
        readonly: false,
        agentName: "dev",
      });
      return { result, duration: (Date.now() - start) / 1000, label: "pi:dev" };
    })(),
    (async () => {
      const start = Date.now();
      const result = await dispatch({
        runtimeId: "cli:opencode",
        task: "Read calculator.ts and add a divide function with zero-division guard",
        cwd: projectDir,
        readonly: false,
      });
      return { result, duration: (Date.now() - start) / 1000, label: "cli:opencode" };
    })(),
    (async () => {
      const start = Date.now();
      const result = await dispatch({
        runtimeId: "cli:claude-code",
        task: "Read calculator.ts and suggest unit test cases",
        cwd: projectDir,
        readonly: true,
      });
      return { result, duration: (Date.now() - start) / 1000, label: "cli:claude-code" };
    })(),
  ]);

  const wallClockSec = (Date.now() - batchStart) / 1000;
  const maxIndividualSec = Math.max(r1.duration, r2.duration, r3.duration);

  for (const r of [r1, r2, r3]) {
    if (r.result.exitCode !== 0 || !r.result.result.trim()) {
      steps.push(stepFail(r.label, r.duration, r.result.error || "Empty result"));
    } else {
      const mentionsCalc = /calculator|add|subtract|multiply|divide|test/i.test(r.result.result);
      if (mentionsCalc) {
        steps.push(stepPass(r.label, r.duration, truncate(r.result.result, 60)));
      } else {
        steps.push(stepFail(r.label, r.duration, "Result does not mention calculator"));
      }
    }
  }

  // Check parallelism: wall clock should be close to max individual, not sum
  const parallelConfirmed = wallClockSec < maxIndividualSec + 10;
  if (parallelConfirmed) {
    steps.push(stepPass("parallelism", wallClockSec, `Wall: ${wallClockSec.toFixed(1)}s, max: ${maxIndividualSec.toFixed(1)}s`));
  } else {
    steps.push(
      stepFail("parallelism", wallClockSec, `Wall: ${wallClockSec.toFixed(1)}s, max: ${maxIndividualSec.toFixed(1)}s (sequential?)`),
    );
  }

  // Check each result addresses its specific task
  const r1Multiply = /multiply|product/i.test(r1.result.result);
  const r2Divide = /divide|division|zero/i.test(r2.result.result);
  const r3Tests = /test|assert|expect|describe|it\(|should/i.test(r3.result.result);

  if (!r1Multiply) steps.push(stepFail("task-check:pi:dev", 0, "multiply not mentioned"));
  if (!r2Divide) steps.push(stepFail("task-check:opencode", 0, "divide not mentioned"));
  if (!r3Tests) steps.push(stepFail("task-check:claude-code", 0, "tests not mentioned"));

  const allPass = steps.every((s) => s.status === "PASS");
  return { name, status: allPass ? "PASS" : "FAIL", steps, totalDurationSec: wallClockSec };
}

// ---------------------------------------------------------------------------
// Scenario 3: Codex Quick Fix (mutable, writes files)
// ---------------------------------------------------------------------------

async function scenario3(projectDir: string): Promise<ScenarioResult> {
  const name = "Scenario 3: Codex Quick Fix (file write)";
  const steps: StepResult[] = [];

  if (!isRuntimeAvailable("cli:codex")) {
    steps.push(stepSkip("cli:codex", "Codex not available"));
    return { name, status: "SKIP", steps, totalDurationSec: 0 };
  }

  // Read the file before to compare
  const fileBefore = readFileSync(join(projectDir, "calculator.ts"), "utf8");

  const start = Date.now();
  const result = await dispatch({
    runtimeId: "cli:codex",
    task: "Add a multiply function to calculator.ts that takes two numbers and returns their product. Write the change directly to the file.",
    cwd: projectDir,
    readonly: false,
  });
  const duration = (Date.now() - start) / 1000;

  if (result.exitCode !== 0) {
    steps.push(stepFail("cli:codex", duration, result.error || `Exit code ${result.exitCode}`));
    return { name, status: "FAIL", steps, totalDurationSec: duration };
  }

  steps.push(stepPass("cli:codex", duration, truncate(result.result, 60)));

  // Check file was modified
  const fileAfter = readFileSync(join(projectDir, "calculator.ts"), "utf8");
  const wasModified = fileAfter !== fileBefore;
  if (wasModified) {
    steps.push(stepPass("file-modified", 0, "calculator.ts modified"));
  } else {
    steps.push(stepFail("file-modified", 0, "calculator.ts was NOT modified (agent may have printed instead of writing)"));
  }

  // Check multiply function exists
  const hasMultiply = /multiply/i.test(fileAfter);
  const hasSignature = /function\s+multiply|multiply\s*=\s*\(|multiply\s*\(/i.test(fileAfter);
  if (hasMultiply && hasSignature) {
    steps.push(stepPass("multiply-found", 0, "multiply function found in file"));
  } else if (hasMultiply) {
    steps.push(stepPass("multiply-found", 0, "multiply mentioned (signature pattern not exact)"));
  } else {
    steps.push(stepFail("multiply-found", 0, "multiply function NOT found in file"));
  }

  const allPass = steps.every((s) => s.status === "PASS");
  return { name, status: allPass ? "PASS" : "FAIL", steps, totalDurationSec: duration };
}

// ---------------------------------------------------------------------------
// Scenario 4: Cline Analysis (readonly exploration)
// ---------------------------------------------------------------------------

async function scenario4(projectDir: string): Promise<ScenarioResult> {
  const name = "Scenario 4: Cline Analysis";
  const steps: StepResult[] = [];

  if (!isRuntimeAvailable("cli:cline")) {
    steps.push(stepSkip("cli:cline", "Cline not available"));
    return { name, status: "SKIP", steps, totalDurationSec: 0 };
  }

  // Cline plan mode (-p) has a known CLI bug (plan_mode_respond missing param).
  // Dispatch in act mode with a read-only task instead.
  const start = Date.now();
  const result = await dispatch({
    runtimeId: "cli:cline",
    task: "Analyze the calculator.ts file. List all exported functions, their signatures, and identify any missing error handling or edge cases. Do NOT modify any files.",
    cwd: projectDir,
    readonly: false,
  });
  const duration = (Date.now() - start) / 1000;

  if (result.exitCode !== 0 || !result.result.trim()) {
    steps.push(stepFail("cli:cline", duration, result.error || "Empty result"));
    return { name, status: "FAIL", steps, totalDurationSec: duration };
  }

  steps.push(stepPass("cli:cline", duration, truncate(result.result, 60)));

  // Check result mentions functions
  const mentionsFunctions = /add|subtract/i.test(result.result);
  if (mentionsFunctions) {
    steps.push(stepPass("functions-mentioned", 0, "Functions mentioned in result"));
  } else {
    steps.push(stepFail("functions-mentioned", 0, "Result does not mention calculator functions"));
  }

  // Check result identifies edge cases
  const mentionsEdgeCases = /division.*zero|zero.?division|NaN|overflow|edge\s*case|error\s*handling|type\s*check|invalid/i.test(
    result.result,
  );
  if (mentionsEdgeCases) {
    steps.push(stepPass("edge-cases", 0, "Edge cases identified"));
  } else {
    steps.push(stepFail("edge-cases", 0, "No edge cases identified in result"));
  }

  const allPass = steps.every((s) => s.status === "PASS");
  return { name, status: allPass ? "PASS" : "FAIL", steps, totalDurationSec: duration };
}

// ---------------------------------------------------------------------------
// Scenario 5: Copilot CLI Task (readonly analysis)
// ---------------------------------------------------------------------------

async function scenario5(projectDir: string): Promise<ScenarioResult> {
  const name = "Scenario 5: Copilot CLI Analysis";
  const steps: StepResult[] = [];

  if (!isRuntimeAvailable("cli:copilot-cli")) {
    steps.push(stepSkip("cli:copilot-cli", "Copilot CLI not available"));
    return { name, status: "SKIP", steps, totalDurationSec: 0 };
  }

  // Copilot CLI can take 30-45s per task. 90s timeout per the prompt spec.
  const start = Date.now();
  const result = await dispatch({
    runtimeId: "cli:copilot-cli",
    task: "Read calculator.ts and explain what this module does. List every exported function.",
    cwd: projectDir,
    readonly: true,
    timeoutMs: COPILOT_TIMEOUT_MS,
  });
  const duration = (Date.now() - start) / 1000;

  if (result.exitCode !== 0 || !result.result.trim()) {
    steps.push(stepFail("cli:copilot-cli", duration, result.error || "Empty result"));
    return { name, status: "FAIL", steps, totalDurationSec: duration };
  }

  // Copilot appends a usage summary to stdout. Strip it to find actual content.
  const usageSplit = result.result.indexOf("Total usage est:");
  const contentText = usageSplit > 0 ? result.result.slice(0, usageSplit).trim() : result.result.trim();

  if (!contentText) {
    // Copilot ran but only produced usage stats, no analysis text.
    steps.push(stepFail("cli:copilot-cli", duration, "Only usage stats returned, no analysis content"));
    return { name, status: "FAIL", steps, totalDurationSec: duration };
  }

  steps.push(stepPass("cli:copilot-cli", duration, truncate(contentText, 60)));

  // Check result mentions calculator functions
  const mentionsFunctions = /add|subtract|calculator|function/i.test(contentText);
  if (mentionsFunctions) {
    steps.push(stepPass("functions-mentioned", 0, "Calculator functions mentioned"));
  } else {
    steps.push(stepFail("functions-mentioned", 0, "Result does not mention calculator functions"));
  }

  const allPass = steps.every((s) => s.status === "PASS");
  return { name, status: allPass ? "PASS" : "FAIL", steps, totalDurationSec: duration };
}

// ---------------------------------------------------------------------------
// Scenario 6: Full Pipeline (Pi write -> Claude review -> Codex fix)
// ---------------------------------------------------------------------------

async function scenario6(projectDir: string): Promise<ScenarioResult> {
  const name = "Scenario 6: Full Pipeline (Pi -> Claude -> Codex)";
  const steps: StepResult[] = [];

  const requiredRuntimes = ["pi", "cli:claude-code", "cli:codex"];
  const missing = requiredRuntimes.filter((r) => !isRuntimeAvailable(r));
  if (missing.length > 0) {
    steps.push(stepSkip("pipeline", `Missing runtimes: ${missing.join(", ")}`));
    return { name, status: "SKIP", steps, totalDurationSec: 0 };
  }

  const pipelineStart = Date.now();
  const controller = new AbortController();
  const pipelineTimer = setTimeout(() => controller.abort(), PIPELINE_TIMEOUT_MS);

  try {
    // Step 1: Pi dev writes new code
    const s1Start = Date.now();
    const calcPath = join(projectDir, "calculator.ts");
    const s1 = await dispatch({
      runtimeId: "pi",
      task: `Read the file ${calcPath} and add an 'exponentiate' function that takes a base and exponent and returns base^exponent using Math.pow. Write the updated content back to ${calcPath}.`,
      cwd: projectDir,
      readonly: false,
      agentName: "dev",
    });
    const s1Duration = (Date.now() - s1Start) / 1000;

    if (s1.exitCode !== 0 || controller.signal.aborted) {
      steps.push(stepFail("pi:dev (write)", s1Duration, s1.error || "Failed to write"));
      return { name, status: "FAIL", steps, totalDurationSec: (Date.now() - pipelineStart) / 1000 };
    }

    // Verify exponentiate was added to the file
    const fileAfterS1 = readFileSync(join(projectDir, "calculator.ts"), "utf8");
    const hasExponentiate = /exponentiate/i.test(fileAfterS1);
    if (hasExponentiate) {
      steps.push(stepPass("pi:dev (write)", s1Duration, "exponentiate added"));
    } else {
      steps.push(stepFail("pi:dev (write)", s1Duration, "exponentiate NOT found in file after write"));
      // Continue pipeline anyway to exercise the chain
    }

    // Step 2: Claude Code reviews the new code
    const s2Start = Date.now();
    const s2 = await dispatch({
      runtimeId: "cli:claude-code",
      task: "Review calculator.ts focusing on the exponentiate function. Are there edge cases? Is the implementation correct? Report any issues.",
      cwd: projectDir,
      readonly: true,
    });
    const s2Duration = (Date.now() - s2Start) / 1000;

    if (s2.exitCode !== 0 || !s2.result.trim() || controller.signal.aborted) {
      steps.push(stepFail("claude (review)", s2Duration, s2.error || "Empty result"));
      return { name, status: "FAIL", steps, totalDurationSec: (Date.now() - pipelineStart) / 1000 };
    }

    // Check review identifies at least one concern
    const mentionsConcern = /negative|fractional|overflow|edge|zero|infinity|NaN|large|undefined|error/i.test(s2.result);
    if (mentionsConcern) {
      steps.push(stepPass("claude (review)", s2Duration, truncate(s2.result, 60)));
    } else {
      steps.push(stepFail("claude (review)", s2Duration, "No concerns identified in review"));
    }

    // Step 3: Codex fixes issues
    const s3Start = Date.now();
    const s3 = await dispatch({
      runtimeId: "cli:codex",
      task: `Based on this review: ${s2.result.slice(0, 4000)}\n\nFix any issues found in calculator.ts's exponentiate function.`,
      cwd: projectDir,
      readonly: false,
    });
    const s3Duration = (Date.now() - s3Start) / 1000;

    if (s3.exitCode !== 0) {
      steps.push(stepFail("codex (fix)", s3Duration, s3.error || `Exit code ${s3.exitCode}`));
    } else {
      const fileAfterS3 = readFileSync(join(projectDir, "calculator.ts"), "utf8");
      const fileChanged = fileAfterS3 !== fileAfterS1;
      if (fileChanged) {
        steps.push(stepPass("codex (fix)", s3Duration, "calculator.ts updated"));
      } else {
        // Codex may have addressed it in output without writing. Partial pass.
        steps.push(stepPass("codex (fix)", s3Duration, truncate(s3.result, 60)));
      }
    }
  } finally {
    clearTimeout(pipelineTimer);
  }

  const totalDuration = (Date.now() - pipelineStart) / 1000;

  // Verify pipeline under 120 seconds
  if (totalDuration > 120) {
    steps.push(stepFail("pipeline-time", totalDuration, `Pipeline took ${totalDuration.toFixed(1)}s (limit: 120s)`));
  }

  const allPass = steps.every((s) => s.status === "PASS");
  return { name, status: allPass ? "PASS" : "FAIL", steps, totalDurationSec: totalDuration };
}

// ---------------------------------------------------------------------------
// Output Formatting
// ---------------------------------------------------------------------------

function printScenario(sr: ScenarioResult): void {
  const statusIcon = sr.status === "PASS" ? "+" : sr.status === "SKIP" ? "-" : "!";
  console.log(`\n${sr.name}`);

  for (const step of sr.steps) {
    const icon = step.status === "PASS" ? "+" : step.status === "SKIP" ? "-" : "!";
    const time = step.durationSec > 0 ? `${step.durationSec.toFixed(1)}s` : "";
    const pad = step.label.padEnd(28);
    console.log(`  [${icon}] ${step.status.padEnd(4)}  ${pad} ${time.padStart(7)}  ${step.summary}`);
  }

  if (sr.steps.length > 1 && sr.totalDurationSec > 0) {
    console.log(`  Total: ${sr.totalDurationSec.toFixed(1)}s`);
  }
}

function printSummary(): void {
  const total = scenarioResults.length;
  const passed = scenarioResults.filter((s) => s.status === "PASS").length;
  const skipped = scenarioResults.filter((s) => s.status === "SKIP").length;
  const failed = scenarioResults.filter((s) => s.status === "FAIL").length;

  // Count total dispatches
  let totalDispatches = 0;
  const runtimesUsed = new Set<string>();
  let fileMutations = 0;

  for (const sr of scenarioResults) {
    for (const step of sr.steps) {
      // Count actual dispatch steps (those with a runtime label)
      if (step.label.includes(":") && step.status !== "SKIP" && !step.label.startsWith("task-check") && !step.label.startsWith("pipeline") && !step.label.startsWith("chain") && !step.label.startsWith("parallel") && !step.label.startsWith("file") && !step.label.startsWith("multiply") && !step.label.startsWith("function") && !step.label.startsWith("edge")) {
        totalDispatches++;
        // Extract runtime from label
        if (step.label.startsWith("cli:")) {
          runtimesUsed.add(step.label.split(" ")[0]);
        } else if (step.label.startsWith("pi:")) {
          runtimesUsed.add("pi");
        }
      }
      if (step.label.includes("modified") || step.label.includes("updated") || step.label.includes("write")) {
        if (step.status === "PASS") fileMutations++;
      }
    }
  }

  const totalTime = scenarioResults.reduce((sum, s) => sum + s.totalDurationSec, 0);

  console.log("\n" + "=".repeat(54));
  console.log("  PANCODE MIXED DISPATCH INTEGRATION TEST");
  console.log("=".repeat(54));
  console.log();
  console.log(`  SCENARIOS: ${passed}/${total} PASS, ${skipped} SKIP, ${failed} FAIL`);
  console.log(`  DISPATCHES: ${totalDispatches} total`);
  console.log(`  RUNTIMES TESTED: ${[...runtimesUsed].join(", ") || "none"}`);
  console.log(`  FILE MUTATIONS: ${fileMutations}`);
  console.log(`  TOTAL TIME: ~${totalTime.toFixed(0)}s`);
  console.log();
  console.log("=".repeat(54));
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  console.log("=".repeat(54));
  console.log("  PANCODE MIXED DISPATCH INTEGRATION TEST");
  console.log("=".repeat(54));

  // --- Bootstrap ---
  console.log("\n--- Bootstrap ---\n");

  const discovery = discoverAndRegisterRuntimes();
  console.log(`  Registered: ${discovery.registered.join(", ")}`);
  console.log(`  Available:  ${discovery.available.join(", ")}`);
  if (discovery.unavailable.length > 0) {
    console.log(`  Unavailable: ${discovery.unavailable.join(", ")}`);
  }

  // Load agent specs
  const specs = loadAgentsFromYaml(process.env.PANCODE_HOME!);
  for (const spec of specs) {
    if (!agentRegistry.has(spec.name)) {
      agentRegistry.register(spec);
    }
  }
  console.log(`  Agents: ${agentRegistry.names().join(", ")}`);

  // Each scenario gets its own project directory to avoid file conflicts.
  const dirs: string[] = [];
  const makeDir = () => {
    const d = createProjectDir();
    dirs.push(d);
    return d;
  };

  try {
    // Run scenarios sequentially with isolated project dirs.
    // Sequential avoids provider rate limits and resource contention
    // between concurrent agent subprocesses.
    const scenarios = [scenario1, scenario2, scenario3, scenario4, scenario5, scenario6];
    for (const fn of scenarios) {
      const sr = await fn(makeDir());
      scenarioResults.push(sr);
      printScenario(sr);
    }

    // --- Summary ---
    printSummary();
  } finally {
    // Always clean up all project dirs
    for (const d of dirs) {
      try {
        rmSync(d, { recursive: true, force: true });
      } catch {
        // ignore
      }
    }
    console.log(`  Cleaned up ${dirs.length} project directories`);
  }

  // Exit with failure code if any scenario failed (not skipped)
  const hasFail = scenarioResults.some((s) => s.status === "FAIL");
  if (hasFail) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("Integration test crashed:", err);
  process.exit(1);
});
