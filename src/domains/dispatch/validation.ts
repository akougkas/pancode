import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import { isAbsolute, join } from "node:path";

export interface OutputContract {
  expectedFiles?: string[];
  expectedPatterns?: string[];
  validationCommand?: string;
  validationTimeoutMs?: number;
}

export interface ValidationResult {
  valid: boolean;
  checks: ValidationCheck[];
}

export interface ValidationCheck {
  kind: "file_exists" | "pattern_match" | "command";
  target: string;
  passed: boolean;
  detail?: string;
}

export function validateOutput(output: string, cwd: string, contract: OutputContract): ValidationResult {
  const checks: ValidationCheck[] = [];

  // File existence checks
  if (contract.expectedFiles) {
    for (const file of contract.expectedFiles) {
      const fullPath = isAbsolute(file) ? file : join(cwd, file);
      const passed = existsSync(fullPath);
      checks.push({
        kind: "file_exists",
        target: file,
        passed,
        detail: passed ? undefined : `File not found: ${fullPath}`,
      });
    }
  }

  // Pattern matching in output
  if (contract.expectedPatterns) {
    for (const pattern of contract.expectedPatterns) {
      try {
        const regex = new RegExp(pattern);
        const passed = regex.test(output);
        checks.push({
          kind: "pattern_match",
          target: pattern,
          passed,
          detail: passed ? undefined : "Pattern not found in output",
        });
      } catch {
        checks.push({
          kind: "pattern_match",
          target: pattern,
          passed: false,
          detail: `Invalid regex: ${pattern}`,
        });
      }
    }
  }

  // Shell validation command
  if (contract.validationCommand) {
    const timeout = Math.min(contract.validationTimeoutMs ?? 10000, 30000);
    try {
      execSync(contract.validationCommand, { cwd, timeout, stdio: "pipe" });
      checks.push({ kind: "command", target: contract.validationCommand, passed: true });
    } catch (err) {
      checks.push({
        kind: "command",
        target: contract.validationCommand,
        passed: false,
        detail: err instanceof Error ? err.message.slice(0, 200) : "Command failed",
      });
    }
  }

  return {
    valid: checks.every((c) => c.passed),
    checks,
  };
}
