import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import YAML from "yaml";

export interface BashPattern {
  pattern: RegExp;
  reason: string;
}

export interface SafetyRules {
  bashPatterns: BashPattern[];
  zeroAccessPaths: string[];
  readOnlyPaths: string[];
  noDeletePaths: string[];
}

/** Candidate file names checked in order. First match wins. */
const RULES_FILENAMES = ["pansafety.yaml", "safety-rules.yaml"];

/**
 * Parse the unified `rules:` format used by safety-rules.yaml.
 * Each entry has { pattern, action, reason, type? }.
 * type defaults to "path". "bash" entries become bash patterns.
 * Path entries with action "deny" are treated as read-only path restrictions.
 * Path entries with action "no-access" are treated as zero-access restrictions.
 */
function parseUnifiedRules(
  // biome-ignore lint/suspicious/noExplicitAny: YAML doc is untyped
  doc: any,
  rules: SafetyRules,
): void {
  if (!Array.isArray(doc.rules)) return;
  for (const entry of doc.rules) {
    if (typeof entry?.pattern !== "string" || typeof entry?.reason !== "string") continue;
    const ruleType: string = entry.type ?? "path";
    const action: string = entry.action ?? "deny";

    if (ruleType === "bash") {
      try {
        rules.bashPatterns.push({ pattern: new RegExp(entry.pattern), reason: entry.reason });
      } catch {
        /* skip invalid regex */
      }
      continue;
    }

    // Default: path rule
    if (action === "no-access") {
      rules.zeroAccessPaths.push(entry.pattern);
    } else if (action === "no-delete") {
      rules.noDeletePaths.push(entry.pattern);
    } else {
      // "deny" and any other action value block writes (read-only)
      rules.readOnlyPaths.push(entry.pattern);
    }
  }
}

/**
 * Parse the legacy format used by pansafety.yaml.
 * Top-level keys: bashToolPatterns, zeroAccessPaths, readOnlyPaths, noDeletePaths.
 */
function parseLegacyRules(
  // biome-ignore lint/suspicious/noExplicitAny: YAML doc is untyped
  doc: any,
  rules: SafetyRules,
): void {
  if (Array.isArray(doc.bashToolPatterns)) {
    for (const entry of doc.bashToolPatterns) {
      if (typeof entry?.pattern === "string" && typeof entry?.reason === "string") {
        try {
          rules.bashPatterns.push({ pattern: new RegExp(entry.pattern), reason: entry.reason });
        } catch {
          /* skip invalid regex */
        }
      }
    }
  }
  if (Array.isArray(doc.zeroAccessPaths)) {
    rules.zeroAccessPaths = doc.zeroAccessPaths.filter((p: unknown) => typeof p === "string");
  }
  if (Array.isArray(doc.readOnlyPaths)) {
    rules.readOnlyPaths = doc.readOnlyPaths.filter((p: unknown) => typeof p === "string");
  }
  if (Array.isArray(doc.noDeletePaths)) {
    rules.noDeletePaths = doc.noDeletePaths.filter((p: unknown) => typeof p === "string");
  }
}

export function loadSafetyRules(packageRoot: string): SafetyRules {
  const rules: SafetyRules = {
    bashPatterns: [],
    zeroAccessPaths: [],
    readOnlyPaths: [],
    noDeletePaths: [],
  };

  // Check candidate file names in order. First existing file wins.
  let rulesPath: string | null = null;
  for (const filename of RULES_FILENAMES) {
    const candidate = join(packageRoot, ".pancode", filename);
    if (existsSync(candidate)) {
      rulesPath = candidate;
      break;
    }
  }
  if (!rulesPath) return rules;

  try {
    const yamlText = readFileSync(rulesPath, "utf8");
    const trimmed = yamlText.trim();
    if (!trimmed) return rules;
    const doc = YAML.parse(trimmed);
    if (!doc || typeof doc !== "object") return rules;

    // Detect format: unified `rules:` array vs legacy top-level keys
    if (Array.isArray(doc.rules)) {
      parseUnifiedRules(doc, rules);
    } else {
      parseLegacyRules(doc, rules);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(
      `[pancode:safety] Failed to parse safety rules ${rulesPath}: ${message}. Using empty rule set.\n`,
    );
  }

  return rules;
}

export function matchesGlob(path: string, pattern: string): boolean {
  // Simple glob matching: * matches any segment, ** matches any depth
  const regexStr = pattern
    .replace(/\./g, "\\.")
    .replace(/\*\*/g, "##DOUBLESTAR##")
    .replace(/\*/g, "[^/]*")
    .replace(/##DOUBLESTAR##/g, ".*");
  return new RegExp(`^${regexStr}$`).test(path);
}

export function checkBashCommand(command: string, rules: SafetyRules): { blocked: boolean; reason?: string } {
  for (const { pattern, reason } of rules.bashPatterns) {
    if (pattern.test(command)) return { blocked: true, reason };
  }
  return { blocked: false };
}

export function checkPathAccess(
  filePath: string,
  action: "read" | "write" | "delete",
  rules: SafetyRules,
): { blocked: boolean; reason?: string } {
  const expandedPath = filePath.replace(/^~/, process.env.HOME ?? "");

  for (const pattern of rules.zeroAccessPaths) {
    if (matchesGlob(expandedPath, pattern.replace(/^~/, process.env.HOME ?? ""))) {
      return { blocked: true, reason: `Zero-access path: ${pattern}` };
    }
  }

  if (action === "write" || action === "delete") {
    for (const pattern of rules.readOnlyPaths) {
      if (matchesGlob(expandedPath, pattern.replace(/^~/, process.env.HOME ?? ""))) {
        return { blocked: true, reason: `Read-only path: ${pattern}` };
      }
    }
  }

  if (action === "delete") {
    for (const pattern of rules.noDeletePaths) {
      if (matchesGlob(expandedPath, pattern.replace(/^~/, process.env.HOME ?? ""))) {
        return { blocked: true, reason: `No-delete path: ${pattern}` };
      }
    }
  }

  return { blocked: false };
}
