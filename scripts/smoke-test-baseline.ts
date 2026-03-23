/**
 * PanCode Baseline Smoke Test
 *
 * Comprehensive point-in-time health check for PanCode. Exercises structural
 * integrity, bootstrap sequence, command registration, runtime discovery,
 * prompt compilation, and identity compliance.
 *
 * Phases:
 *   1. Structural checks (typecheck, check-boundaries, build, lint)
 *   2. Bootstrap validation (config, domains, agents, models)
 *   3. Command registration audit (all domain extensions)
 *   4. Runtime discovery and availability
 *   5. PanPrompt compilation and constitution coverage
 *   6. Identity compliance (no Pi/Claude branding leaks)
 *   7. Summary and baseline report
 *
 * Run: npx tsx scripts/smoke-test-baseline.ts
 *      npx tsx scripts/smoke-test-baseline.ts --skip-structural
 *      npx tsx scripts/smoke-test-baseline.ts --json
 */

import { execSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
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

import { mkdirSync } from "node:fs";

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
import type { OrchestratorMode } from "../src/core/modes";
import { DOMAIN_REGISTRY } from "../src/domains";
import { agentRegistry, ensureAgentsYaml, loadAgentsFromYaml } from "../src/domains/agents/spec-registry";
import { discoverEngines } from "../src/domains/providers/discovery";
import { compilePrompt } from "../src/domains/prompts/compiler";
import { ALL_FRAGMENTS } from "../src/domains/prompts/fragments";
import type { CompilationContext, FragmentCategory, ModelTier, PromptRole } from "../src/domains/prompts/types";
import { discoverAndRegisterRuntimes } from "../src/engine/runtimes/discovery";
import { runtimeRegistry } from "../src/engine/runtimes/registry";

// ---------------------------------------------------------------------------
// CLI flags
// ---------------------------------------------------------------------------

const args = process.argv.slice(2);
const skipStructural = args.includes("--skip-structural");
const jsonOutput = args.includes("--json");

// ---------------------------------------------------------------------------
// Result tracking
// ---------------------------------------------------------------------------

type CheckStatus = "pass" | "fail" | "warn" | "skip";

interface CheckResult {
  phase: string;
  name: string;
  status: CheckStatus;
  details: string;
  elapsed?: string;
}

const results: CheckResult[] = [];
let phaseNumber = 0;
let checkNumber = 0;

function startPhase(name: string): void {
  phaseNumber++;
  checkNumber = 0;
  if (!jsonOutput) {
    console.log(`\n${"=".repeat(70)}`);
    console.log(`  Phase ${phaseNumber}: ${name}`);
    console.log(`${"=".repeat(70)}\n`);
  }
}

function check(phase: string, name: string, fn: () => { status: CheckStatus; details: string }): void {
  checkNumber++;
  const start = Date.now();

  if (!jsonOutput) {
    process.stdout.write(`  [${phaseNumber}.${checkNumber}] ${name} ... `);
  }

  try {
    const result = fn();
    const elapsedMs = Date.now() - start;
    const elapsed = `${elapsedMs}ms`;

    results.push({ phase, name, ...result, elapsed });

    if (!jsonOutput) {
      const tag = result.status.toUpperCase();
      console.log(`${tag} (${elapsed})${result.details ? ` [${result.details}]` : ""}`);
    }
  } catch (err) {
    const elapsedMs = Date.now() - start;
    const elapsed = `${elapsedMs}ms`;
    const message = err instanceof Error ? err.message : String(err);

    results.push({ phase, name, status: "fail", details: message, elapsed });

    if (!jsonOutput) {
      console.log(`FAIL (${elapsed}) [${message}]`);
    }
  }
}

async function checkAsync(
  phase: string,
  name: string,
  fn: () => Promise<{ status: CheckStatus; details: string }>,
): Promise<void> {
  checkNumber++;
  const start = Date.now();

  if (!jsonOutput) {
    process.stdout.write(`  [${phaseNumber}.${checkNumber}] ${name} ... `);
  }

  try {
    const result = await fn();
    const elapsedMs = Date.now() - start;
    const elapsed = `${elapsedMs}ms`;

    results.push({ phase, name, ...result, elapsed });

    if (!jsonOutput) {
      const tag = result.status.toUpperCase();
      console.log(`${tag} (${elapsed})${result.details ? ` [${result.details}]` : ""}`);
    }
  } catch (err) {
    const elapsedMs = Date.now() - start;
    const elapsed = `${elapsedMs}ms`;
    const message = err instanceof Error ? err.message : String(err);

    results.push({ phase, name, status: "fail", details: message, elapsed });

    if (!jsonOutput) {
      console.log(`FAIL (${elapsed}) [${message}]`);
    }
  }
}

// ---------------------------------------------------------------------------
// Helper: run npm script and return pass/fail
// ---------------------------------------------------------------------------

function runNpmScript(script: string): { status: CheckStatus; details: string } {
  try {
    execSync(`npm run ${script}`, {
      cwd: PACKAGE_ROOT,
      stdio: ["pipe", "pipe", "pipe"],
      timeout: 120_000,
    });
    return { status: "pass", details: "" };
  } catch (err) {
    const stderr =
      err && typeof err === "object" && "stderr" in err ? String((err as { stderr: unknown }).stderr).trim() : "";
    const truncated = stderr.length > 200 ? `${stderr.slice(0, 200)}...` : stderr;
    return { status: "fail", details: truncated || "non-zero exit" };
  }
}

// ---------------------------------------------------------------------------
// Helper: extract registerCommand calls from extension source files
// ---------------------------------------------------------------------------

function extractRegisteredCommands(): Map<string, string[]> {
  const domainCommands = new Map<string, string[]>();
  const domainsDir = join(PACKAGE_ROOT, "src", "domains");

  for (const domain of readdirSync(domainsDir, { withFileTypes: true })) {
    if (!domain.isDirectory()) continue;
    const extPath = join(domainsDir, domain.name, "extension.ts");
    if (!existsSync(extPath)) continue;

    const source = readFileSync(extPath, "utf8");
    const commands: string[] = [];
    const pattern = /registerCommand\(\s*"([^"]+)"/g;
    let match: RegExpExecArray | null = null;
    while ((match = pattern.exec(source)) !== null) {
      commands.push(match[1]);
    }

    domainCommands.set(domain.name, commands);
  }

  return domainCommands;
}

