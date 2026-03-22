import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import type { AgentRuntime, RuntimeResult, RuntimeTaskConfig, SpawnConfig } from "./types";

/**
 * Check if a binary exists on PATH.
 * Uses `which` on Unix. Returns true if found.
 */
export function binaryExists(name: string): boolean {
  try {
    execSync(`which ${name}`, { stdio: "ignore", timeout: 2000 });
    return true;
  } catch {
    return false;
  }
}

function resolveCliEntryPath(): string {
  const packageRoot = process.env.PANCODE_PACKAGE_ROOT ?? process.cwd();
  const distPath = join(packageRoot, "dist", "worker", "cli-entry.js");
  if (existsSync(distPath)) return distPath;
  return join(packageRoot, "src", "worker", "cli-entry.ts");
}

/**
 * Base class for CLI agent runtimes.
 * Subclasses override binaryName, buildCliArgs(), and optionally parseResult().
 * Default parseResult() treats stdout as plain text response.
 */
export abstract class CliRuntime implements AgentRuntime {
  abstract readonly id: string;
  abstract readonly displayName: string;
  readonly tier = "cli" as const;

  /** The binary name to look for on PATH (e.g., "claude", "codex") */
  abstract readonly binaryName: string;

  /** Build the CLI-specific arguments for headless invocation */
  abstract buildCliArgs(config: RuntimeTaskConfig): string[];

  protected buildCliSpawnConfig(
    config: RuntimeTaskConfig,
    options?: { env?: Record<string, string>; outputFormat?: SpawnConfig["outputFormat"] },
  ): SpawnConfig {
    const entryPath = resolveCliEntryPath();
    const wrapperArgs = [
      "--binary",
      this.binaryName,
      "--parent-pid",
      String(process.pid),
      "--",
      ...this.buildCliArgs(config),
    ];
    const args = entryPath.endsWith(".ts")
      ? ["--import", "tsx", entryPath, ...wrapperArgs]
      : [entryPath, ...wrapperArgs];

    // Recursion depth guard: increment depth for child subprocess so nested
    // dispatch_agent calls can be blocked at the configured maximum depth.
    // Without this, CLI-dispatched workers could recurse without limit.
    const currentDepth = Number.parseInt(process.env.PANCODE_DISPATCH_DEPTH ?? "0", 10);

    return {
      command: process.execPath,
      args,
      env: {
        PANCODE_DISPATCH_DEPTH: String(currentDepth + 1),
        PANCODE_DISPATCH_MAX_DEPTH: process.env.PANCODE_DISPATCH_MAX_DEPTH ?? "2",
        ...options?.env,
      },
      cwd: config.cwd,
      outputFormat: options?.outputFormat ?? "text",
    };
  }

  isAvailable(): boolean {
    return binaryExists(this.binaryName);
  }

  buildSpawnConfig(config: RuntimeTaskConfig): SpawnConfig {
    return this.buildCliSpawnConfig(config);
  }

  parseResult(stdout: string, stderr: string, exitCode: number, _resultFile: string | null): RuntimeResult {
    // Default: treat stdout as the response, no usage tracking
    const trimmed = stdout.trim();
    return {
      exitCode,
      result: trimmed,
      error: exitCode !== 0 ? stderr.trim() || `Exited with code ${exitCode}` : "",
      usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, cost: 0, turns: 0 },
      model: null,
      runtime: this.id,
    };
  }
}
