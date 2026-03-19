interface AgentFailureState {
  failures: number;
  lastFailureAt: number;
  status: "clear" | "warning" | "tripped";
  trippedAt: number | null;
}

const WARNING_THRESHOLD = 3;
const TRIPPED_THRESHOLD = 5;
const COOLDOWN_MS = 10 * 60 * 1000; // 10 minutes
const CASCADE_WINDOW_MS = 60 * 1000; // 60 seconds
const CASCADE_AGENT_THRESHOLD = 3;

export interface LoopDetectorEvent {
  type: "warning" | "tripped" | "cascade";
  agent: string;
  failures: number;
  message: string;
}

export interface LoopDetector {
  recordFailure(agent: string): LoopDetectorEvent | null;
  recordSuccess(agent: string): void;
  isBlocked(agent: string): boolean;
  getStatus(agent: string): AgentFailureState | null;
  getAllAgents(): string[];
  reset(agent: string): void;
  resetAll(): void;
}

export function createLoopDetector(): LoopDetector {
  const agents = new Map<string, AgentFailureState>();

  function getOrCreate(agent: string): AgentFailureState {
    let state = agents.get(agent);
    if (!state) {
      state = { failures: 0, lastFailureAt: 0, status: "clear", trippedAt: null };
      agents.set(agent, state);
    }
    return state;
  }

  function checkCooldown(state: AgentFailureState): void {
    if (state.status === "tripped" && state.trippedAt) {
      if (Date.now() - state.trippedAt > COOLDOWN_MS) {
        state.status = "clear";
        state.failures = 0;
        state.trippedAt = null;
      }
    }
  }

  function checkCascade(): LoopDetectorEvent | null {
    const now = Date.now();
    let recentFailedAgents = 0;
    for (const [, state] of agents) {
      if (now - state.lastFailureAt < CASCADE_WINDOW_MS && state.failures > 0) {
        recentFailedAgents++;
      }
    }
    if (recentFailedAgents >= CASCADE_AGENT_THRESHOLD) {
      return {
        type: "cascade",
        agent: "*",
        failures: recentFailedAgents,
        message: `Cascade detected: ${recentFailedAgents} agents failed within ${CASCADE_WINDOW_MS / 1000}s`,
      };
    }
    return null;
  }

  return {
    recordFailure(agent: string): LoopDetectorEvent | null {
      const state = getOrCreate(agent);
      checkCooldown(state);
      state.failures++;
      state.lastFailureAt = Date.now();

      if (state.failures >= TRIPPED_THRESHOLD && state.status !== "tripped") {
        state.status = "tripped";
        state.trippedAt = Date.now();
        return {
          type: "tripped",
          agent,
          failures: state.failures,
          message: `Agent ${agent} tripped after ${state.failures} failures`,
        };
      }
      if (state.failures >= WARNING_THRESHOLD && state.status === "clear") {
        state.status = "warning";
        return {
          type: "warning",
          agent,
          failures: state.failures,
          message: `Agent ${agent} warning: ${state.failures} consecutive failures`,
        };
      }

      return checkCascade();
    },

    recordSuccess(agent: string): void {
      const state = agents.get(agent);
      if (!state) return;
      // Halve failure count on success (gradual recovery)
      state.failures = Math.floor(state.failures / 2);
      if (state.failures < WARNING_THRESHOLD) state.status = "clear";
    },

    isBlocked(agent: string): boolean {
      const state = agents.get(agent);
      if (!state) return false;
      checkCooldown(state);
      return state.status === "tripped";
    },

    getStatus(agent: string): AgentFailureState | null {
      const state = agents.get(agent);
      if (!state) return null;
      checkCooldown(state);
      return { ...state };
    },

    getAllAgents(): string[] {
      return [...agents.keys()];
    },
    reset(agent: string): void {
      agents.delete(agent);
    },
    resetAll(): void {
      agents.clear();
    },
  };
}