// ---------------------------------------------------------------------------
// Phase 1: Structural Checks
// ---------------------------------------------------------------------------

function phase1(): void {
  startPhase("Structural Checks");

  if (skipStructural) {
    results.push({ phase: "structural", name: "typecheck", status: "skip", details: "--skip-structural" });
    results.push({ phase: "structural", name: "check-boundaries", status: "skip", details: "--skip-structural" });
    results.push({ phase: "structural", name: "build", status: "skip", details: "--skip-structural" });
    results.push({ phase: "structural", name: "lint", status: "skip", details: "--skip-structural" });
    if (!jsonOutput) {
      console.log("  Skipped (--skip-structural flag)");
    }
    return;
  }

  check("structural", "typecheck", () => runNpmScript("typecheck"));
  check("structural", "check-boundaries", () => runNpmScript("check-boundaries"));
  check("structural", "build", () => runNpmScript("build"));
  check("structural", "lint", () => runNpmScript("lint"));
}

// ---------------------------------------------------------------------------
// Phase 2: Bootstrap Validation
// ---------------------------------------------------------------------------

async function phase2(): Promise<void> {
  startPhase("Bootstrap Validation");

  // Config loading
  check("bootstrap", "Load config", () => {
    const config = loadConfig();
    return { status: "pass", details: `profile=${config.profile}, cwd=${config.cwd}` };
  });

  // Domain resolution
  check("bootstrap", "Domain resolution order", () => {
    const validDomains = filterValidDomains(DEFAULT_ENABLED_DOMAINS, DOMAIN_REGISTRY);
    const ordered = resolveDomainOrder(validDomains, DOMAIN_REGISTRY);
    const names = ordered.map((d) => d.manifest.name);
    const count = names.length;
    return { status: "pass", details: `${count} domains: ${names.join(" -> ")}` };
  });

  // Verify expected domain count
  check("bootstrap", "Domain count", () => {
    const registryKeys = Object.keys(DOMAIN_REGISTRY);
    const enabled = filterValidDomains(DEFAULT_ENABLED_DOMAINS, DOMAIN_REGISTRY);
    // intelligence is not in DEFAULT_ENABLED_DOMAINS
    const expected = 8; // safety, session, agents, prompts, dispatch, observability, scheduling, ui
    if (enabled.length < expected) {
      return { status: "fail", details: `expected >= ${expected} enabled, got ${enabled.length}` };
    }
    return { status: "pass", details: `${registryKeys.length} registered, ${enabled.length} enabled` };
  });

  // Domain dependency integrity
  check("bootstrap", "Domain dependency integrity", () => {
    const validDomains = filterValidDomains(DEFAULT_ENABLED_DOMAINS, DOMAIN_REGISTRY);
    const ordered = resolveDomainOrder(validDomains, DOMAIN_REGISTRY);
    // If we get here without an exception, dependencies are valid
    for (const entry of ordered) {
      const deps = entry.manifest.dependsOn ?? [];
      for (const dep of deps) {
        if (!validDomains.includes(dep)) {
          return { status: "fail", details: `domain "${entry.manifest.name}" depends on disabled domain "${dep}"` };
        }
      }
    }
    return { status: "pass", details: "no missing or circular dependencies" };
  });

  // Agent specs
  check("bootstrap", "Load agent specs", () => {
    const pancodeHome = process.env.PANCODE_HOME ?? "";
    ensureAgentsYaml(pancodeHome);
    const specs = loadAgentsFromYaml(pancodeHome);
    for (const spec of specs) {
      if (!agentRegistry.has(spec.name)) {
        agentRegistry.register(spec);
      }
    }
    const names = agentRegistry.names();
    return { status: "pass", details: `${names.length} agents: ${names.join(", ")}` };
  });

  // Orchestrator model
  check("bootstrap", "Orchestrator model configured", () => {
    const config = loadConfig();
    if (config.model) {
      return { status: "pass", details: `model=${config.model}` };
    }
    return { status: "warn", details: "PANCODE_MODEL not set" };
  });

  // Provider discovery (async)
  await checkAsync("bootstrap", "Provider discovery", async () => {
    const providers = await discoverEngines();
    if (providers.length === 0) {
      return { status: "warn", details: "no local AI providers found" };
    }
    const totalModels = providers.reduce((sum, p) => sum + p.models.length, 0);
    const summary = providers.map((p) => `${p.providerId}(${p.models.length})`).join(", ");
    return { status: "pass", details: `${providers.length} providers, ${totalModels} models: ${summary}` };
  });
}

