import type { AgentRuntime } from "../../engine/runtimes/types";
import type { MergedModelProfile } from "../providers";
import type { AgentSpec } from "./spec-registry";

// ---------------------------------------------------------------------------
// Worker Score: multi-dimensional fitness metric
// ---------------------------------------------------------------------------

/**
 * Worker score dimensions, each normalized to [0, 1].
 *
 * Directly inspired by LABIOS worker scoring (Kougkas et al.):
 *   LABIOS: availability, capacity, load, speed, energy
 *   PanCode: availability, capacity, load, capability, cost
 *
 * The final score is: sum(weight_i * dimension_i) for i in 1..5
 */
export interface WorkerScore {
  /** 0 = unavailable (runtime missing, model unreachable), 1 = ready */
  availability: number;
  /** [0,1] ratio of remaining budget/quota. 1 = full budget remaining. */
  capacity: number;
  /** [0,1] based on active dispatch count / max concurrent. 0 = idle. */
  load: number;
  /** [0,1] how well this worker fits the task type. Based on tier match,
   *  tool coverage, context window, reasoning capability. */
  capability: number;
  /** [0,1] cost efficiency. 1 = cheapest (local), 0 = most expensive. */
  cost: number;
  /** Weighted combination of all dimensions. */
  overall: number;
}

/**
 * Scoring policy weights. Each weight is a float. The sum does not need
 * to equal 1; normalization happens in the scoring function.
 *
 * Default weights prioritize capability and availability (task completion
 * over cost savings). Users override via PANCODE_SCORING_POLICY env var.
 *
 * Analogous to LABIOS Table 2 weighting examples:
 *   Low latency:    availability=0.5, load=0.35, speed=0.15
 *   Energy savings: energy=0.5, load=0.2, capacity=0.15, speed=0.15
 *   High bandwidth: speed=0.70, capacity=0.15, load=0.15
 */
export interface ScoringPolicy {
  availability: number;
  capacity: number;
  load: number;
  capability: number;
  cost: number;
}

export const DEFAULT_SCORING_POLICY: ScoringPolicy = {
  availability: 0.3,
  capacity: 0.1,
  load: 0.15,
  capability: 0.35,
  cost: 0.1,
};

export const COST_OPTIMIZED_POLICY: ScoringPolicy = {
  availability: 0.2,
  capacity: 0.1,
  load: 0.1,
  capability: 0.15,
  cost: 0.45,
};

export const THROUGHPUT_POLICY: ScoringPolicy = {
  availability: 0.25,
  capacity: 0.15,
  load: 0.4,
  capability: 0.1,
  cost: 0.1,
};

// ---------------------------------------------------------------------------
// PanWorker: materialized worker entity
// ---------------------------------------------------------------------------

/**
 * A PanWorker is a fully resolved, scoreable unit of work capacity.
 * It binds an agent type to a specific runtime and (optionally) a model.
 *
 * Analogous to a LABIOS worker: a storage server with known speed, capacity,
 * energy profile, and availability. PanCode workers have known capability,
 * cost, load, and availability.
 */
export interface PanWorker {
  /** Composite ID: "agentType@runtimeId" (e.g., "builder@cli:claude-code") */
  id: string;
  /** Agent spec name */
  agentType: string;
  /** Runtime ID */
  runtimeId: string;
  /** Resolved model reference (provider/model-id) or null for CLI-managed */
  model: string | null;
  /** Agent tier requirement */
  tier: "frontier" | "mid" | "any";
  /** Tool allowlist */
  tools: string;
  /** Whether this worker can mutate files */
  readonly: boolean;
  /** Current multi-dimensional score */
  score: WorkerScore;
  /** Runtime reference for display (version, binary name) */
  runtimeRef: AgentRuntime;
  /** Model profile for capability queries (null for CLI-managed models) */
  modelProfile: MergedModelProfile | null;
}

// ---------------------------------------------------------------------------
// Scoring functions
// ---------------------------------------------------------------------------

/**
 * Compute the availability dimension.
 * 1 if the runtime is available and the model is reachable, 0 otherwise.
 */
export function scoreAvailability(runtime: AgentRuntime, _modelProfile: MergedModelProfile | null): number {
  return runtime.isAvailable() ? 1.0 : 0.0;
}

