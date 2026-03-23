/**
 * Cluster simulator runtime.
 *
 * A mock runtime that validates dispatch routing, scheduling, and
 * coordination logic without calling real LLM backends. Workers return
 * synthetic results with configurable latency, token counts, and
 * failure modes.
 *
 * Enable via PANCODE_SIM_ENABLED=1.
 *
 * Configuration env vars:
 *   PANCODE_SIM_LATENCY_MS       Base latency per dispatch (default: 2000)
 *   PANCODE_SIM_FAILURE_RATE     Fraction of dispatches that fail (default: 0)
 *   PANCODE_SIM_RATE_LIMIT_RATE  Fraction that hit rate limits (default: 0)
 *   PANCODE_SIM_TOKEN_RANGE      Random token count range "min-max" (default: 500-2000)
 */

import type { AgentRuntime, RuntimeResult, RuntimeTaskConfig, RuntimeUsage, SpawnConfig } from "./types.js";

function getSimConfig() {
  const latencyMs = Number.parseInt(process.env.PANCODE_SIM_LATENCY_MS ?? "2000", 10) || 2000;
  const failureRate = Number.parseFloat(process.env.PANCODE_SIM_FAILURE_RATE ?? "0") || 0;
  const rateLimitRate = Number.parseFloat(process.env.PANCODE_SIM_RATE_LIMIT_RATE ?? "0") || 0;

  let tokenMin = 500;
  let tokenMax = 2000;
  const rangeStr = process.env.PANCODE_SIM_TOKEN_RANGE?.trim();
  if (rangeStr) {
    const parts = rangeStr.split("-").map(Number);
    if (parts.length === 2 && parts[0] > 0 && parts[1] > parts[0]) {
      tokenMin = parts[0];
      tokenMax = parts[1];
    }
  }

  return { latencyMs, failureRate, rateLimitRate, tokenMin, tokenMax };
}

function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function randomFloat(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

export class SimRuntime implements AgentRuntime {
  readonly id = "sim";
  readonly displayName = "Simulator";
  readonly tier = "native" as const;
  readonly telemetryTier = "platinum" as const;

  getVersion(): string | null {
    return "sim-1.0";
  }

  isAvailable(): boolean {
    return process.env.PANCODE_SIM_ENABLED === "1";
  }

  buildSpawnConfig(config: RuntimeTaskConfig): SpawnConfig {
    const sim = getSimConfig();
    const tokens = randomInt(sim.tokenMin, sim.tokenMax);
    const outTokens = randomInt(100, Math.min(500, tokens));
    const cost = randomFloat(0, 0.05);

    // Determine if this dispatch should simulate a failure
    const roll = Math.random();
    let exitCode = 0;
    let resultText = `Simulated result for: ${config.task.slice(0, 100)}`;

    if (roll < sim.rateLimitRate) {
      exitCode = 1;
      resultText = "";
    } else if (roll < sim.rateLimitRate + sim.failureRate) {
      exitCode = 1;
      resultText = "";
    }

    // Build a node one-liner that outputs NDJSON events after a delay
    const ndjsonEvents = [
      JSON.stringify({
        type: "message_end",
        message: {
          role: "assistant",
          content: [{ type: "text", text: resultText }],
          usage: {
            input: tokens,
            output: outTokens,
            cacheRead: 0,
            cacheWrite: 0,
            cost: { total: cost },
          },
          model: "sim/mock-model",
          stopReason: exitCode === 0 ? "end_turn" : "error",
          ...(exitCode !== 0 ? { errorMessage: "Simulated failure" } : {}),
        },
      }),
    ];

    // Escape for passing as a single JS string
    const eventLines = ndjsonEvents.map((e) => e.replace(/\\/g, "\\\\").replace(/'/g, "\\'")).join("\\n");

    const script = `setTimeout(() => { process.stdout.write('${eventLines}\\n'); process.exit(${exitCode}); }, ${sim.latencyMs})`;

    return {
      command: process.execPath,
      args: ["-e", script],
      env: {},
      cwd: config.cwd,
      outputFormat: "ndjson",
    };
  }

  parseResult(stdout: string, stderr: string, exitCode: number, _resultFile: string | null): RuntimeResult {
    const emptyUsage: RuntimeUsage = {
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      cost: 0,
      turns: 0,
    };

    return {
      exitCode,
      result: stdout,
      error: stderr ? stderr.trim().slice(0, 500) : "",
      usage: emptyUsage,
      model: "sim/mock-model",
      runtime: this.id,
    };
  }
}

export const simRuntime = new SimRuntime();