// ---------------------------------------------------------------------------
// Phase 3: Command Registration Audit
// ---------------------------------------------------------------------------

function phase3(): void {
  startPhase("Command Registration Audit");

  const domainCommands = extractRegisteredCommands();

  // Expected commands by domain (source of truth from extension.ts files)
  const expectedByDomain: Record<string, string[]> = {
    session: ["session", "checkpoint", "context", "reset"],
    dispatch: ["runs", "batches", "stoprun", "cost", "dispatch-insights"],
    agents: ["agents", "runtimes", "workers", "skills"],
    observability: ["metrics", "audit", "doctor", "receipt"],
    scheduling: ["budget"],
    prompts: ["prompt-debug", "prompt-version", "prompt-workers"],
    ui: [
      "dashboard",
      "status",
      "theme",
      "models",
      "preferences",
      "settings",
      "reasoning",
      "thinking",
      "modes",
      "help",
      "preset",
      "exit",
    ],
  };

  let totalRegistered = 0;
  let totalExpected = 0;
  let missingCommands: string[] = [];
  let extraCommands: string[] = [];

  for (const [domain, expected] of Object.entries(expectedByDomain)) {
    const actual = domainCommands.get(domain) ?? [];
    totalExpected += expected.length;
    totalRegistered += actual.length;

    check("commands", `${domain} domain commands`, () => {
      const missing = expected.filter((cmd) => !actual.includes(cmd));
      const extra = actual.filter((cmd) => !expected.includes(cmd));

      if (missing.length > 0) {
        missingCommands.push(...missing.map((cmd) => `${domain}/${cmd}`));
      }
      if (extra.length > 0) {
        extraCommands.push(...extra.map((cmd) => `${domain}/${cmd}`));
      }

      if (missing.length > 0) {
        return { status: "fail", details: `missing: ${missing.join(", ")}` };
      }
      const details = `${actual.length} commands: ${actual.join(", ")}`;
      if (extra.length > 0) {
        return { status: "pass", details: `${details} (extra: ${extra.join(", ")})` };
      }
      return { status: "pass", details };
    });
  }

  // Domains that should register zero commands
  for (const domain of ["safety", "intelligence"]) {
    const actual = domainCommands.get(domain) ?? [];
    check("commands", `${domain} domain (no commands expected)`, () => {
      if (actual.length > 0) {
        return { status: "warn", details: `unexpected commands: ${actual.join(", ")}` };
      }
      return { status: "pass", details: "0 commands (as expected)" };
    });
  }

  // Summary check
  check("commands", "Total command count", () => {
    const allCommands: string[] = [];
    for (const cmds of domainCommands.values()) {
      allCommands.push(...cmds);
    }
    const unique = new Set(allCommands);
    if (unique.size !== allCommands.length) {
      const dupes = allCommands.filter((cmd, idx) => allCommands.indexOf(cmd) !== idx);
      return { status: "fail", details: `duplicate commands: ${[...new Set(dupes)].join(", ")}` };
    }
    return { status: "pass", details: `${unique.size} unique commands across ${domainCommands.size} domains` };
  });
}

