/**
 * Dashboard theme: interfaces, constants, and the ASCII logo.
 *
 * Extends the dispatch board's BoardColorizer with dashboard-specific
 * color slots. Pure data and types only; no Pi SDK imports.
 */

import type { BoardColorizer } from "./dispatch-board";

// ---------------------------------------------------------------------------
// Theme interface
// ---------------------------------------------------------------------------

/**
 * Dashboard colorizer adds terminal-chrome and status-badge colors
 * on top of the base BoardColorizer palette.
 */
export interface DashboardColorizer extends BoardColorizer {
  /** Bright primary color for headings and active elements. */
  primary(text: string): string;
  /** White or near-white for highlighted status values. */
  bright(text: string): string;
  /** Filled block characters in progress bars. */
  barFill(text: string): string;
  /** Empty block characters in progress bars. */
  barEmpty(text: string): string;
}

/** Passthrough colorizer for tests and plain output. */
export const PLAIN_DASHBOARD: DashboardColorizer = {
  accent: (t) => t,
  bold: (t) => t,
  muted: (t) => t,
  dim: (t) => t,
  success: (t) => t,
  error: (t) => t,
  warning: (t) => t,
  primary: (t) => t,
  bright: (t) => t,
  barFill: (t) => t,
  barEmpty: (t) => t,
};

// ---------------------------------------------------------------------------
// Box-drawing character sets
// ---------------------------------------------------------------------------

/** Single-line border characters. */
export const BOX = {
  tl: "\u250C", // ┌
  tr: "\u2510", // ┐
  bl: "\u2514", // └
  br: "\u2518", // ┘
  h: "\u2500", // ─
  v: "\u2502", // │
} as const;

/** Block characters for progress bars and charts. */
export const BLOCK = {
  full: "\u2588", // █
  medium: "\u2592", // ▒
  light: "\u2591", // ░
} as const;

// ---------------------------------------------------------------------------
// Status mapping
// ---------------------------------------------------------------------------

export type AgentStatus = "ACTIVE" | "IDLE" | "ERROR" | "BUSY" | "SYNC";

export function colorizeStatus(status: AgentStatus, c: DashboardColorizer): string {
  switch (status) {
    case "ACTIVE":
      return c.bright(status);
    case "IDLE":
      return c.dim(status);
    case "ERROR":
      return c.error(status);
    case "BUSY":
      return c.warning(status);
    case "SYNC":
      return c.accent(status);
    default:
      return c.dim(status);
  }
}

// ---------------------------------------------------------------------------
// Data interfaces — backed by real PanCode runtime telemetry
// ---------------------------------------------------------------------------

export interface DashboardConfig {
  productName: string; // "PanCode"
  version: string; // from process.env.npm_package_version
}

export interface AgentEntry {
  name: string;
  status: AgentStatus;
}

export interface TaskEntry {
  id: string;
  agent: string;
  status: string;
  tokens: number;
}

export interface LogEntry {
  time: string;
  message: string;
  highlight?: boolean;
}

export interface NodeInfo {
  name: string;
  modelCount: number;
}

/**
 * Dashboard state populated from real runtime data.
 *
 * Every field maps to an actual PanCode telemetry source:
 *   - getLiveWorkers(), agentRegistry, getRunLedger()
 *   - getContextPercent/Tokens/Window()
 *   - getBudgetTracker(), getMetricsLedger()
 *   - getModelProfileCache(), runtimeRegistry
 *   - getCurrentMode(), currentModelLabel
 */
export interface DashboardState {
  config: DashboardConfig;

  // Clock (real time)
  currentTime: string;

  // User/host
  username: string;
  hostname: string;

  // System status (derived from worker health)
  systemStatus: "OPERATIONAL" | "BUSY" | "ERROR";
  activeWorkerCount: number;
  totalWorkerCount: number;

  // Context window (from context-tracker.ts)
  contextPercent: number;
  contextTokens: number;
  contextWindow: number;

