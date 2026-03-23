/**
 * Dispatch Diagnostic: Test 5 - Orchestrator Behavior Analysis
 *
 * Analyzes prompt fragments, tool descriptions, dispatch rules, and admission
 * checks to identify patterns that could cause over-dispatch or misbehavior.
 * Run this after Tests 1-4 pass to isolate orchestrator-level issues.
 *
 * Run: npx tsx scripts/diag-orchestrator.ts
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

// ---------------------------------------------------------------------------
// Environment bootstrap
// ---------------------------------------------------------------------------

const PACKAGE_ROOT = join(import.meta.dirname, "..");
process.env.PANCODE_PACKAGE_ROOT = PACKAGE_ROOT;
process.env.PI_SKIP_VERSION_CHECK = "1";

// ---------------------------------------------------------------------------
// Imports
// ---------------------------------------------------------------------------

import type { OrchestratorMode } from "../src/core/modes";
import { getToolsetForMode } from "../src/core/modes";
import { ToolName } from "../src/core/tool-names";
import { DEFAULT_DISPATCH_RULES, evaluateRules } from "../src/domains/dispatch/rules";
import { ALL_FRAGMENTS } from "../src/domains/prompts/fragments";
import type { Fragment } from "../src/domains/prompts/types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let stepNumber = 0;
let failCount = 0;
let warnCount = 0;

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

function warn(details: string): void {
  warnCount++;
  console.log(`WARN [${details}]`);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main(): void {
  console.log("=== DIAG: ORCHESTRATOR BEHAVIOR ANALYSIS ===");

  // Step 1: Read all prompt fragments and search for dispatch-encouraging language
  step("Search fragments for language encouraging multiple dispatch calls");
  const dispatchPatterns: Array<{ pattern: RegExp; label: string }> = [
    { pattern: /prefer\s+parallel/i, label: "prefer parallel" },
    { pattern: /always\s+create\s+a\s+task\s+list/i, label: "ALWAYS create a task list" },
    { pattern: /decompose\s+into\s+tasks/i, label: "decompose into tasks" },
    { pattern: /always\s+dispatch/i, label: "always dispatch" },
    { pattern: /must\s+dispatch/i, label: "must dispatch" },
    { pattern: /dispatch\s+first/i, label: "dispatch first" },
    { pattern: /never\s+implement\s+yourself/i, label: "never implement yourself" },
    { pattern: /batch.*by\s+default/i, label: "batch by default" },
  ];

  const fragmentFindings: Array<{ fragmentId: string; pattern: string; excerpt: string }> = [];

  for (const fragment of ALL_FRAGMENTS) {
    for (const { pattern, label } of dispatchPatterns) {
      const match = fragment.text.match(pattern);
      if (match) {
        // Extract surrounding context
        const idx = fragment.text.indexOf(match[0]);
        const start = Math.max(0, idx - 30);
        const end = Math.min(fragment.text.length, idx + match[0].length + 30);
        const excerpt = fragment.text.slice(start, end).replace(/\n/g, " ");

        fragmentFindings.push({
          fragmentId: fragment.id,
          pattern: label,
          excerpt: `...${excerpt}...`,
        });
      }
    }
  }

  if (fragmentFindings.length > 0) {
    warn(`${fragmentFindings.length} dispatch-encouraging patterns found`);
    for (const f of fragmentFindings) {
      console.log(`  Fragment: ${f.fragmentId}`);
      console.log(`    Pattern: "${f.pattern}"`);
      console.log(`    Context: ${f.excerpt}`);
    }
  } else {
    pass("no aggressive dispatch language found");
  }

  // Step 2: Read dispatch_agent tool description from extension.ts
  step("Read dispatch_agent tool description from dispatch/extension.ts");
  const extensionPath = join(PACKAGE_ROOT, "src", "domains", "dispatch", "extension.ts");
  if (!existsSync(extensionPath)) {
    fail("dispatch/extension.ts not found");
  } else {
    const content = readFileSync(extensionPath, "utf8");

    // Find tool registrations and their descriptions
    const toolDescriptions: Array<{ name: string; description: string }> = [];

    // Use a simple parser to find registerTool calls with description fields
    const toolNamePattern = /name:\s*ToolName\.(\w+)/g;
    const descPattern = /description:\s*\n?\s*["'`]([\s\S]*?)["'`]/g;

    // Simpler approach: find lines containing tool descriptions
    const lines = content.split("\n");
    let currentTool = "";
    for (let i = 0; i < lines.length; i++) {
      const toolMatch = lines[i].match(/name:\s*ToolName\.(\w+)/);
      if (toolMatch) {
        currentTool = toolMatch[1];
      }
      const descMatch = lines[i].match(/description:\s*$/);
      if (descMatch && currentTool) {
        // Next line(s) have the description
        const nextLine = lines[i + 1]?.trim() ?? "";
        const descText = nextLine.replace(/^["'`]|["'`],?$/g, "");
        toolDescriptions.push({ name: currentTool, description: descText.slice(0, 120) });
      }
      const inlineDescMatch = lines[i].match(/description:\s*["'`]([^"'`]+)["'`]/);
      if (inlineDescMatch && currentTool) {
        toolDescriptions.push({ name: currentTool, description: inlineDescMatch[1].slice(0, 120) });
      }
    }

    if (toolDescriptions.length > 0) {
      pass(`${toolDescriptions.length} tool descriptions extracted`);
      for (const td of toolDescriptions) {
        console.log(`  ${td.name}: ${td.description}`);
      }
    } else {
      // Fallback: just check for the key tool names
      const hasDispatchAgent = content.includes("ToolName.DISPATCH_AGENT");
      const hasBatchDispatch = content.includes("ToolName.BATCH_DISPATCH");
      const hasDispatchChain = content.includes("ToolName.DISPATCH_CHAIN");
      pass(
        `dispatch_agent=${hasDispatchAgent}, batch_dispatch=${hasBatchDispatch}, dispatch_chain=${hasDispatchChain}`,
      );
    }
  }

  // Step 3: Check if batch_dispatch is in the orchestrator's active tool set per mode
  step("Check batch_dispatch availability per orchestrator mode");
  const modes: OrchestratorMode[] = ["admin", "plan", "build", "review"];
  const batchDispatchAvailability: Array<{
    mode: OrchestratorMode;
    hasBatchDispatch: boolean;
    hasDispatchAgent: boolean;
  }> = [];

  for (const mode of modes) {
    const toolset = getToolsetForMode(mode);
    batchDispatchAvailability.push({
      mode,
      hasBatchDispatch: toolset.includes(ToolName.BATCH_DISPATCH),
      hasDispatchAgent: toolset.includes(ToolName.DISPATCH_AGENT),
    });
  }

  let toolGateIssues = 0;
  console.log(
    `\n  ${"Mode".padEnd(12)}${"dispatch_agent".padEnd(18)}${"batch_dispatch".padEnd(18)}${"Full toolset".padEnd(60)}`,
  );
  console.log(`  ${"-".repeat(108)}`);
  for (const entry of batchDispatchAvailability) {
    const toolset = getToolsetForMode(entry.mode);
    console.log(
      `  ${entry.mode.padEnd(12)}${String(entry.hasDispatchAgent).padEnd(18)}${String(entry.hasBatchDispatch).padEnd(18)}${toolset.join(",")}`,
    );

    // Non-dispatch modes should not have dispatch tools
    if (entry.mode === "admin" || entry.mode === "plan") {
      if (entry.hasDispatchAgent || entry.hasBatchDispatch) {
        toolGateIssues++;
        console.log(`  WARNING: ${entry.mode} mode has dispatch tools but should not`);
      }
    }
  }

  if (toolGateIssues > 0) {
    fail(`${toolGateIssues} mode(s) have incorrectly gated dispatch tools`);
  } else {
    pass("dispatch tools correctly gated per mode");
  }

  // Step 4: Check dispatch admission in admission.ts
  step("Check dispatch admission gate (admission.ts)");
  const admissionPath = join(PACKAGE_ROOT, "src", "domains", "dispatch", "admission.ts");
  if (!existsSync(admissionPath)) {
    fail("dispatch/admission.ts not found");
  } else {
    const content = readFileSync(admissionPath, "utf8");

    // Check what pre-flight checks are defined
    const hasRegister = content.includes("registerPreFlightCheck");
    const hasRun = content.includes("runPreFlightChecks");
    const checkNames = content.match(/checks\.set\(["']([^"']+)["']/g) ?? [];

    pass(`register=${hasRegister}, run=${hasRun}`);
    console.log("  Pre-flight check mechanism: Map<name, check function>");
    console.log("  Checks are registered by domain extensions at session_start");

    // Check what safety checks register in the safety domain
    const safetyRegPath = join(PACKAGE_ROOT, "src", "domains", "safety", "preflight.ts");
    if (existsSync(safetyRegPath)) {
      const safetyContent = readFileSync(safetyRegPath, "utf8");
      const safetyChecks = safetyContent.match(/registerPreFlightCheck\(["']([^"']+)["']/g) ?? [];
      if (safetyChecks.length > 0) {
        console.log(`  Safety domain registers ${safetyChecks.length} pre-flight check(s):`);
        for (const check of safetyChecks) {
          const name = check.match(/["']([^"']+)["']/)?.[1] ?? "unknown";
          console.log(`    ${name}`);
        }
      }
    }

    // Also check the dispatch extension for pre-flight registrations
    if (existsSync(extensionPath)) {
      const dispatchContent = readFileSync(extensionPath, "utf8");
      const dispatchChecks = dispatchContent.match(/registerPreFlightCheck\(["']([^"']+)["']/g) ?? [];
      const safetyPFChecks = dispatchContent.match(/registerSafetyPreFlightChecks/g) ?? [];
      console.log(`  Dispatch extension registers safety pre-flight checks: ${safetyPFChecks.length > 0}`);
    }
  }

  // Step 5: Check dispatch rules in rules.ts
  step("Check declarative dispatch rules (rules.ts)");
  try {
    console.log(`\n  ${DEFAULT_DISPATCH_RULES.length} default dispatch rule(s):`);
    for (const rule of DEFAULT_DISPATCH_RULES) {
      console.log(`    Rule: "${rule.name}"`);

      // Test with sample contexts
      const testContexts = [
        { task: "", agent: "dev", cwd: "/tmp" },
        { task: "fix a bug", agent: "dev", cwd: "/tmp" },
        { task: "review code", agent: "reviewer", cwd: "/tmp" },
        { task: "fix a bug", agent: "", cwd: "/tmp" },
      ];

      for (const ctx of testContexts) {
        const result = rule.match(ctx);
        if (result) {
          console.log(
            `      match({task:"${ctx.task.slice(0, 20)}", agent:"${ctx.agent}"}) => ${JSON.stringify(result)}`,
          );
        }
      }
    }

    // Test full rule evaluation
    const evalResult = evaluateRules(DEFAULT_DISPATCH_RULES, { task: "fix a bug", agent: "dev", cwd: "/tmp" });
    console.log(`\n  Full evaluation for "fix a bug" with agent "dev": ${JSON.stringify(evalResult)}`);

    const evalEmpty = evaluateRules(DEFAULT_DISPATCH_RULES, { task: "", agent: "dev", cwd: "/tmp" });
    console.log(`  Full evaluation for empty task: ${JSON.stringify(evalEmpty)}`);

    // Check if rules encourage parallel dispatch
    const rulesContent = readFileSync(join(PACKAGE_ROOT, "src", "domains", "dispatch", "rules.ts"), "utf8");
    const parallelPatterns = rulesContent.match(/parallel|concurrent|batch|multiple/gi) ?? [];

    if (parallelPatterns.length > 0) {
      warn(`rules.ts contains ${parallelPatterns.length} parallel-related terms`);
    } else {
      pass("no parallel-dispatch encouragement in rules");
    }
  } catch (err) {
    fail(`Rule evaluation threw: ${err instanceof Error ? err.message : String(err)}`);
  }

  // Step 6: Analyze concurrency limits
  step("Check concurrency and rate limits");
  if (existsSync(extensionPath)) {
    const content = readFileSync(extensionPath, "utf8");

    // Look for concurrency limits
    const concurrencyPatterns = [/MAX_CONCURRENT/i, /concurrency/i, /max.*workers/i, /MAX_BATCH/i, /MAX_PARALLEL/i];

    const findings: string[] = [];
    const lines = content.split("\n");
    for (let i = 0; i < lines.length; i++) {
      for (const pattern of concurrencyPatterns) {
        if (pattern.test(lines[i])) {
          findings.push(`  L${i + 1}: ${lines[i].trim()}`);
        }
      }
    }

    if (findings.length > 0) {
      pass(`${findings.length} concurrency-related lines found`);
      for (const f of findings) {
        console.log(f);
      }
    } else {
      warn("no explicit concurrency limits found in dispatch extension");
    }
  }

  // Step 7: Propose fixes for any prompt language causing over-dispatch
  step("Summarize dispatch behavior analysis and recommendations");
  const recommendations: string[] = [];

  if (fragmentFindings.length > 0) {
    recommendations.push("Review dispatch-encouraging fragment language. Consider softening absolute directives.");
  }

  // Check if build mode has both batch_dispatch and dispatch_agent
  const buildTools = getToolsetForMode("build");
  if (buildTools.includes(ToolName.BATCH_DISPATCH) && buildTools.includes(ToolName.DISPATCH_AGENT)) {
    // This is expected, just verify the prompt guides appropriate usage
    const buildFragments = ALL_FRAGMENTS.filter(
      (f) =>
        f.category === "dispatch" &&
        (f.modes.length === 0 || f.modes.includes("build")) &&
        (f.roles.length === 0 || f.roles.includes("orchestrator")),
    );
    const hasBatchGuidance = buildFragments.some((f) => f.text.includes("batch_dispatch"));
    if (!hasBatchGuidance) {
      recommendations.push("Build mode has batch_dispatch but no fragment guides its appropriate usage.");
    }
  }

  // Check that non-build modes properly restrict dispatch
  for (const mode of modes) {
    if (mode === "build") continue;
    const tools = getToolsetForMode(mode);
    const modeFragments = ALL_FRAGMENTS.filter(
      (f) =>
        f.category === "mode" &&
        (f.modes.length === 0 || f.modes.includes(mode)) &&
        (f.roles.length === 0 || f.roles.includes("orchestrator")),
    );
    const hasAntiDispatch = modeFragments.some((f) => /ANTI:.*dispatch/i.test(f.text) || /no\s+dispatch/i.test(f.text));
    if (tools.includes(ToolName.DISPATCH_AGENT) && !hasAntiDispatch) {
      recommendations.push(`Mode "${mode}" has dispatch tools but no anti-dispatch guidance in prompts.`);
    }
  }

  if (recommendations.length === 0) {
    pass("no actionable recommendations");
  } else {
    warn(`${recommendations.length} recommendation(s)`);
    for (const rec of recommendations) {
      console.log(`  RECOMMENDATION: ${rec}`);
    }
  }

  // Verdict
  console.log("");
  if (failCount === 0) {
    console.log(`VERDICT: PASS (all steps clean, ${warnCount} warning(s))`);
  } else {
    console.log(`VERDICT: FAIL (${failCount} failure(s), ${warnCount} warning(s))`);
  }
}

main();
