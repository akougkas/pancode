import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

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

export function loadSafetyRules(packageRoot: string): SafetyRules {
  const defaults: SafetyRules = {
    bashPatterns: [],
    zeroAccessPaths: [],
    readOnlyPaths: [],
    noDeletePaths: [],
  };

  const rulesPath = join(packageRoot, ".pancode", "safety-rules.yaml");
  if (!existsSync(rulesPath)) return defaults;

  try {
    // Dynamic import yaml to avoid hard dependency at top level
    const yamlText = readFileSync(rulesPath, "utf8");
    // Use simple YAML parsing (key: value arrays)
    // For v1.0, parse manually. Full YAML parser already available via 'yaml' package.
    const { parse } = require("yaml");
    const doc = parse(yamlText);
    if (!doc || typeof doc !== "object") return defaults;

    if (Array.isArray(doc.bashToolPatterns)) {
      for (const entry of doc.bashToolPatterns) {
        if (typeof entry?.pattern === "string" && typeof entry?.reason === "string") {
          try {
            defaults.bashPatterns.push({ pattern: new RegExp(entry.pattern), reason: entry.reason });
          } catch {
            /* skip invalid regex */
          }
        }
      }
    }

    if (Array.isArray(doc.zeroAccessPaths)) {
      defaults.zeroAccessPaths = doc.zeroAccessPaths.filter((p: unknown) => typeof p === "string");
    }
    if (Array.isArray(doc.readOnlyPaths)) {
      defaults.readOnlyPaths = doc.readOnlyPaths.filter((p: unknown) => typeof p === "string");
    }
    if (Array.isArray(doc.noDeletePaths)) {
      defaults.noDeletePaths = doc.noDeletePaths.filter((p: unknown) => typeof p === "string");
    }
  } catch {
    // Rules file is best-effort. Missing or invalid file is non-fatal.
  }

  return defaults;
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
