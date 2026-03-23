/**
 * Dispatch Diagnostic: Test 4 - Single Dispatch Simulation
 *
 * Runs the exact spawnWorker() code path outside the TUI. Verifies the
 * full dispatch pipeline from routing through spawn to result collection.
 *
 * Requires a running local AI provider (LM Studio, Ollama, or llama.cpp).
 * Skip with --dry-run to test everything except the actual subprocess.
 *
 * Run: npx tsx scripts/diag-single-dispatch.ts
 * Run: npx tsx scripts/diag-single-dispatch.ts --dry-run
 */

import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

// ---------------------------------------------------------------------------
// Environment bootstrap
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
// Imports
// ---------------------------------------------------------------------------

import { loadConfig } from "../src/core/config";
import { agentRegistry, ensureAgentsYaml, loadAgentsFromYaml } from "../src/domains/agents/spec-registry";
import { resolveWorkerRouting } from "../src/domains/dispatch/routing";
import { spawnWorker, stopAllWorkers } from "../src/domains/dispatch/worker-spawn";
import { compileWorkerPrompt } from "../src/domains/prompts/worker-compiler";
import { discoverEngines, writeProvidersYaml } from "../src/domains/providers/discovery";
import { discoverAndRegisterRuntimes } from "../src/engine/runtimes/discovery";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const isDryRun = process.argv.includes("--dry-run");
let stepNumber = 0;
let failCount = 0;

function step(description: string): void {
  stepNumber++;
  process.stdout.write(`Step ${stepNumber}: ${description} ... `);
}

function pass(details?: string): void {
  console.log(`PASS${details ? ` [${details}]` : ""}`);
}

function fail(details: string): void {
  failCount++;
  console.log(`FAIL [${details}]`);
}

