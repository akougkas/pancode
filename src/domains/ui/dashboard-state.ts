/**
 * Dashboard state builder and incremental state manager.
 *
 * Constructs a DashboardState from live PanCode runtime telemetry.
 * Every field is sourced from a real data API. Nothing is fabricated.
 *
 * DashboardStateManager wraps the builder with staleness tracking so that
 * slow-changing fields (nodes, models, agents, runtimes, budget, run metrics)
 * recompute only when a bus event marks the corresponding group stale. Fast
 * fields (time, context, workers, tasks, systemStatus) recompute every render.
 *
 * Imported by extension.ts to power the dashboard widget's render loop.
 */

import { readFileSync } from "node:fs";
import os from "node:os";
import { join } from "node:path";
import { DEFAULT_SAFETY } from "../../core/defaults";
import { getModeDefinition } from "../../core/modes";
import { PANCODE_PRODUCT_NAME } from "../../core/shell-metadata";
import type { AgentSpec } from "../agents";
import type { RunEnvelope } from "../dispatch";
import type { MergedModelProfile } from "../providers";
import type {
  AgentEntry,
  AgentStatus,
  DashboardConfig,
  DashboardState,
  LogEntry,
  NodeInfo,
  TaskEntry,
} from "./dashboard-theme";
import type { LiveWorkerState } from "./worker-widgets";

// ---------------------------------------------------------------------------
// Config (stable across renders)
// ---------------------------------------------------------------------------

let _cachedVersion: string | null = null;
function readPackageVersion(): string {
  if (_cachedVersion) return _cachedVersion;
  try {
    const root = process.env.PANCODE_PACKAGE_ROOT ?? process.cwd();
    const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as { version?: unknown };
    _cachedVersion = typeof pkg.version === "string" ? pkg.version : "dev";
  } catch {
    _cachedVersion = "dev";
  }
  return _cachedVersion;
}

export function buildDashboardConfig(): DashboardConfig {
  return {
    productName: PANCODE_PRODUCT_NAME,
    version: process.env.npm_package_version ?? readPackageVersion(),
  };
}

// ---------------------------------------------------------------------------
// Worker status → AgentStatus mapping
// ---------------------------------------------------------------------------

function mapWorkerStatus(status: string): AgentStatus {
  switch (status) {
    case "running":
      return "ACTIVE";
    case "pending":
      return "BUSY";
    case "error":
    case "timeout":
      return "ERROR";
    default:
      return "IDLE";
  }
}

// ---------------------------------------------------------------------------
// State builder
// ---------------------------------------------------------------------------

/**
 * Build a DashboardState snapshot from live runtime data.
 *
 * All parameters come from real PanCode APIs:
 *   - liveWorkers: getLiveWorkers()
 *   - allRuns: getRunLedger().getAll()
 *   - agentSpecs: agentRegistry.getAll()
 *   - modelProfiles: getModelProfileCache()
 *   - contextPercent/Tokens/Window: from context-tracker
 *   - totalCost/budgetCeiling: from getBudgetTracker()
 *   - totalInput/OutputTokens: from getMetricsLedger()
 *   - currentModelLabel: from extension state
 *   - reasoningLevel: from pi.getThinkingLevel()
 *   - runtimeCount: from runtimeRegistry.available().length
 */
