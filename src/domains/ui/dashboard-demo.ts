/**
 * Dashboard rendering demo.
 *
 * Run: npx tsx src/domains/ui/dashboard-demo.ts
 *
 * Simulates runtime state shape for visual testing.
 * In production, buildDashboardState() constructs this from live telemetry.
 */

import os from "node:os";
import chalk from "chalk";
import { renderDashboard } from "./dashboard-layout";
import type { DashboardColorizer, DashboardState } from "./dashboard-theme";

// ---------------------------------------------------------------------------
// Chalk-backed colorizer (matches Pi SDK theme.fg() contract)
// ---------------------------------------------------------------------------

const TERMINAL_GREEN = "#22c55e";
const TERMINAL_DIM = "#166534";

const colorizer: DashboardColorizer = {
  accent: (t) => chalk.hex(TERMINAL_GREEN)(t),
  bold: (t) => chalk.bold(t),
  muted: (t) => chalk.hex(TERMINAL_DIM)(t),
  dim: (t) => chalk.dim.hex(TERMINAL_DIM)(t),
  success: (t) => chalk.green(t),
  error: (t) => chalk.red(t),
  warning: (t) => chalk.yellow(t),
  primary: (t) => chalk.hex("#b0fe5b").bold(t),
  bright: (t) => chalk.white(t),
  barFill: (t) => chalk.hex(TERMINAL_GREEN)(t),
  barEmpty: (t) => chalk.hex(TERMINAL_DIM)(t),
  mode: (t) => chalk.hex(TERMINAL_GREEN)(t),
};

// ---------------------------------------------------------------------------
// Simulated runtime state (same shape as buildDashboardState output)
// ---------------------------------------------------------------------------

const state: DashboardState = {
  config: {
    productName: "PanCode",
    version: "0.2.4",
  },

  currentTime: new Date().toLocaleTimeString("en-US", { hour12: false }),

  username: process.env.USER ?? "user",
  hostname: os.hostname(),

  systemStatus: "BUSY",
  activeWorkerCount: 2,
  totalWorkerCount: 3,

  contextPercent: 34,
  contextTokens: 42000,
  contextWindow: 128000,

  totalCost: 0.12,
  budgetCeiling: 5.0,

  totalRuns: 7,
  totalInputTokens: 185000,
  totalOutputTokens: 42000,

  nodes: [
    { name: "mini", modelCount: 8 },
    { name: "dynamo", modelCount: 12 },
    { name: "blade", modelCount: 3 },
  ],
  agentCount: 5,
  runtimeCount: 2,
  totalModels: 23,

  activeMode: "ask",
  activeModel: "dynamo/qwen3-30b-a3b",
  safetyLevel: "auto-edit",
  reasoningLevel: "medium",

  bootComplete: true,

  agents: [
    { name: "panos", status: "ACTIVE" },
    { name: "scout", status: "ACTIVE" },
    { name: "dev", status: "IDLE" },
    { name: "review", status: "IDLE" },
    { name: "ops", status: "IDLE" },
  ],

  tasks: [
    { id: "#a3f8b21", agent: "panos", status: "RUNNING", tokens: 12440 },
    { id: "#b7c2e99", agent: "scout", status: "RUNNING", tokens: 3210 },
    { id: "#e1d4f56", agent: "dev", status: "DONE", tokens: 8900 },
    { id: "#c9a1b33", agent: "panos", status: "DONE", tokens: 15200 },
    { id: "#f2e8d11", agent: "scout", status: "ERROR", tokens: 420 },
  ],

  logs: [
    { time: "14:01:22", message: "Session started. 5 agents registered." },
    { time: "14:01:23", message: "Model resolved: dynamo/qwen3-30b-a3b" },
    { time: "14:02:01", message: "Dispatching task #a3f8b21 to agent panos." },
    { time: "14:02:10", message: "Agent scout started file analysis." },
    { time: "14:02:15", message: "Worker progress: panos 12.4k tokens, T3." },
    { time: "14:02:22", message: "Agent dev completed refactoring task." },
    { time: "14:02:30", message: "ERROR: scout task #f2e8d11 timed out.", highlight: true },
    { time: "14:02:35", message: "Budget: $0.12 / $5.00 (2.4%)" },
  ],
};

// ---------------------------------------------------------------------------
// Render
// ---------------------------------------------------------------------------

const cols = process.stdout.columns || 120;
const rows = process.stdout.rows || 50;

const output = renderDashboard(state, cols, rows, colorizer);

process.stdout.write("\x1b[2J\x1b[H");
for (const line of output) {
  console.log(line);
}