// ---------------------------------------------------------------------------
// Phase 4: Runtime Discovery
// ---------------------------------------------------------------------------

function phase4(): void {
  startPhase("Runtime Discovery");

  check("runtimes", "Runtime registration", () => {
    const discovery = discoverAndRegisterRuntimes();
    return {
      status: "pass",
      details: `registered=${discovery.registered.join(", ")}`,
    };
  });

  check("runtimes", "Available runtimes", () => {
    const discovery = discoverAndRegisterRuntimes();
    if (discovery.available.length === 0) {
      return { status: "warn", details: "no runtimes available on PATH" };
    }
    return { status: "pass", details: discovery.available.join(", ") };
  });

  check("runtimes", "Pi native runtime", () => {
    const pi = runtimeRegistry.get("pi");
    if (!pi) {
      return { status: "fail", details: "Pi native runtime not registered" };
    }
    return { status: "pass", details: `tier=${pi.tier}, available=${pi.isAvailable()}` };
  });

  // Verify each CLI adapter has correct structure
  const cliRuntimes = ["cli:claude-code", "cli:codex", "cli:gemini", "cli:opencode", "cli:cline", "cli:copilot-cli"];
  for (const id of cliRuntimes) {
    check("runtimes", `Adapter ${id}`, () => {
      const rt = runtimeRegistry.get(id);
      if (!rt) {
        return { status: "fail", details: "not registered" };
      }
      const available = rt.isAvailable();
      return {
        status: "pass",
        details: `tier=${rt.tier}, available=${available}`,
      };
    });
  }
}

// ---------------------------------------------------------------------------
// Phase 5: PanPrompt Compilation and Constitution Coverage
// ---------------------------------------------------------------------------