export function buildDashboardState(params: {
  config: DashboardConfig;
  liveWorkers: LiveWorkerState[];
  allRuns: RunEnvelope[];
  agentSpecs: AgentSpec[];
  modelProfiles: MergedModelProfile[];
  contextPercent: number;
  contextTokens: number;
  contextWindow: number;
  totalCost: number;
  budgetCeiling: number | null;
  totalRuns: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  currentModelLabel: string;
  reasoningLevel: string;
  runtimeCount: number;
  recentLogs: LogEntry[];
}): DashboardState {
  const now = new Date();
  const {
    config,
    liveWorkers,
    allRuns,
    agentSpecs,
    modelProfiles,
    currentModelLabel,
    reasoningLevel,
    runtimeCount,
    recentLogs,
  } = params;

  // Derive system status from worker health
  const runningWorkers = liveWorkers.filter((w) => w.status === "running");
  const errorWorkers = liveWorkers.filter((w) => w.status === "error" || w.status === "timeout");
  let systemStatus: DashboardState["systemStatus"] = "OPERATIONAL";
  if (errorWorkers.length > 0) systemStatus = "ERROR";
  else if (runningWorkers.length > 0) systemStatus = "BUSY";

  // Build agent list: merge registered agents with live worker statuses
  const agentMap = new Map<string, AgentStatus>();
  for (const spec of agentSpecs) {
    agentMap.set(spec.name, "IDLE");
  }
  for (const worker of liveWorkers) {
    agentMap.set(worker.agent, mapWorkerStatus(worker.status));
  }
  const agents: AgentEntry[] = [...agentMap.entries()].map(([name, status]) => ({ name, status }));

  // Build task list from live workers + recent completed runs
  const tasks: TaskEntry[] = [];
  for (const w of liveWorkers) {
    const totalTok = w.inputTokens + w.outputTokens;
    tasks.push({
      id: w.runId.length > 8 ? `#${w.runId.slice(0, 7)}` : `#${w.runId}`,
      agent: w.agent,
      status: w.status === "running" ? "RUNNING" : w.status.toUpperCase(),
      tokens: totalTok,
    });
  }
  // Add recent completed runs (last 5)
  const recentRuns = allRuns.filter((r) => r.status !== "running" && r.status !== "pending").slice(-5);
  for (const r of recentRuns) {
    tasks.push({
      id: r.id.length > 8 ? `#${r.id.slice(0, 7)}` : `#${r.id}`,
      agent: r.agent,
      status: r.status.toUpperCase(),
      tokens: (r.usage.inputTokens ?? 0) + (r.usage.outputTokens ?? 0),
    });
  }

  // Build node info from model profiles, excluding non-chat models
  // (embeddings, rerankers, TTS, speech-to-text).
  const chatProfiles = modelProfiles.filter((p) => {
    const id = p.modelId.toLowerCase();
    if (id.startsWith("text-embedding-")) return false;
    if (id.includes("embed") || id.includes("tts") || id.includes("whisper")) return false;
    if (id.includes("reranker")) return false;
    if (/(?:^|[\/-])bge-/.test(id)) return false;
    return true;
  });
  const nodeMap = new Map<string, number>();
  for (const p of chatProfiles) {
    const node = p.providerId.split("-")[0] || p.providerId;
    nodeMap.set(node, (nodeMap.get(node) ?? 0) + 1);
  }
  const nodes: NodeInfo[] = [...nodeMap.entries()].map(([name, modelCount]) => ({ name, modelCount }));

  const modeInfo = getModeDefinition();
  const safety = process.env.PANCODE_SAFETY ?? DEFAULT_SAFETY;

  return {
    config,

    currentTime: now.toLocaleTimeString("en-US", { hour12: false }),

    username: process.env.USER ?? process.env.USERNAME ?? "user",
    hostname: os.hostname(),

    systemStatus,
    activeWorkerCount: runningWorkers.length,
    totalWorkerCount: liveWorkers.length,

    contextPercent: params.contextPercent,
    contextTokens: params.contextTokens,
    contextWindow: params.contextWindow,

    totalCost: params.totalCost,
    budgetCeiling: params.budgetCeiling,

    totalRuns: params.totalRuns,
    totalInputTokens: params.totalInputTokens,
    totalOutputTokens: params.totalOutputTokens,

    nodes,
    agentCount: agentSpecs.length,
    runtimeCount,
    totalModels: chatProfiles.length,

    activeMode: modeInfo.name,
    activeModel: currentModelLabel,
    safetyLevel: safety,
    reasoningLevel,

    bootComplete: true,

    agents,
    tasks,
    logs: recentLogs,
  };
}

// ---------------------------------------------------------------------------
// Staleness groups
// ---------------------------------------------------------------------------

/** Groups of dashboard fields that share staleness tracking. */
export type StaleGroup = "runs" | "budget" | "infrastructure";

// ---------------------------------------------------------------------------
// State manager interfaces
// ---------------------------------------------------------------------------