  // Budget (from scheduling/budget-tracker)
  totalCost: number;
  budgetCeiling: number | null;

  // Session throughput (from observability/metrics-ledger)
  totalRuns: number;
  totalInputTokens: number;
  totalOutputTokens: number;

  // Infrastructure (from model profiles and registries)
  nodes: NodeInfo[];
  agentCount: number;
  runtimeCount: number;
  totalModels: number;

  // Mode (from core/modes)
  activeMode: string;
  activeModel: string;
  safetyLevel: string;
  reasoningLevel: string;

  // Dynamic data
  agents: AgentEntry[];
  tasks: TaskEntry[];
  logs: LogEntry[];
}

// ---------------------------------------------------------------------------
// ASCII logo
// ---------------------------------------------------------------------------

/**
 * PANCODE ASCII art rendered in block characters.
 * 6 lines tall, ~59 columns wide.
 */
export const PANCODE_LOGO: string[] = [
  "\u2588\u2588\u2588\u2588\u2588\u2588\u2557  \u2588\u2588\u2588\u2588\u2588\u2557 \u2588\u2588\u2588\u2557   \u2588\u2588\u2557 \u2588\u2588\u2588\u2588\u2588\u2588\u2557 \u2588\u2588\u2588\u2588\u2588\u2588\u2557 \u2588\u2588\u2588\u2588\u2588\u2588\u2557 \u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2557",
  "\u2588\u2588\u2554\u2550\u2550\u2588\u2588\u2557\u2588\u2588\u2554\u2550\u2550\u2588\u2588\u2557\u2588\u2588\u2588\u2588\u2557  \u2588\u2588\u2551\u2588\u2588\u2554\u2550\u2550\u2550\u2550\u255D\u2588\u2588\u2554\u2550\u2550\u2550\u2588\u2588\u2557\u2588\u2588\u2554\u2550\u2550\u2588\u2588\u2557\u2588\u2588\u2554\u2550\u2550\u2550\u2550\u255D",
  "\u2588\u2588\u2588\u2588\u2588\u2588\u2554\u255D\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2551\u2588\u2588\u2554\u2588\u2588\u2557 \u2588\u2588\u2551\u2588\u2588\u2551     \u2588\u2588\u2551   \u2588\u2588\u2551\u2588\u2588\u2551  \u2588\u2588\u2551\u2588\u2588\u2588\u2588\u2588\u2557",
  "\u2588\u2588\u2554\u2550\u2550\u2550\u255D \u2588\u2588\u2554\u2550\u2550\u2588\u2588\u2551\u2588\u2588\u2551\u255A\u2588\u2588\u2557\u2588\u2588\u2551\u2588\u2588\u2551     \u2588\u2588\u2551   \u2588\u2588\u2551\u2588\u2588\u2551  \u2588\u2588\u2551\u2588\u2588\u2554\u2550\u2550\u255D",
  "\u2588\u2588\u2551     \u2588\u2588\u2551  \u2588\u2588\u2551\u2588\u2588\u2551 \u255A\u2588\u2588\u2588\u2588\u2551\u255A\u2588\u2588\u2588\u2588\u2588\u2588\u2557\u255A\u2588\u2588\u2588\u2588\u2588\u2588\u2554\u255D\u2588\u2588\u2588\u2588\u2588\u2588\u2554\u255D\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2557",
  "\u255A\u2550\u255D     \u255A\u2550\u255D  \u255A\u2550\u255D\u255A\u2550\u255D  \u255A\u2550\u2550\u2550\u255D \u255A\u2550\u2550\u2550\u2550\u2550\u255D \u255A\u2550\u2550\u2550\u2550\u2550\u255D \u255A\u2550\u2550\u2550\u2550\u2550\u255D\u255A\u2550\u2550\u2550\u2550\u2550\u2550\u255D",
];

export const LOGO_WIDTH = 59;