function phase5(): void {
  startPhase("PanPrompt Compilation");

  // Fragment inventory
  check("prompts", "Fragment count", () => {
    if (ALL_FRAGMENTS.length === 0) {
      return { status: "fail", details: "no fragments loaded" };
    }
    const categories = new Set(ALL_FRAGMENTS.map((f) => f.category));
    return {
      status: "pass",
      details: `${ALL_FRAGMENTS.length} fragments across ${categories.size} categories`,
    };
  });

  // Constitution fragment existence
  check("prompts", "Constitution fragments exist", () => {
    const constitutionFragments = ALL_FRAGMENTS.filter((f) => f.category === ("constitution" as FragmentCategory));
    if (constitutionFragments.length === 0) {
      return { status: "fail", details: "no constitution fragments found" };
    }
    return {
      status: "pass",
      details: `${constitutionFragments.length} constitution fragments: ${constitutionFragments.map((f) => f.id).join(", ")}`,
    };
  });

  // Identity fragment existence
  check("prompts", "Identity fragments exist", () => {
    const identityFragments = ALL_FRAGMENTS.filter((f) => f.category === ("identity" as FragmentCategory));
    if (identityFragments.length === 0) {
      return { status: "fail", details: "no identity fragments found" };
    }
    return {
      status: "pass",
      details: `${identityFragments.length} identity fragments`,
    };
  });

  // Compile all role/tier/mode combinations and verify constitution coverage
  const roles: PromptRole[] = ["orchestrator", "worker", "scout"];
  const tiers: ModelTier[] = ["frontier", "mid", "small"];
  const modes: OrchestratorMode[] = ["capture", "plan", "build", "ask", "review"];

  const budgets: Record<PromptRole, number> = {
    orchestrator: 4096,
    worker: 2048,
    scout: 1024,
  };

  let totalCombinations = 0;
  let coveredCombinations = 0;
  const uncoveredList: string[] = [];

  for (const role of roles) {
    for (const tier of tiers) {
      for (const mode of modes) {
        totalCombinations++;

        const context: CompilationContext = {
          role,
          tier,
          mode,
          variables: {
            BUDGET_STATUS: "ok",
            WORKER_TASK: "test task",
          },
          tokenBudget: budgets[role],
        };

        const compiled = compilePrompt(ALL_FRAGMENTS, context);
        const constitutionIds = compiled.includedFragments.filter((id) => {
          const frag = ALL_FRAGMENTS.find((f) => f.id === id);
          return frag?.category === ("constitution" as FragmentCategory);
        });

        if (constitutionIds.length > 0) {
          coveredCombinations++;
        } else {
          uncoveredList.push(`${role}/${tier}/${mode}`);
        }
      }
    }
  }

  check("prompts", "Constitution coverage matrix", () => {
    if (uncoveredList.length > 0) {
      return {
        status: "fail",
        details: `${uncoveredList.length}/${totalCombinations} missing: ${uncoveredList.slice(0, 5).join(", ")}${uncoveredList.length > 5 ? "..." : ""}`,
      };
    }
    return {
      status: "pass",
      details: `${coveredCombinations}/${totalCombinations} combinations covered`,
    };
  });

  // Verify orchestrator identity includes "Panos" or "PanCode"
  check("prompts", "Orchestrator identity mentions PanCode/Panos", () => {
    const orchIdentity = ALL_FRAGMENTS.filter(
      (f) => f.roles.includes("orchestrator") && f.category === ("identity" as FragmentCategory),
    );
    const mentionsPanCode = orchIdentity.some((f) => /pancode/i.test(f.text) || /panos/i.test(f.text));
    if (!mentionsPanCode) {
      return { status: "fail", details: "no orchestrator identity fragment mentions PanCode or Panos" };
    }
    return { status: "pass", details: "" };
  });
}

// ---------------------------------------------------------------------------
// Phase 6: Identity Compliance
// ---------------------------------------------------------------------------