/** Provider functions for slow-changing data sources. */
export interface DashboardDataProviders {
  getAgentSpecs: () => AgentSpec[];
  getModelProfiles: () => MergedModelProfile[];
  getRuntimeCount: () => number;
  getAllRuns: () => RunEnvelope[];
  getTotalCost: () => number;
  getBudgetCeiling: () => number | null;
  getMetricsSummary: () => { totalInputTokens: number; totalOutputTokens: number };
}

/** Fast-changing parameters provided on every render call. */
export interface DashboardFastParams {
  liveWorkers: LiveWorkerState[];
  contextPercent: number;
  contextTokens: number;
  contextWindow: number;
  currentModelLabel: string;
  reasoningLevel: string;
  recentLogs: LogEntry[];
}

// ---------------------------------------------------------------------------
// Incremental dashboard state manager
// ---------------------------------------------------------------------------

/**
 * Caches dashboard state and refreshes only stale field groups.
 *
 * Fast fields (time, context, workers, tasks, systemStatus) recompute every
 * render via the params passed to getState(). Slow fields (nodes, models,
 * agents, runtimes, budget, run metrics) recompute only when a bus event
 * marks the corresponding group stale via markStale().
 *
 * All groups start stale so the first getState() call populates everything.
 */
export class DashboardStateManager {
  private cached: DashboardState | null = null;
  private readonly stale = new Set<StaleGroup>(["runs", "budget", "infrastructure"]);
  private readonly config: DashboardConfig;
  private readonly providers: DashboardDataProviders;

  // Cached slow provider results
  private agentSpecs: AgentSpec[] = [];
  private modelProfiles: MergedModelProfile[] = [];
  private runtimeCount = 0;
  private allRuns: RunEnvelope[] = [];
  private totalCost = 0;
  private budgetCeiling: number | null = null;
  private totalInputTokens = 0;
  private totalOutputTokens = 0;

  constructor(config: DashboardConfig, providers: DashboardDataProviders) {
    this.config = config;
    this.providers = providers;
  }

  /** Mark a field group as stale so the next getState() call refreshes it. */
  markStale(group: StaleGroup): void {
    this.stale.add(group);
  }

  /** Return the last cached snapshot, or null before first render. */
  getCached(): DashboardState | null {
    return this.cached;
  }

  /**
   * Build an up-to-date DashboardState.
   *
   * Refreshes slow field groups only when marked stale by bus events.
   * Fast fields (workers, context, time, logs) always recompute from
   * the provided params.
   */
  getState(fast: DashboardFastParams): DashboardState {
    this.refreshStaleGroups();

    this.cached = buildDashboardState({
      config: this.config,
      liveWorkers: fast.liveWorkers,
      allRuns: this.allRuns,
      agentSpecs: this.agentSpecs,
      modelProfiles: this.modelProfiles,
      contextPercent: fast.contextPercent,
      contextTokens: fast.contextTokens,
      contextWindow: fast.contextWindow,
      totalCost: this.totalCost,
      budgetCeiling: this.budgetCeiling,
      totalRuns: this.allRuns.length,
      totalInputTokens: this.totalInputTokens,
      totalOutputTokens: this.totalOutputTokens,
      currentModelLabel: fast.currentModelLabel,
      reasoningLevel: fast.reasoningLevel,
      runtimeCount: this.runtimeCount,
      recentLogs: fast.recentLogs,
    });

    return this.cached;
  }

  private refreshStaleGroups(): void {
    if (this.stale.has("infrastructure")) {
      this.agentSpecs = this.providers.getAgentSpecs();
      this.modelProfiles = this.providers.getModelProfiles();
      this.runtimeCount = this.providers.getRuntimeCount();
      this.stale.delete("infrastructure");
    }
    if (this.stale.has("runs")) {
      this.allRuns = this.providers.getAllRuns();
      const summary = this.providers.getMetricsSummary();
      this.totalInputTokens = summary.totalInputTokens;
      this.totalOutputTokens = summary.totalOutputTokens;
      this.stale.delete("runs");
    }
    if (this.stale.has("budget")) {
      this.totalCost = this.providers.getTotalCost();
      this.budgetCeiling = this.providers.getBudgetCeiling();
      this.stale.delete("budget");
    }
  }
}