/**
 * Compute the capability dimension.
 * Factors: tier match, context window, reasoning, tool calling.
 */
export function scoreCapability(
  agentTier: "frontier" | "mid" | "any",
  modelProfile: MergedModelProfile | null,
  isCliRuntime: boolean,
): number {
  // CLI runtimes with their own models: assume mid capability (0.6)
  // since we cannot inspect the model they will use.
  if (isCliRuntime && !modelProfile) return 0.6;

  if (!modelProfile) return 0.3; // No model info at all

  const caps = modelProfile.capabilities;
  let score = 0.3; // Base: model exists and is reachable

  // Context window contribution
  const ctx = caps.contextWindow ?? 0;
  if (ctx >= 100_000) score += 0.25;
  else if (ctx >= 32_000) score += 0.15;
  else if (ctx >= 16_000) score += 0.1;

  // Reasoning capability
  if (caps.reasoning) score += 0.15;

  // Tool calling support (critical for agent work)
  if (caps.toolCalling) score += 0.15;

  // Tier match bonus
  if (agentTier === "any") score += 0.1;
  else if (agentTier === "frontier" && ctx >= 100_000) score += 0.1;
  else if (agentTier === "mid" && ctx >= 16_000) score += 0.1;

  return Math.min(score, 1.0);
}

/**
 * Compute the cost dimension.
 * Local models = 1.0 (free), cloud models scored by inverse of estimated cost.
 */
export function scoreCost(modelProfile: MergedModelProfile | null, isLocal: boolean): number {
  if (isLocal) return 1.0;
  if (!modelProfile) return 0.5; // Unknown cost, assume moderate
  // Cloud models: lower score. Could be refined with actual pricing data.
  return 0.3;
}

/**
 * Compute the overall weighted score from individual dimensions.
 */
export function computeOverallScore(dimensions: Omit<WorkerScore, "overall">, policy: ScoringPolicy): number {
  const totalWeight = policy.availability + policy.capacity + policy.load + policy.capability + policy.cost;
  if (totalWeight === 0) return 0;

  const weighted =
    policy.availability * dimensions.availability +
    policy.capacity * dimensions.capacity +
    policy.load * (1.0 - dimensions.load) + // Invert: lower load = higher score
    policy.capability * dimensions.capability +
    policy.cost * dimensions.cost;

  return weighted / totalWeight;
}

// ---------------------------------------------------------------------------
// Worker Pool
// ---------------------------------------------------------------------------

/**
 * The worker pool maintains a scored, sorted view of all available workers.
 *
 * Analogous to LABIOS Worker Manager: maintains workers' statuses, scores,
 * and a sorted list for the label dispatcher.
 *
 * The pool materializes workers from:
 *   agent specs (from agents.yaml / defaults)
 *   x available runtimes (from runtime discovery)
 *
 * Each agent spec produces exactly one PanWorker bound to its configured
 * runtime. Future: an agent spec with tier="any" could produce multiple
 * workers across compatible runtimes for the dispatcher to choose from.
 */
export class WorkerPool {
  private workers: PanWorker[] = [];
  private policy: ScoringPolicy;
  private activeDispatches = new Map<string, number>(); // workerId -> count
  private maxConcurrent: number;

  constructor(policy?: ScoringPolicy, maxConcurrent?: number) {
    this.policy = policy ?? loadScoringPolicy();
    this.maxConcurrent = maxConcurrent ?? 4;
  }