function phase6(): void {
  startPhase("Identity Compliance");

  // Check that identity fragments do not leak Pi branding
  check("identity", "No Pi branding in identity fragments", () => {
    const identityFragments = ALL_FRAGMENTS.filter((f) => f.category === ("identity" as FragmentCategory));
    const piLeaks: string[] = [];

    for (const frag of identityFragments) {
      // Check for "you are Pi" or "Pi agent" or similar, but not "Pi SDK" or "Pi native" (internal refs)
      if (/\byou are Pi\b/i.test(frag.text) || /\bas Pi\b/i.test(frag.text)) {
        piLeaks.push(frag.id);
      }
    }

    if (piLeaks.length > 0) {
      return { status: "fail", details: `Pi branding leaks in: ${piLeaks.join(", ")}` };
    }
    return { status: "pass", details: "no Pi branding in identity fragments" };
  });

  // Check that identity fragments do not leak Claude branding
  check("identity", "No Claude branding in identity fragments", () => {
    const identityFragments = ALL_FRAGMENTS.filter((f) => f.category === ("identity" as FragmentCategory));
    const claudeLeaks: string[] = [];

    for (const frag of identityFragments) {
      if (/\byou are Claude\b/i.test(frag.text) || /\bas Claude\b/i.test(frag.text)) {
        claudeLeaks.push(frag.id);
      }
    }

    if (claudeLeaks.length > 0) {
      return { status: "fail", details: `Claude branding leaks in: ${claudeLeaks.join(", ")}` };
    }
    return { status: "pass", details: "no Claude branding in identity fragments" };
  });

  // Check that constitution fragments enforce PanCode identity
  check("identity", "Constitution enforces PanCode identity", () => {
    const constitutionFragments = ALL_FRAGMENTS.filter(
      (f) => f.category === ("constitution" as FragmentCategory),
    );

    const hasIdentityRule = constitutionFragments.some(
      (f) =>
        /never.*model\s*name/i.test(f.text) ||
        /never.*reveal/i.test(f.text) ||
        /panos/i.test(f.text) ||
        /you are pancode/i.test(f.text) ||
        /you are a pancode/i.test(f.text) ||
        /not the underlying model/i.test(f.text),
    );

    if (!hasIdentityRule) {
      return { status: "warn", details: "no constitution fragment explicitly guards identity" };
    }
    return { status: "pass", details: "identity protection rules found" };
  });

  // Check no Pi/Claude branding in user-facing command descriptions.
  // External tool names ("Claude Code", "Gemini CLI", etc.) are acceptable
  // because they refer to third-party runtimes, not to PanCode's identity.
  check("identity", "No Pi/Claude branding in command descriptions", () => {
    const domainsDir = join(PACKAGE_ROOT, "src", "domains");
    const leaks: string[] = [];

    // Known external tool names that are not identity leaks
    const externalToolPatterns = [
      /claude\s*code/i,
      /codex/i,
      /gemini\s*cli/i,
      /copilot\s*cli/i,
      /github\s*copilot/i,
      /cline\s*cli/i,
      /opencode/i,
    ];

    for (const domain of readdirSync(domainsDir, { withFileTypes: true })) {
      if (!domain.isDirectory()) continue;
      const extPath = join(domainsDir, domain.name, "extension.ts");
      if (!existsSync(extPath)) continue;

      const source = readFileSync(extPath, "utf8");
      // Find description strings in registerCommand calls
      const descPattern = /description:\s*"([^"]+)"/g;
      let match: RegExpExecArray | null = null;
      while ((match = descPattern.exec(source)) !== null) {
        const desc = match[1];
        const isExternalTool = externalToolPatterns.some((p) => p.test(desc));

        if (/\bPi\b/.test(desc) && !/\bPi SDK\b/i.test(desc)) {
          leaks.push(`${domain.name}: "${desc}"`);
        }
        // Only flag "Claude" if it is not an external tool reference
        if (/\bClaude\b/i.test(desc) && !isExternalTool) {
          leaks.push(`${domain.name}: "${desc}"`);
        }
      }
    }

    if (leaks.length > 0) {
      return { status: "fail", details: leaks.join("; ") };
    }
    return { status: "pass", details: "all command descriptions use PanCode branding" };
  });
}

// ---------------------------------------------------------------------------
// Phase 7: Summary and Baseline Report
// ---------------------------------------------------------------------------