function elapsed(startMs: number): string {
  return `${(Date.now() - startMs).toFixed(0)}ms`;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  console.log("=== DIAG: SINGLE DISPATCH SIMULATION ===");
  if (isDryRun) {
    console.log("(dry-run mode: skipping actual subprocess spawn)");
  }
  console.log("");

  // Step 1: Bootstrap (same as Test 1, condensed)
  step("Bootstrap: config, runtimes, providers, agents");
  const t1 = Date.now();
  try {
    const config = loadConfig();

    // Runtimes
    discoverAndRegisterRuntimes();

    // Providers: discover and write YAML cache. Model registration into the Pi
    // ModelRegistry requires the full orchestrator boot path (session creation).
    // For this diagnostic, routing resolves from PANCODE_WORKER_MODEL and panagents.yaml.
    const discovered = await discoverEngines();
    const pancodeHome = process.env.PANCODE_HOME ?? "";
    if (discovered.length > 0) {
      writeProvidersYaml(discovered, pancodeHome);
    }

    // Agents
    ensureAgentsYaml(pancodeHome);
    const specs = loadAgentsFromYaml(pancodeHome);
    for (const spec of specs) {
      agentRegistry.register(spec);
    }

    pass(`${elapsed(t1)}, ${discovered.length} providers, ${specs.length} agents`);
  } catch (err) {
    fail(`Bootstrap failed: ${err instanceof Error ? err.message : String(err)}`);
    console.log("\nVERDICT: FAIL (bootstrap failed, cannot continue)");
    return;
  }

  // Step 2: Resolve routing for "dev" agent
  step('Resolve routing for "dev" agent');
  let routing: ReturnType<typeof resolveWorkerRouting>;
  try {
    routing = resolveWorkerRouting("dev");
    if (!routing.model) {
      fail("No model resolved for dev agent. Set PANCODE_WORKER_MODEL.");
      console.log("\nVERDICT: FAIL (no worker model, cannot dispatch)");
      return;
    }
    pass(`model=${routing.model}, runtime=${routing.runtime}, tools=${routing.tools}, readonly=${routing.readonly}`);
  } catch (err) {
    fail(`Routing resolution threw: ${err instanceof Error ? err.message : String(err)}`);
    console.log("\nVERDICT: FAIL (routing failed)");
    return;
  }

  // Step 3: Compile worker prompt
  step("Compile worker system prompt");
  let systemPrompt: string;
  try {
    const spec = agentRegistry.get("dev");
    systemPrompt = compileWorkerPrompt(
      spec ? { name: spec.name, systemPrompt: spec.systemPrompt, readonly: spec.readonly, tools: spec.tools } : null,
      {
        agentName: "dev",
        task: "Read package.json and report the version number",
        readonly: false,
        tools: routing.tools,
        mode: "build",
        tier: "mid",
      },
      null,
    );
    pass(`${systemPrompt.length} chars`);
  } catch (err) {
    fail(`Prompt compilation threw: ${err instanceof Error ? err.message : String(err)}`);
    systemPrompt = "";
  }

  // Step 4: Spawn worker (or dry-run)
  if (isDryRun) {
    step("Spawn worker (DRY RUN, skipped)");
    pass("dry-run mode, spawn skipped");
  } else {
    step("Spawn worker with task: read package.json version");
    const startTime = Date.now();

    try {
      const result = await spawnWorker({
        task: "Read package.json and report the version number. Answer with just the version string.",
        tools: routing.tools,
        model: routing.model,
        systemPrompt,
        cwd: PACKAGE_ROOT,
        agentName: "dev",
        sampling: routing.sampling,
        runtime: routing.runtime,
        runtimeArgs: routing.runtimeArgs,
        readonly: true,
        timeoutMs: 60_000,
        runId: `diag-${Date.now()}`,
      });

      const wallTime = elapsed(startTime);

      console.log(`\n  Exit code: ${result.exitCode}`);
      console.log(`  Model used: ${result.model ?? "(not reported)"}`);
      console.log(`  Wall time: ${wallTime}`);
      console.log(`  Timed out: ${result.timedOut ?? false}`);
      console.log(`  Budget exceeded: ${result.budgetExceeded ?? false}`);
      console.log("  Token usage:");
      console.log(`    Input: ${result.usage.inputTokens ?? "?"}`);
      console.log(`    Output: ${result.usage.outputTokens ?? "?"}`);
      console.log(`    Cache read: ${result.usage.cacheReadTokens ?? "?"}`);
      console.log(`    Cache write: ${result.usage.cacheWriteTokens ?? "?"}`);
      console.log(`    Cost: ${result.usage.cost ?? "?"}`);
      console.log(`    Turns: ${result.usage.turns ?? "?"}`);

      if (result.error) {
        console.log(`  Error: ${result.error}`);
      }

      if (result.result) {
        console.log(`  Result (first 500 chars): ${result.result.slice(0, 500)}`);
      }

      // Verify: does the result mention a version number?
      if (result.exitCode === 0 && !result.error) {
        // Read the actual version from package.json for comparison
        const pkgJson = JSON.parse(readFileSync(join(PACKAGE_ROOT, "package.json"), "utf8")) as { version: string };
        const actualVersion = pkgJson.version;

        if (result.result.includes(actualVersion)) {
          pass(`worker found correct version ${actualVersion}, wall time ${wallTime}`);
        } else {
          // Check if any version-like string is in the output
          const versionPattern = /\d+\.\d+\.\d+/;
          const match = result.result.match(versionPattern);
          if (match) {
            console.log(`WARN [worker reported version "${match[0]}" but expected "${actualVersion}"]`);
          } else {
            fail(`worker completed but result does not contain version "${actualVersion}"`);
          }
        }
      } else if (result.timedOut) {
        fail(`worker timed out after ${wallTime}`);
      } else {
        fail(`worker failed with exit code ${result.exitCode}: ${result.error}`);
      }
    } catch (err) {
      fail(`spawnWorker threw: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // Cleanup
  await stopAllWorkers();

  // Verdict
  console.log("");
  if (failCount === 0) {
    console.log("VERDICT: PASS (all steps clean)");
  } else {
    console.log(`VERDICT: FAIL (${failCount} failure(s) detected)`);
  }
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
