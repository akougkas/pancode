/**
 * Dispatch Diagnostic: Test 2 - Prompt Extraction
 *
 * Compiles orchestrator and worker prompts for all mode/tier combinations
 * and inspects them for dispatch-encouraging language, token sizes, and
 * constitutional fragment presence.
 *
 * Run: npx tsx scripts/diag-prompt.ts
 */

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
import { compilePrompt, estimateTokens } from "../src/domains/prompts/compiler";
import { ALL_FRAGMENTS } from "../src/domains/prompts/fragments";
import {
  compileOrchestratorPrompt,
  getLastOrchestratorCompilation,
} from "../src/domains/prompts/orchestrator-compiler";
import type {
  CompilationContext,
  CompiledPrompt,
  FragmentCategory,
  ModelTier,
  PromptRole,
} from "../src/domains/prompts/types";
import { compileWorkerPrompt } from "../src/domains/prompts/worker-compiler";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const ROLES: PromptRole[] = ["orchestrator", "worker", "scout"];
const TIERS: ModelTier[] = ["frontier", "mid", "small"];
const MODES: OrchestratorMode[] = ["admin", "plan", "build", "review"];

const BUDGETS: Record<PromptRole, number> = {
  orchestrator: 4096,
  worker: 2048,
  scout: 1024,
};

// Patterns that signal over-dispatch behavior
const OVER_DISPATCH_PATTERNS = [
  /prefer\s+parallel/i,
  /always\s+create\s+a\s+task\s+list/i,
  /decompose\s+into\s+tasks/i,
  /always\s+dispatch/i,
  /must\s+dispatch/i,
];

// Constitutional fragment categories that must be present
const CONSTITUTION_CATEGORIES: FragmentCategory[] = ["constitution"];

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
// Main
// ---------------------------------------------------------------------------