function phase7(): void {
  startPhase("Summary");

  const byPhase = new Map<string, CheckResult[]>();
  for (const r of results) {
    const list = byPhase.get(r.phase) ?? [];
    list.push(r);
    byPhase.set(r.phase, list);
  }

  const total = results.length;
  const passed = results.filter((r) => r.status === "pass").length;
  const failed = results.filter((r) => r.status === "fail").length;
  const warned = results.filter((r) => r.status === "warn").length;
  const skipped = results.filter((r) => r.status === "skip").length;

  if (jsonOutput) {
    const report = {
      version: resolveVersion(),
      date: new Date().toISOString().split("T")[0],
      summary: { total, passed, failed, warned, skipped },
      results: results.map((r) => ({
        phase: r.phase,
        name: r.name,
        status: r.status,
        details: r.details,
        elapsed: r.elapsed,
      })),
    };
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  // Per-phase summary
  for (const [phase, checks] of byPhase) {
    const pPass = checks.filter((r) => r.status === "pass").length;
    const pFail = checks.filter((r) => r.status === "fail").length;
    const pWarn = checks.filter((r) => r.status === "warn").length;
    const pSkip = checks.filter((r) => r.status === "skip").length;
    const tag = pFail > 0 ? "FAIL" : pWarn > 0 ? "WARN" : pSkip === checks.length ? "SKIP" : "PASS";
    console.log(`  ${phase.padEnd(14)} ${tag.padEnd(6)} (${pPass} pass, ${pFail} fail, ${pWarn} warn, ${pSkip} skip)`);
  }

  // Failures detail
  const failures = results.filter((r) => r.status === "fail");
  if (failures.length > 0) {
    console.log(`\n  Failures:`);
    for (const f of failures) {
      console.log(`    [${f.phase}] ${f.name}: ${f.details}`);
    }
  }

  // Warnings detail
  const warnings = results.filter((r) => r.status === "warn");
  if (warnings.length > 0) {
    console.log(`\n  Warnings:`);
    for (const w of warnings) {
      console.log(`    [${w.phase}] ${w.name}: ${w.details}`);
    }
  }

  // Baseline report
  const version = resolveVersion();
  const date = new Date().toISOString().split("T")[0];

  const structuralResults = results.filter((r) => r.phase === "structural");
  const structuralStatus = (name: string): string => {
    const r = structuralResults.find((r) => r.name === name);
    if (!r) return "SKIP";
    return r.status === "pass" ? "PASS" : r.status === "skip" ? "SKIP" : "FAIL";
  };

  const domainCount = Object.keys(DOMAIN_REGISTRY).length;
  const enabledCount = filterValidDomains(DEFAULT_ENABLED_DOMAINS, DOMAIN_REGISTRY).length;
  const commandResults = results.filter((r) => r.phase === "commands");
  const commandsPass = commandResults.filter((r) => r.status === "pass").length;
  const commandsTotal = commandResults.length;

  const runtimeResults = results.filter((r) => r.phase === "runtimes");
  const runtimesPass = runtimeResults.filter((r) => r.status === "pass").length;

  const promptResults = results.filter((r) => r.phase === "prompts");
  const promptsPass = promptResults.filter((r) => r.status === "pass").length;

  const identityResults = results.filter((r) => r.phase === "identity");
  const identityPass = identityResults.filter((r) => r.status === "pass").length;
  const identityTotal = identityResults.length;
  const identityStatus = identityPass === identityTotal ? "PASS" : "FAIL";

  console.log(`\n${"=".repeat(70)}`);
  console.log("  Baseline Report");
  console.log(`${"=".repeat(70)}\n`);

  console.log(`  ## Baseline (v${version}, ${date})`);
  console.log(`  `);
  console.log(`  Typecheck: ${structuralStatus("typecheck")}`);
  console.log(`  Boundaries: ${structuralStatus("check-boundaries")}`);
  console.log(`  Build: ${structuralStatus("build")}`);
  console.log(`  Lint: ${structuralStatus("lint")}`);
  console.log(`  Bootstrap: ${failed === 0 ? "PASS" : "FAIL"} (domains: ${enabledCount}/${domainCount})`);
  console.log(`  Commands: ${commandsPass}/${commandsTotal} pass`);
  console.log(`  Identity: ${identityStatus}`);
  console.log(`  Runtimes: ${runtimesPass}/${runtimeResults.length} pass`);
  console.log(`  PanPrompt: ${promptsPass}/${promptResults.length} pass`);
  console.log(`  `);
  console.log(`  Total: ${passed}/${total} pass, ${failed} fail, ${warned} warn, ${skipped} skip`);

  console.log();
}

function resolveVersion(): string {
  try {
    const pkg = JSON.parse(readFileSync(join(PACKAGE_ROOT, "package.json"), "utf8")) as { version?: unknown };
    return typeof pkg.version === "string" ? pkg.version : "0.0.0";
  } catch {
    return "0.0.0";
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  if (!jsonOutput) {
    const version = resolveVersion();
    console.log(`PanCode Baseline Smoke Test (v${version})`);
    console.log("=".repeat(70));
  }

  phase1();
  await phase2();
  phase3();
  phase4();
  phase5();
  phase6();
  phase7();

  const failed = results.filter((r) => r.status === "fail").length;
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("Smoke test crashed:", err);
  process.exit(1);
});
