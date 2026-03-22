/**
 * Dashboard state builder.
 *
 * Constructs a DashboardState from live PanCode runtime telemetry.
 * Every field is sourced from a real data API. Nothing is fabricated.
 *
 * Imported by extension.ts to power the dashboard widget's render loop.
 */

import os from "node:os";
import { getModeDefinition } from "../../core/modes";
import { DEFAULT_SAFETY } from "../../core/defaults";
import { PANCODE_PRODUCT_NAME } from "../../core/shell-metadata";
import type { AgentSpec } from "../agents";
import type { RunEnvelope } from "../dispatch";
import type { MergedModelProfile } from "../providers";
import {
  type AgentEntry,
  type AgentStatus,
  type DashboardConfig,
  type DashboardState,
  type LogEntry,
  type NodeInfo,
  type TaskEntry,
} from "./dashboard-theme";
import type { LiveWorkerState } from "./worker-widgets";

// ---------------------------------------------------------------------------
// Config (stable across renders)
// ---------------------------------------------------------------------------

export function buildDashboardConfig(): DashboardConfig {
  return {
    productName: PANCODE_PRODUCT_NAME,
    version: process.env.npm_package_version ?? "dev",
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
  const recentRuns = allRuns
    .filter((r) => r.status !== "running" && r.status !== "pending")
    .slice(-5);
  for (const r of recentRuns) {
    tasks.push({
      id: r.id.length > 8 ? `#${r.id.slice(0, 7)}` : `#${r.id}`,
      agent: r.agent,
      status: r.status.toUpperCase(),
      tokens: (r.usage.inputTokens ?? 0) + (r.usage.outputTokens ?? 0),
    });
  }

  // Build node info from model profiles
  const chatProfiles = modelProfiles.filter((p) => {
    const id = p.modelId.toLowerCase();
    return !id.includes("embed") && !id.includes("tts") && !id.includes("whisper");
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

    agents,
    tasks,
    logs: recentLogs,
  };
}
