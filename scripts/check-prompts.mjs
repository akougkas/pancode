/**
 * PanPrompt integrity check.
 * Validates prompt fragments at build time to catch budget overruns,
 * missing coverage, duplicate IDs, and unknown template variables.
 *
 * Integrated into: npm run typecheck (after check-boundaries)
 * Exit code 1 on any violation.
 */

import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

const projectRoot = process.cwd();

// ---------------------------------------------------------------------------
// Load fragment data by parsing the compiled output
// ---------------------------------------------------------------------------

// We need to read the TypeScript source and extract fragment metadata.
// Since we cannot import TS directly, we parse the fragments.ts file for
// fragment constant objects. This is intentionally simple and fragile-free:
// it reads the ALL_FRAGMENTS array from the barrel export.
//
// Strategy: read the compiled JS output after tsc runs (dist/), or parse
// the TS source with regex. We use the TS source for reliability since
// dist/ may not exist during CI.

const fragmentsPath = path.join(projectRoot, "src", "domains", "prompts", "fragments.ts");
const fragmentsSource = readFileSync(fragmentsPath, "utf8");

// Extract fragment objects from source using regex.
// Each fragment is a const declaration with known fields.
const fragmentPattern =
  /(?:export\s+)?const\s+(\w+)\s*:\s*Fragment\s*=\s*\{([\s\S]*?)\};\s*$/gm;

function parseField(block, field) {
  const patterns = [
    new RegExp(`${field}\\s*:\\s*"([^"]*)"`, "m"),
    new RegExp(`${field}\\s*:\\s*(\\d+)`, "m"),
    new RegExp(`${field}\\s*:\\s*\\[([^\\]]*?)\\]`, "m"),
  ];
  for (const p of patterns) {
    const m = block.match(p);
    if (m) return m[1];
  }
  return null;
}

function parseArrayField(block, field) {
  const m = block.match(new RegExp(`${field}\\s*:\\s*\\[([^\\]]*)\\]`, "m"));
  if (!m) return [];
  return m[1]
    .split(",")
    .map((s) => s.trim().replace(/^["']|["']$/g, ""))
    .filter(Boolean);
}

const fragments = [];
let match;
while ((match = fragmentPattern.exec(fragmentsSource)) !== null) {
  const name = match[1];
  const block = match[2];
  const id = parseField(block, "id");
  const estimatedTokens = parseInt(parseField(block, "estimatedTokens") || "0", 10);
  const roles = parseArrayField(block, "roles");
  const tiers = parseArrayField(block, "tiers");
  const modes = parseArrayField(block, "modes");
  const category = parseField(block, "category");

  // Extract text to find template variables
  const textMatch = block.match(/text\s*:\s*(?:\[[\s\S]*?\]\.join\([^)]*\)|`[\s\S]*?`|"[^"]*")/m);
  const textContent = textMatch ? textMatch[0] : "";
  const templateVars = [...textContent.matchAll(/\$\{(\w+)\}/g)].map((m) => m[1]);

  const runtimes = parseArrayField(block, "runtimes");

  if (id) {
    fragments.push({ name, id, estimatedTokens, roles, tiers, modes, runtimes, category, templateVars });
  }
}

// ---------------------------------------------------------------------------
// Validation checks
// ---------------------------------------------------------------------------

let violations = 0;

function fail(message) {
  console.error(`  FAIL: ${message}`);
  violations++;
}

function info(message) {
  console.error(`  INFO: ${message}`);
}

console.error("PanPrompt integrity check...");

// 1. No duplicate fragment IDs
const idSet = new Set();
for (const f of fragments) {
  if (idSet.has(f.id)) {
    fail(`Duplicate fragment ID: ${f.id}`);
  }
  idSet.add(f.id);
}

// 2. Token budget compliance per role/tier
const BUDGETS = {
  orchestrator: 4096,
  worker: 2048,
  scout: 1024,
};

const ALL_TIERS = ["frontier", "mid", "small"];
const ALL_MODES = ["admin", "plan", "build", "review"];

for (const [role, budget] of Object.entries(BUDGETS)) {
  for (const tier of ALL_TIERS) {
    for (const mode of ALL_MODES) {
      const matching = fragments.filter((f) => {
        if (f.roles.length > 0 && !f.roles.includes(role)) return false;
        if (f.tiers.length > 0 && !f.tiers.includes(tier)) return false;
        if (f.modes.length > 0 && !f.modes.includes(mode)) return false;
        // Runtime-specific fragments only activate for their runtime; exclude from general check
        if (f.runtimes && f.runtimes.length > 0) return false;
        return true;
      });
      const total = matching.reduce((sum, f) => sum + f.estimatedTokens, 0);
      if (total > budget) {
        fail(
          `Token budget exceeded: ${role}/${tier}/${mode} = ${total} tokens (budget: ${budget})`,
        );
      }
    }
  }
}

// 3. Mode coverage: every orchestrator mode has at least identity + mode fragments
for (const mode of ALL_MODES) {
  for (const tier of ALL_TIERS) {
    const identityFrags = fragments.filter(
      (f) =>
        f.category === "identity" &&
        (f.roles.length === 0 || f.roles.includes("orchestrator")) &&
        (f.tiers.length === 0 || f.tiers.includes(tier)) &&
        (f.modes.length === 0 || f.modes.includes(mode)),
    );
    if (identityFrags.length === 0) {
      fail(`Missing orchestrator identity fragment for tier=${tier}, mode=${mode}`);
    }

    const modeFrags = fragments.filter(
      (f) =>
        f.category === "mode" &&
        (f.roles.length === 0 || f.roles.includes("orchestrator")) &&
        (f.tiers.length === 0 || f.tiers.includes(tier)) &&
        (f.modes.length === 0 || f.modes.includes(mode)),
    );
    if (modeFrags.length === 0) {
      fail(`Missing orchestrator mode fragment for tier=${tier}, mode=${mode}`);
    }
  }
}

// 4. Known template variables
const KNOWN_VARS = new Set(["BUDGET_STATUS", "WORKER_TASK"]);
for (const f of fragments) {
  for (const v of f.templateVars) {
    if (!KNOWN_VARS.has(v)) {
      fail(`Unknown template variable \${${v}} in fragment ${f.id}`);
    }
  }
}

// 5. Fragment count sanity
info(`${fragments.length} fragments parsed from fragments.ts`);
if (fragments.length < 10) {
  fail(`Too few fragments parsed (${fragments.length}). Expected at least 10.`);
}

// ---------------------------------------------------------------------------
// Result
// ---------------------------------------------------------------------------

if (violations > 0) {
  console.error(`\nPrompt integrity check FAILED with ${violations} violation(s).`);
  process.exit(1);
} else {
  console.error("Prompt integrity check passed.");
}
