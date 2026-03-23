/**
 * Dispatch Diagnostic: Test 1 - Bootstrap Trace
 *
 * Simulates what the orchestrator does at startup without launching a TUI
 * or tmux. Verifies provider registration, model resolution, runtime
 * discovery, domain loading, and conflict detection.
 *
 * Run: npx tsx scripts/diag-bootstrap.ts
 */

import { existsSync, mkdirSync, readFileSync } from "node:fs";
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
// Imports (after env is set)
// ---------------------------------------------------------------------------

import { loadConfig } from "../src/core/config";
import { DEFAULT_ENABLED_DOMAINS } from "../src/core/defaults";
import { filterValidDomains, resolveDomainOrder } from "../src/core/domain-loader";
import { DOMAIN_REGISTRY } from "../src/domains";
import { agentRegistry, ensureAgentsYaml, loadAgentsFromYaml } from "../src/domains/agents/spec-registry";
import { resolveWorkerRouting } from "../src/domains/dispatch/routing";
import { discoverEngines } from "../src/domains/providers/discovery";
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

function elapsed(startMs: number): string {
  return `${(Date.now() - startMs).toFixed(0)}ms`;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  console.log("=== DIAG: BOOTSTRAP TRACE ===");

  // Step 1: Load config
  step("Load config via src/core/config.ts");
  const t1 = Date.now();
  try {
    const config = loadConfig();
    pass(`${elapsed(t1)}, profile=${config.profile}, cwd=${config.cwd}`);
  } catch (err) {
    fail(`Config load threw: ${err instanceof Error ? err.message : String(err)}`);
  }

  // Step 2: Provider discovery
  step("Run provider discovery");
  const t2 = Date.now();
  try {
    const results = await discoverEngines();
    if (results.length === 0) {
      fail(`No providers found (${elapsed(t2)}). Check local AI services.`);
    } else {
      const summary = results.map((r) => `${r.providerId}(${r.engine}, ${r.models.length} models)`).join(", ");
      pass(`${elapsed(t2)}, found ${results.length} providers: ${summary}`);

      // Dump per-engine timing
      for (const r of results) {
        console.log(`  Provider: ${r.providerId}`);
        console.log(`    Engine: ${r.engine}`);
        console.log(`    Base URL: ${r.baseUrl}`);
        console.log(`    Models: ${r.models.map((m) => m.id).join(", ")}`);
      }
    }
  } catch (err) {
    fail(`Provider discovery threw: ${err instanceof Error ? err.message : String(err)}`);
  }

  // Step 3: Runtime discovery
  step("Run runtime discovery");
  const t3 = Date.now();
  try {
    const runtimes = discoverAndRegisterRuntimes();
    pass(
      `${elapsed(t3)}, registered=${runtimes.registered.join(",")}, available=${runtimes.available.join(",")}, unavailable=${runtimes.unavailable.join(",")}`,
    );
  } catch (err) {
    fail(`Runtime discovery threw: ${err instanceof Error ? err.message : String(err)}`);
  }

  // Step 4: Domain loading order
  step("Load domain extensions via domain-loader");
  try {
    const validDomains = filterValidDomains(DEFAULT_ENABLED_DOMAINS, DOMAIN_REGISTRY);
    const ordered = resolveDomainOrder(validDomains, DOMAIN_REGISTRY);
    const names = ordered.map((d) => d.manifest.name);
    pass(`load order: ${names.join(" -> ")}`);
    for (const d of ordered) {
      const deps = d.manifest.dependsOn?.join(", ") || "(none)";
      console.log(`  Domain: ${d.manifest.name}, depends on: ${deps}`);
    }
  } catch (err) {
    fail(`Domain loading threw: ${err instanceof Error ? err.message : String(err)}`);
  }

  // Step 5: Load agent specs
  step("Load agent specs from panagents.yaml");
  try {
    const pancodeHome = process.env.PANCODE_HOME ?? "";
    ensureAgentsYaml(pancodeHome);
    const specs = loadAgentsFromYaml(pancodeHome);
    for (const spec of specs) {
      agentRegistry.register(spec);
    }
    const names = specs.map((s) => s.name);
    pass(`${specs.length} agents: ${names.join(", ")}`);
  } catch (err) {
    fail(`Agent spec loading threw: ${err instanceof Error ? err.message : String(err)}`);
  }

  // Step 6: Resolve orchestrator model
  step("Resolve orchestrator model");
  try {
    const config = loadConfig();
    if (config.model) {
      pass(`model=${config.model}, provider=${config.provider ?? "auto"}`);
    } else {
      fail("No orchestrator model configured (PANCODE_MODEL not set, no default-model file)");
    }
  } catch (err) {
    fail(`Model resolution threw: ${err instanceof Error ? err.message : String(err)}`);
  }

  // Step 7: Resolve worker model (dev agent)
  step("Resolve worker model (dev agent)");
  try {
    const routing = resolveWorkerRouting("dev");
    if (routing.model) {
      pass(`model=${routing.model}, runtime=${routing.runtime}, readonly=${routing.readonly}, tools=${routing.tools}`);
    } else {
      fail("No worker model resolved. Set PANCODE_WORKER_MODEL or configure model in panagents.yaml.");
    }
  } catch (err) {
    fail(`Worker routing threw: ${err instanceof Error ? err.message : String(err)}`);
  }

  // Step 8: Dump all discovered models
  step("Dump all discovered models with provider ID and capabilities");
  try {
    const results = await discoverEngines();
    let totalModels = 0;
    for (const r of results) {
      for (const m of r.models) {
        totalModels++;
        console.log(
          `\n  Model: ${r.providerId}/${m.id}` +
            `\n    Engine: ${r.engine}` +
            `\n    Context: ${m.contextLength ?? "unknown"}`,
        );
      }
    }
    if (totalModels === 0) {
      fail("No models discovered across any provider");
    } else {
      pass(`${totalModels} models across ${results.length} providers`);
    }
  } catch (err) {
    fail(`Model enumeration threw: ${err instanceof Error ? err.message : String(err)}`);
  }

  // Step 9: Check for conflicts
  step("Check for conflicts (duplicate provider IDs, ambiguous model refs)");
  try {
    const results = await discoverEngines();
    const providerIds = results.map((r) => r.providerId);
    const duplicateProviders = providerIds.filter((id, idx) => providerIds.indexOf(id) !== idx);

    const modelRefs: string[] = [];
    for (const r of results) {
      for (const m of r.models) {
        modelRefs.push(`${r.providerId}/${m.id}`);
      }
    }
    const duplicateModels = modelRefs.filter((ref, idx) => modelRefs.indexOf(ref) !== idx);

    const issues: string[] = [];
    if (duplicateProviders.length > 0) {
      issues.push(`duplicate provider IDs: ${duplicateProviders.join(", ")}`);
    }
    if (duplicateModels.length > 0) {
      issues.push(`duplicate model refs: ${duplicateModels.join(", ")}`);
    }

    if (issues.length > 0) {
      fail(issues.join("; "));
    } else {
      pass("no conflicts detected");
    }
  } catch (err) {
    fail(`Conflict check threw: ${err instanceof Error ? err.message : String(err)}`);
  }

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