  /**
   * Materialize workers from agent specs and runtime registry.
   * Called at boot after runtime discovery and agent loading.
   */
  materialize(specs: AgentSpec[], runtimes: AgentRuntime[], modelProfiles: MergedModelProfile[]): void {
    this.workers = [];

    for (const spec of specs) {
      const runtime = runtimes.find((r) => r.id === spec.runtime);
      if (!runtime) continue; // Runtime not registered

      // Resolve model profile if the agent has a model configured
      let modelProfile: MergedModelProfile | null = null;
      if (spec.model) {
        const slashIdx = spec.model.indexOf("/");
        if (slashIdx > 0) {
          const providerId = spec.model.slice(0, slashIdx);
          const modelId = spec.model.slice(slashIdx + 1);
          modelProfile = modelProfiles.find((p) => p.providerId === providerId && p.modelId === modelId) ?? null;
        }
      }

      const isLocal = modelProfile
        ? ["lmstudio", "ollama", "llamacpp"].some((e) => modelProfile?.engine.startsWith(e))
        : false;
      const isCliRuntime = runtime.tier === "cli";

      const dimensions = {
        availability: scoreAvailability(runtime, modelProfile),
        capacity: 1.0, // Full capacity at boot
        load: 0.0, // No load at boot
        capability: scoreCapability(spec.tier, modelProfile, isCliRuntime),
        cost: scoreCost(modelProfile, isLocal),
      };

      const overall = computeOverallScore(dimensions, this.policy);

      this.workers.push({
        id: `${spec.name}@${runtime.id}`,
        agentType: spec.name,
        runtimeId: runtime.id,
        model: spec.model ?? null,
        tier: spec.tier,
        tools: spec.tools,
        readonly: spec.readonly,
        score: { ...dimensions, overall },
        runtimeRef: runtime,
        modelProfile,
      });
    }

    this.sortByScore();
  }

  /**
   * Update load dimension for a worker (called on dispatch start/end).
   */
  recordDispatchStart(workerId: string): void {
    const count = (this.activeDispatches.get(workerId) ?? 0) + 1;
    this.activeDispatches.set(workerId, count);
    this.updateLoadScore(workerId);
  }

  recordDispatchEnd(workerId: string): void {
    const count = Math.max(0, (this.activeDispatches.get(workerId) ?? 0) - 1);
    this.activeDispatches.set(workerId, count);
    this.updateLoadScore(workerId);
  }

  private updateLoadScore(workerId: string): void {
    const worker = this.workers.find((w) => w.id === workerId);
    if (!worker) return;
    const count = this.activeDispatches.get(workerId) ?? 0;
    worker.score.load = Math.min(count / this.maxConcurrent, 1.0);
    worker.score.overall = computeOverallScore(worker.score, this.policy);
    this.sortByScore();
  }

  /**
   * Get the best worker for a given agent type.
   * Returns the highest-scored available worker matching the agent name.
   */
  bestForAgent(agentName: string): PanWorker | undefined {
    return this.workers.find((w) => w.agentType === agentName && w.score.availability > 0);
  }

  /**
   * Get all workers, sorted by overall score descending.
   */
  all(): readonly PanWorker[] {
    return this.workers;
  }

  /**
   * Get workers filtered by a predicate.
   */
  filter(predicate: (w: PanWorker) => boolean): PanWorker[] {
    return this.workers.filter(predicate);
  }

  /**
   * Get workers for a specific tier requirement.
   */
  forTier(tier: "frontier" | "mid" | "any"): PanWorker[] {
    if (tier === "any") return [...this.workers];
    const tierRank: Record<string, number> = { frontier: 3, mid: 2, any: 1 };
    const required = tierRank[tier] ?? 0;
    return this.workers.filter((w) => {
      const workerRank = tierRank[w.tier] ?? 0;
      return workerRank >= required;
    });
  }

  /**
   * Number of materialized workers.
   */
  count(): number {
    return this.workers.length;
  }

  private sortByScore(): void {
    this.workers.sort((a, b) => b.score.overall - a.score.overall);
  }
}

/**
 * Load scoring policy from environment or return defaults.
 * Format: PANCODE_SCORING_POLICY=availability:0.3,capacity:0.1,load:0.15,capability:0.35,cost:0.1
 */
function loadScoringPolicy(): ScoringPolicy {
  const env = process.env.PANCODE_SCORING_POLICY;
  if (!env) return { ...DEFAULT_SCORING_POLICY };

  const policy = { ...DEFAULT_SCORING_POLICY };
  for (const pair of env.split(",")) {
    const [key, val] = pair.split(":");
    if (key && val && key in policy) {
      (policy as Record<string, number>)[key] = Number.parseFloat(val);
    }
  }
  return policy;
}

// ---------------------------------------------------------------------------
// Singleton pool instance
// ---------------------------------------------------------------------------

export const workerPool = new WorkerPool();
