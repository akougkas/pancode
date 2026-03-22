import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import type { AgentRuntime, RuntimeResult, RuntimeTaskConfig, SpawnConfig, TelemetryTier } from "./types";

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

  /** Telemetry quality tier. Subclasses override to reflect their reporting capabilities. */
  readonly telemetryTier: TelemetryTier = "silver";

  /** The binary name to look for on PATH (e.g., "claude", "codex") */
  abstract readonly binaryName: string;

  private _versionResolved = false;
  private _cachedVersion: string | null = null;

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

  getVersion(): string | null {
    if (this._versionResolved) return this._cachedVersion;
    this._versionResolved = true;
    try {
      const result = execSync(`${this.binaryName} --version`, {
        timeout: 5000,
        encoding: "utf-8",
        stdio: ["pipe", "pipe", "pipe"],
      });
      const match = result.match(/v?(\d+\.\d+\.\d+)/);
      this._cachedVersion = match ? `v${match[1]}` : result.trim().slice(0, 20);
    } catch {
      this._cachedVersion = null;
    }
    return this._cachedVersion;
  }

  isAvailable(): boolean {
    return binaryExists(this.binaryName);
  }

  buildSpawnConfig(config: RuntimeTaskConfig): SpawnConfig {
    return this.buildCliSpawnConfig(config);
  }

  parseResult(stdout: string, stderr: string, exitCode: number, _resultFile: string | null): RuntimeResult {
    const trimmed = stdout.trim();
    const classified = exitCode !== 0 ? this.classifyCliError(stderr, exitCode) : null;
    return {
      exitCode,
      result: trimmed,
      error: classified?.message ?? "",
      usage: {
        inputTokens: null,
        outputTokens: null,
        cacheReadTokens: null,
        cacheWriteTokens: null,
        cost: null,
        turns: null,
      },
      model: null,
      runtime: this.id,
    };
  }

  protected classifyCliError(stderr: string, exitCode: number): {
    category: "auth" | "binary" | "rate_limit" | "timeout" | "unknown";
    message: string;
  } {
    const lower = stderr.toLowerCase();

    if (exitCode === 127 || lower.includes("command not found") || lower.includes("not found")) {
      return { category: "binary", message: "Binary not found on PATH. Install the CLI tool and retry." };
    }
    if (lower.includes("unauthorized") || lower.includes("authentication") || lower.includes("api key") || lower.includes("login")) {
      return { category: "auth", message: "Authentication failed. Check your API key or run the CLI login command." };
    }
    if (lower.includes("rate limit") || lower.includes("429") || lower.includes("too many requests")) {
      return { category: "rate_limit", message: "Rate limited by the provider. Retry in 30 seconds." };
    }
    if (lower.includes("timeout") || lower.includes("timed out") || exitCode === 124) {
      return { category: "timeout", message: "Timed out. Try increasing timeout via PANCODE_WORKER_TIMEOUT_MS." };
    }

    return { category: "unknown", message: stderr.trim() || `Exited with code ${exitCode}` };
  }
}
