/**
 * Constitution audit script.
 *
 * Compiles all 45 role/tier/mode combinations and verifies that constitutional
 * fragments are present in every compilation. Outputs a coverage matrix and
 * exits non-zero if any combination lacks constitutional coverage.
 *
 * Run via: npm run check-constitution
 */

import type { OrchestratorMode } from "../src/core/modes";
import { compilePrompt } from "../src/domains/prompts/compiler";
import { ALL_FRAGMENTS } from "../src/domains/prompts/fragments";
import type { CompilationContext, FragmentCategory, ModelTier, PromptRole } from "../src/domains/prompts/types";

const ROLES: PromptRole[] = ["orchestrator", "worker", "scout"];
const TIERS: ModelTier[] = ["frontier", "mid", "small"];
const MODES: OrchestratorMode[] = ["capture", "plan", "build", "ask", "review"];

const BUDGETS: Record<PromptRole, number> = {
  orchestrator: 4096,
  worker: 2048,
  scout: 1024,
};

let failures = 0;
let total = 0;

const results: Array<{
  role: PromptRole;
  tier: ModelTier;
  mode: OrchestratorMode;
  hasConstitution: boolean;
  constitutionIds: string[];
  totalFragments: number;
}> = [];

for (const role of ROLES) {
  for (const tier of TIERS) {
    for (const mode of MODES) {
      total++;

      const context: CompilationContext = {
        role,
        tier,
        mode,
        variables: {
          BUDGET_STATUS: "ok",
          WORKER_TASK: "test task",
        },
        tokenBudget: BUDGETS[role],
      };

      const compiled = compilePrompt(ALL_FRAGMENTS, context);

      // Find which included fragments are in the "constitution" category
      const constitutionIds = compiled.includedFragments.filter((id) => {
        const frag = ALL_FRAGMENTS.find((f) => f.id === id);
        return frag?.category === ("constitution" as FragmentCategory);
      });

      const hasConstitution = constitutionIds.length > 0;

      results.push({
        role,
        tier,
        mode,
        hasConstitution,
        constitutionIds,
        totalFragments: compiled.includedFragments.length,
      });

      if (!hasConstitution) {
        failures++;
        console.error(`  FAIL: ${role}/${tier}/${mode} has no constitutional fragments`);
      }
    }
  }
}

// Print coverage matrix
console.log("\nConstitution Coverage Matrix:");
console.log("=".repeat(90));
console.log(
  `${"Role".padEnd(14)}${"Tier".padEnd(12)}${"Mode".padEnd(10)}${"Constitution".padEnd(14)}${"IDs".padEnd(40)}`,
);
console.log("-".repeat(90));

for (const r of results) {
  const status = r.hasConstitution ? "OK" : "MISSING";
  const ids = r.constitutionIds.join(", ") || "(none)";
  console.log(`${r.role.padEnd(14)}${r.tier.padEnd(12)}${r.mode.padEnd(10)}${status.padEnd(14)}${ids}`);
}

console.log("-".repeat(90));
console.log(`Total: ${total} combinations, ${total - failures} covered, ${failures} missing`);

if (failures > 0) {
  console.error(`\nConstitution audit FAILED with ${failures} uncovered combination(s).`);
  process.exit(1);
} else {
  console.log("\nConstitution audit passed. All combinations have constitutional coverage.");
}
