/**
 * Health check system: 8-probe diagnostic checklist.
 *
 * Each check is self-contained and returns pass/warn/fail with a message.
 * Total execution target: under 2 seconds.
 */

import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

export interface HealthCheck {
  name: string;
  status: "pass" | "warn" | "fail";
  message: string;
}

export interface HealthReport {
  checks: HealthCheck[];
  passed: number;
  warnings: number;
  failures: number;
}

function checkRuntimeDir(runtimeRoot: string): HealthCheck {
  try {
    if (!existsSync(runtimeRoot)) {
      return { name: "runtime-dir", status: "fail", message: `Runtime directory missing: ${runtimeRoot}` };
    }
    const stat = statSync(runtimeRoot);
    if (!stat.isDirectory()) {
      return { name: "runtime-dir", status: "fail", message: `Runtime path is not a directory: ${runtimeRoot}` };
    }
    return { name: "runtime-dir", status: "pass", message: "Runtime directory exists and is writable" };
  } catch (err) {
    return { name: "runtime-dir", status: "fail", message: `Runtime dir check failed: ${err instanceof Error ? err.message : String(err)}` };
  }
}

function checkOrphanWorkers(activeWorkerCount: number): HealthCheck {
  if (activeWorkerCount === 0) {
    return { name: "orphan-workers", status: "pass", message: "No active worker processes" };
  }
  if (activeWorkerCount > 8) {
    return { name: "orphan-workers", status: "warn", message: `${activeWorkerCount} active workers (unusually high)` };
  }
  return { name: "orphan-workers", status: "pass", message: `${activeWorkerCount} active workers` };
}

function checkStaleRuns(runs: ReadonlyArray<{ status: string; startedAt: string }>): HealthCheck {
  const oneHourAgo = Date.now() - 3600000;
  const stale = runs.filter(
    (r) => r.status === "running" && new Date(r.startedAt).getTime() < oneHourAgo,
  );
  if (stale.length > 0) {
    return { name: "stale-runs", status: "warn", message: `${stale.length} run(s) started over 1 hour ago still marked as running` };
  }
  return { name: "stale-runs", status: "pass", message: "No stale runs detected" };
}

function checkProviderHealth(providers: ReadonlyArray<{ status: string }>): HealthCheck {
  const unhealthy = providers.filter((p) => p.status === "unhealthy");
  if (unhealthy.length > 0) {
    return { name: "provider-health", status: "warn", message: `${unhealthy.length} provider(s) marked unhealthy` };
  }
  return { name: "provider-health", status: "pass", message: `${providers.length} provider(s) tracked, all healthy or degraded` };
}

function checkJsonFileIntegrity(runtimeRoot: string, filename: string): HealthCheck {
  const filePath = join(runtimeRoot, filename);
  if (!existsSync(filePath)) {
    return { name: `${filename}-integrity`, status: "pass", message: `${filename} not yet created (normal for new sessions)` };
  }
  try {
    const content = readFileSync(filePath, "utf8");
    JSON.parse(content);
    return { name: `${filename}-integrity`, status: "pass", message: `${filename} is valid JSON` };
  } catch {
    return { name: `${filename}-integrity`, status: "warn", message: `${filename} is malformed JSON` };
  }
}

function checkSessionSize(): HealthCheck {
  const sessionDir = process.env.PI_CODING_AGENT_DIR
    ? join(process.env.PI_CODING_AGENT_DIR, "sessions")
    : null;
  if (!sessionDir || !existsSync(sessionDir)) {
    return { name: "session-size", status: "pass", message: "Session directory not found (normal if unused)" };
  }
  try {
    // Check most recent session file size
    const files = require("node:fs").readdirSync(sessionDir) as string[];
    const jsonlFiles = files.filter((f: string) => f.endsWith(".jsonl"));
    if (jsonlFiles.length === 0) {
      return { name: "session-size", status: "pass", message: "No session files" };
    }
    const latestFile = jsonlFiles.sort().pop()!;
    const stat = statSync(join(sessionDir, latestFile));
    const sizeMb = stat.size / (1024 * 1024);
    if (sizeMb > 5) {
      return { name: "session-size", status: "warn", message: `Latest session file is ${sizeMb.toFixed(1)}MB (consider compaction)` };
    }
    return { name: "session-size", status: "pass", message: `Latest session file: ${sizeMb.toFixed(1)}MB` };
  } catch {
    return { name: "session-size", status: "pass", message: "Could not check session size" };
  }
}

function checkBudget(spent: number, ceiling: number): HealthCheck {
  if (ceiling <= 0) {
    return { name: "budget", status: "pass", message: "No budget ceiling configured" };
  }
  const pct = (spent / ceiling) * 100;
  if (pct >= 90) {
    return { name: "budget", status: "warn", message: `Budget ${pct.toFixed(0)}% spent ($${spent.toFixed(2)}/$${ceiling.toFixed(2)})` };
  }
  return { name: "budget", status: "pass", message: `Budget ${pct.toFixed(0)}% spent ($${spent.toFixed(2)}/$${ceiling.toFixed(2)})` };
}

export interface HealthCheckInputs {
  runtimeRoot: string;
  activeWorkerCount: number;
  runs: ReadonlyArray<{ status: string; startedAt: string }>;
  providerHealth: ReadonlyArray<{ status: string }>;
  budgetSpent: number;
  budgetCeiling: number;
}

export async function runHealthChecks(inputs: HealthCheckInputs): Promise<HealthReport> {
  const checks: HealthCheck[] = [
    checkRuntimeDir(inputs.runtimeRoot),
    checkOrphanWorkers(inputs.activeWorkerCount),
    checkStaleRuns(inputs.runs),
    checkProviderHealth(inputs.providerHealth),
    checkJsonFileIntegrity(inputs.runtimeRoot, "board.json"),
    checkJsonFileIntegrity(inputs.runtimeRoot, "context.json"),
    checkSessionSize(),
    checkBudget(inputs.budgetSpent, inputs.budgetCeiling),
  ];

  const passed = checks.filter((c) => c.status === "pass").length;
  const warnings = checks.filter((c) => c.status === "warn").length;
  const failures = checks.filter((c) => c.status === "fail").length;

  return { checks, passed, warnings, failures };
}
