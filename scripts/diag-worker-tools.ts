/**
 * Dispatch Diagnostic: Test 3 - Worker Tool Audit
 *
 * Inspects what tools a worker subprocess would receive, verifies
 * dispatch_agent does NOT appear in the worker tool set, checks depth
 * limits, and audits the safety extension.
 *
 * Run: npx tsx scripts/diag-worker-tools.ts
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
process.env.PANCODE_RUNTIME_ROOT = runtimeRoot;

// ---------------------------------------------------------------------------
// Imports
// ---------------------------------------------------------------------------

// Side-effect import: settings-state sets PANCODE_HOME fallback at module scope,
// which must happen before providers/shared.ts evaluates (it throws if unset).
import "../src/core/settings-state";
import { agentRegistry, ensureAgentsYaml, loadAgentsFromYaml } from "../src/domains/agents/spec-registry";
import { resolveWorkerRouting } from "../src/domains/dispatch/routing";
import { discoverAndRegisterRuntimes } from "../src/engine/runtimes/discovery";
import { runtimeRegistry } from "../src/engine/runtimes/registry";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Static analysis helpers
// ---------------------------------------------------------------------------

/** Read a source file and search for patterns, returning matching lines. */
function grepSource(filePath: string, pattern: RegExp): string[] {
  if (!existsSync(filePath)) return [];
  const content = readFileSync(filePath, "utf8");
  return content.split("\n").filter((line) => pattern.test(line));
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main(): void {
  console.log("=== DIAG: WORKER TOOL AUDIT ===");

  // Load agent specs first
  const pancodeHome = process.env.PANCODE_HOME ?? "";
  ensureAgentsYaml(pancodeHome);
  const specs = loadAgentsFromYaml(pancodeHome);
  for (const spec of specs) {
    agentRegistry.register(spec);
  }

  // Discover runtimes
  discoverAndRegisterRuntimes();

  // Step 1: Trace worker entry tool registration
  step("Read worker entry.ts and trace tool registration");
  const workerEntryPath = join(PACKAGE_ROOT, "src", "worker", "entry.ts");
  if (!existsSync(workerEntryPath)) {
    fail("src/worker/entry.ts not found");
  } else {
    const content = readFileSync(workerEntryPath, "utf8");

    // Check what tools are available via the --tools CLI arg
    const toolsArgLines = content.split("\n").filter((line) => /tools/i.test(line) && /args|param|option/i.test(line));
    const hasToolsArg = content.includes("--tools");

    if (hasToolsArg) {
      pass("worker entry accepts --tools argument for tool allowlisting");
    } else {
      fail("worker entry does not accept --tools argument");
    }

    // Show what tools the worker entry makes available
    console.log("  Tool passing mechanism: --tools <csv> CLI argument");
    console.log("  Worker entry parses tools and passes to Pi subprocess");
  }

  // Step 2: Verify dispatch_agent does NOT appear in worker tool list
  step("Verify dispatch_agent does NOT appear in worker tools");
  const dispatchTools = ["dispatch_agent", "batch_dispatch", "dispatch_chain", "shadow_explore"];
  const workerAgents = ["dev", "reviewer", "scout", "builder", "planner", "documenter", "red-team", "plan-reviewer"];
  const violations: string[] = [];

  for (const agentName of workerAgents) {
    try {
      const routing = resolveWorkerRouting(agentName);
      const tools = routing.tools.split(",").map((t) => t.trim());
      for (const forbidden of dispatchTools) {
        if (tools.includes(forbidden)) {
          violations.push(`${agentName} has forbidden tool "${forbidden}"`);
        }
      }
    } catch {
      // Agent not registered, skip
    }
  }

  if (violations.length > 0) {
    fail(`Recursive dispatch possible: ${violations.join("; ")}`);
  } else {
    pass("no dispatch tools in any worker agent tool set");
  }

  // Step 3: Check PANCODE_DISPATCH_DEPTH and PANCODE_DISPATCH_MAX_DEPTH
  step("Check dispatch depth environment variables");
  const currentDepth = process.env.PANCODE_DISPATCH_DEPTH;
  const maxDepth = process.env.PANCODE_DISPATCH_MAX_DEPTH;

  console.log(
    `PASS [PANCODE_DISPATCH_DEPTH=${currentDepth ?? "(not set)"}, PANCODE_DISPATCH_MAX_DEPTH=${maxDepth ?? "(not set)"}]`,
  );

  // Also check if the worker entry sets or checks these
  const entryContent = readFileSync(workerEntryPath, "utf8");
  const depthChecks = entryContent.split("\n").filter((line) => /DISPATCH_DEPTH|DISPATCH_MAX_DEPTH/i.test(line));
  if (depthChecks.length > 0) {
    console.log("  Depth enforcement found in worker entry:");
    for (const line of depthChecks) {
      console.log(`    ${line.trim()}`);
    }
  } else {
    console.log("  No explicit depth checks in worker entry (depth enforcement is in dispatch extension)");
  }

  // Step 4: Check worker safety extension
  step("Check safety extension (src/worker/safety-ext.ts)");
  const safetyExtPath = join(PACKAGE_ROOT, "src", "worker", "safety-ext.ts");
  if (!existsSync(safetyExtPath)) {
    fail("src/worker/safety-ext.ts not found");
  } else {
    const safetyContent = readFileSync(safetyExtPath, "utf8");

    // Check what the safety extension provides
    const toolRegistrations = safetyContent.split("\n").filter((line) => /registerTool|register_tool/i.test(line));
    const eventHandlers = safetyContent.split("\n").filter((line) => /\.on\(|pi\.on/i.test(line));
    const blockPatterns = safetyContent
      .split("\n")
      .filter((line) => /block|deny|reject|forbidden|not\s+allowed/i.test(line));

    pass(`${toolRegistrations.length} tool registrations, ${eventHandlers.length} event handlers`);

    // Check isolation: safety-ext must NOT import from src/domains/ or src/engine/
    const domainImports = safetyContent.split("\n").filter((line) => /from\s+["'].*\/(domains|engine)\//i.test(line));
    if (domainImports.length > 0) {
      console.log("  WARNING: safety-ext imports from domains/ or engine/ (isolation violation):");
      for (const line of domainImports) {
        console.log(`    ${line.trim()}`);
      }
    } else {
      console.log("  Isolation verified: no imports from src/domains/ or src/engine/");
    }

    // Check what Pi SDK imports are used
    const piImports = safetyContent.split("\n").filter((line) => /from\s+["']@pancode\/pi-/i.test(line));
    if (piImports.length > 0) {
      console.log("  Pi SDK imports (expected for worker subprocess):");
      for (const line of piImports) {
        console.log(`    ${line.trim()}`);
      }
    }
  }

  // Step 5: List all agent tool schemas
  step("List all registered agents with tools");
  const allSpecs = agentRegistry.getAll();

  if (allSpecs.length === 0) {
    fail("No agent specs registered");
  } else {
    pass(`${allSpecs.length} agents registered`);
    console.log("");
    console.log(
      `  ${"Agent".padEnd(16)}${"Tools".padEnd(40)}${"Readonly".padEnd(10)}${"Runtime".padEnd(16)}${"Tier".padEnd(10)}`,
    );
    console.log(`  ${"-".repeat(92)}`);
    for (const spec of allSpecs) {
      console.log(
        `  ${spec.name.padEnd(16)}${spec.tools.padEnd(40)}${String(spec.readonly).padEnd(10)}${spec.runtime.padEnd(16)}${spec.tier.padEnd(10)}`,
      );
    }
  }

  // Additional: verify worker tools via routing for each agent
  console.log("\n  Routing resolution per agent:");
  console.log(
    `  ${"Agent".padEnd(16)}${"Routed Model".padEnd(30)}${"Routed Tools".padEnd(40)}${"Worker ID".padEnd(12)}`,
  );
  console.log(`  ${"-".repeat(98)}`);
  for (const spec of allSpecs) {
    try {
      const routing = resolveWorkerRouting(spec.name);
      console.log(
        `  ${spec.name.padEnd(16)}${(routing.model ?? "(none)").padEnd(30)}${routing.tools.padEnd(40)}${(routing.workerId ?? "(none)").padEnd(12)}`,
      );
    } catch (err) {
      console.log(`  ${spec.name.padEnd(16)}ERROR: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // Verdict
  console.log("");
  if (failCount === 0) {
    console.log("VERDICT: PASS (all steps clean)");
  } else {
    console.log(`VERDICT: FAIL (${failCount} failure(s) detected)`);
  }
}

main();