function main(): void {
  console.log("=== DIAG: PROMPT EXTRACTION ===");

  // Steps 1-2: Compile orchestrator prompts for all mode/tier combinations
  step("Compile orchestrator prompts for each mode and tier");
  const orchResults: Array<{
    mode: OrchestratorMode;
    tier: ModelTier;
    tokens: number;
    fragmentCount: number;
    text: string;
  }> = [];

  try {
    for (const tier of TIERS) {
      for (const mode of MODES) {
        const context: CompilationContext = {
          role: "orchestrator",
          tier,
          mode,
          variables: { BUDGET_STATUS: "ok" },
          tokenBudget: BUDGETS.orchestrator,
        };

        const compiled = compilePrompt(ALL_FRAGMENTS, context);
        orchResults.push({
          mode,
          tier,
          tokens: compiled.estimatedTokens,
          fragmentCount: compiled.includedFragments.length,
          text: compiled.text,
        });
      }
    }
    pass(`${orchResults.length} combinations compiled`);

    // Print summary table
    console.log("\n  Orchestrator prompt matrix:");
    console.log(`  ${"Tier".padEnd(12)}${"Mode".padEnd(10)}${"Tokens".padEnd(10)}${"Fragments".padEnd(12)}`);
    console.log(`  ${"-".repeat(44)}`);
    for (const r of orchResults) {
      console.log(
        `  ${r.tier.padEnd(12)}${r.mode.padEnd(10)}${String(r.tokens).padEnd(10)}${String(r.fragmentCount).padEnd(12)}`,
      );
    }
  } catch (err) {
    fail(`Orchestrator compilation threw: ${err instanceof Error ? err.message : String(err)}`);
  }

  // Steps 3-4: Compile worker prompts for dev and reviewer
  step("Compile worker prompts for dev and reviewer agents");
  const workerResults: Array<{
    agent: string;
    mode: OrchestratorMode;
    tier: ModelTier;
    tokens: number;
    text: string;
  }> = [];

  try {
    const agents = [
      { name: "dev", readonly: false, tools: "read,bash,grep,find,ls,write,edit" },
      { name: "reviewer", readonly: true, tools: "read,bash,grep,find,ls" },
    ];

    for (const agent of agents) {
      for (const tier of TIERS) {
        for (const mode of MODES) {
          const compiled = compileWorkerPrompt(
            { name: agent.name, systemPrompt: "", readonly: agent.readonly, tools: agent.tools },
            {
              agentName: agent.name,
              task: "diagnostic test task",
              readonly: agent.readonly,
              tools: agent.tools,
              mode,
              tier,
            },
            null,
          );
          const tokens = estimateTokens(compiled);
          workerResults.push({ agent: agent.name, mode, tier, tokens, text: compiled });
        }
      }
    }
    pass(`${workerResults.length} worker combinations compiled`);

    console.log("\n  Worker prompt matrix:");
    console.log(`  ${"Agent".padEnd(12)}${"Tier".padEnd(12)}${"Mode".padEnd(10)}${"Tokens".padEnd(10)}`);
    console.log(`  ${"-".repeat(44)}`);
    for (const r of workerResults) {
      console.log(`  ${r.agent.padEnd(12)}${r.tier.padEnd(12)}${r.mode.padEnd(10)}${String(r.tokens).padEnd(10)}`);
    }
  } catch (err) {
    fail(`Worker compilation threw: ${err instanceof Error ? err.message : String(err)}`);
  }

  // Step 5: Check for language encouraging multiple dispatch calls
  step("Check for language encouraging multiple dispatch calls");
  const overDispatchFindings: string[] = [];

  for (const r of orchResults) {
    for (const pattern of OVER_DISPATCH_PATTERNS) {
      if (pattern.test(r.text)) {
        overDispatchFindings.push(`${r.tier}/${r.mode}: matches "${pattern.source}"`);
      }
    }
  }

  if (overDispatchFindings.length > 0) {
    console.log(`WARN [${overDispatchFindings.length} over-dispatch patterns found]`);
    for (const f of overDispatchFindings) {
      console.log(`  WARNING: ${f}`);
    }
  } else {
    pass("no over-dispatch language found");
  }

  // Step 6: Check for "ALWAYS create a task list" language
  step('Check for "ALWAYS create a task list" language');
  const taskListFindings: string[] = [];

  for (const r of orchResults) {
    if (/always\s+create\s+a\s+task\s+list/i.test(r.text)) {
      taskListFindings.push(`${r.tier}/${r.mode}`);
    }
  }

  if (taskListFindings.length > 0) {
    fail(`Found "ALWAYS create a task list" in: ${taskListFindings.join(", ")}`);
  } else {
    pass("no mandatory task list language found");
  }

  // Step 7: System prompt size analysis
  step("System prompt size vs typical context windows");
  const contextWindows: Record<ModelTier, number> = {
    frontier: 200_000,
    mid: 128_000,
    small: 32_000,
  };

  let sizeIssues = 0;
  for (const r of orchResults) {
    const windowSize = contextWindows[r.tier];
    const ratio = r.tokens / windowSize;
    if (ratio > 0.1) {
      sizeIssues++;
      console.log(
        `\n  WARNING: ${r.tier}/${r.mode} prompt is ${r.tokens} tokens (${(ratio * 100).toFixed(1)}% of ${windowSize} context)`,
      );
    }
  }

  if (sizeIssues > 0) {
    console.log(`WARN [${sizeIssues} prompts exceed 10% of context window]`);
  } else {
    pass("all prompts within 10% of their tier's context window");
  }

  // Step 8: Verify constitutional fragments are present
  step("Verify constitutional fragments present (voice, honesty, scope)");
  let constitutionFailures = 0;

  for (const role of ROLES) {
    for (const tier of TIERS) {
      for (const mode of MODES) {
        const context: CompilationContext = {
          role,
          tier,
          mode,
          variables: { BUDGET_STATUS: "ok", WORKER_TASK: "test" },
          tokenBudget: BUDGETS[role],
        };

        const compiled = compilePrompt(ALL_FRAGMENTS, context);
        const constitutionIds = compiled.includedFragments.filter((id) => {
          const frag = ALL_FRAGMENTS.find((f) => f.id === id);
          return frag?.category === ("constitution" as FragmentCategory);
        });

        if (constitutionIds.length === 0) {
          constitutionFailures++;
          console.log(`\n  MISSING: ${role}/${tier}/${mode} has no constitutional fragments`);
        }
      }
    }
  }

  if (constitutionFailures > 0) {
    fail(`${constitutionFailures} combinations lack constitutional fragments`);
  } else {
    pass(`all ${ROLES.length * TIERS.length * MODES.length} combinations have constitutional coverage`);
  }

  // Step 9: Verify specific constitutional concepts
  step("Verify constitutional concepts: voice, honesty, scope");
  const requiredConcepts = ["voice", "honesty", "scope"];
  let conceptFailures = 0;

  for (const role of ROLES) {
    const tier: ModelTier = "frontier";
    const mode: OrchestratorMode = "build";
    const context: CompilationContext = {
      role,
      tier,
      mode,
      variables: { BUDGET_STATUS: "ok", WORKER_TASK: "test" },
      tokenBudget: BUDGETS[role],
    };

    const compiled = compilePrompt(ALL_FRAGMENTS, context);
    for (const concept of requiredConcepts) {
      const hasFragment = compiled.includedFragments.some((id) => id.includes(concept));
      const hasTextRef = compiled.text.toLowerCase().includes(concept);
      if (!hasFragment && !hasTextRef) {
        conceptFailures++;
        console.log(`\n  MISSING: ${role}/frontier/build lacks "${concept}" concept`);
      }
    }
  }

  if (conceptFailures > 0) {
    fail(`${conceptFailures} constitutional concept(s) missing`);
  } else {
    pass("voice, honesty, and scope present for all roles");
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
