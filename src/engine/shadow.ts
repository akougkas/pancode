/**
 * Shadow Scout Engine: lightweight in-process agents for orchestrator reconnaissance.
 *
 * Each scout is a bare Pi Agent (no session/resource/extension overhead) that
 * accumulates context up to 100K tokens through tool calls, then compacts its
 * findings into structured output for the orchestrator.
 *
 * The orchestrator controls two knobs per query:
 *   - depth: shallow (4 calls) | medium (12) | deep (20) -- exploration thoroughness
 *   - returnBudget: brief (500 tok) | standard (2K) | detailed (5K) -- output size
 *
 * Budget enforcement uses a two-phase approach:
 *   1. Soft steer: at the depth limit, inject a user message telling the scout
 *      to stop exploring and produce its structured report.
 *   2. Hard abort: at 2x the depth limit, abort the agent as a safety net.
 *      This only fires if the model ignores the steer entirely.
 */

import { Agent } from "@pancode/pi-agent-core";
import type { Api, Model } from "@pancode/pi-ai";
import {
  type ModelRegistry,
  createBashTool,
  createFindTool,
  createGrepTool,
  createLsTool,
  createReadTool,
} from "@pancode/pi-coding-agent";
import { getAgentProfile } from "../core/agent-profiles";

export const MAX_CONCURRENT_SCOUTS = 4;

const scoutProfile = getAgentProfile("scout");

/** Exploration depth presets: tool call soft budget before the steer fires. */
export type ScoutDepth = "shallow" | "medium" | "deep";

const DEPTH_BUDGETS: Record<ScoutDepth, number> = {
  shallow: 4,
  medium: 12,
  deep: 20,
};

/** Return budget labels that map to token guidance in the steer message. */
export type ScoutReturnBudget = "brief" | "standard" | "detailed";

const RETURN_BUDGET_GUIDANCE: Record<ScoutReturnBudget, string> = {
  brief: "Produce a BRIEF report: key findings only, under 500 tokens. No code blocks.",
  standard: "Produce a STANDARD report: findings with one-line descriptions, under 2000 tokens.",
  detailed: "Produce a DETAILED report: findings with descriptions and short code excerpts, under 5000 tokens.",
};

export interface ScoutResult {
  query: string;
  response: string;
  toolCalls: number;
  durationMs: number;
  error?: string;
}

export interface ScoutQueryOptions {
  depth?: ScoutDepth;
  returnBudget?: ScoutReturnBudget;
}

export interface ScoutRunOptions {
  cwd: string;
  model?: Model<Api>;
  modelRegistry?: InstanceType<typeof ModelRegistry>;
  systemPrompt: string;
  signal?: AbortSignal;
  queryOptions?: ScoutQueryOptions;
}

/**
 * Run 1-N scout queries concurrently. Each query gets its own lightweight
 * Pi Agent. Queries beyond MAX_CONCURRENT_SCOUTS are silently dropped.
 */
export async function runScouts(queries: string[], options: ScoutRunOptions): Promise<ScoutResult[]> {
  const limited = queries.slice(0, MAX_CONCURRENT_SCOUTS);
  const settled = await Promise.allSettled(limited.map((query) => runSingleScout(query, options)));

  return settled.map((outcome, i) => {
    if (outcome.status === "fulfilled") return outcome.value;
    return {
      query: limited[i],
      response: "",
      toolCalls: 0,
      durationMs: 0,
      error: outcome.reason instanceof Error ? outcome.reason.message : String(outcome.reason),
    };
  });
}

async function runSingleScout(query: string, options: ScoutRunOptions): Promise<ScoutResult> {
  const startTime = Date.now();

  try {
    const model = options.model;
    if (!model) {
      return {
        query,
        response: "",
        toolCalls: 0,
        durationMs: Date.now() - startTime,
        error: "No scout model configured",
      };
    }

    const registry = options.modelRegistry;
    const apiKey = registry ? await registry.getApiKeyForProvider(model.provider) : undefined;

    const tools = [
      createReadTool(options.cwd),
      createGrepTool(options.cwd),
      createFindTool(options.cwd),
      createLsTool(options.cwd),
      createBashTool(options.cwd),
    ];

    const depth = options.queryOptions?.depth ?? "medium";
    const returnBudget = options.queryOptions?.returnBudget ?? "standard";
    const softBudget = DEPTH_BUDGETS[depth];
    const hardCap = softBudget * 2;

    let toolCalls = 0;
    let steered = false;

    // Strip reasoning and thinking compat. Scout agents never reason.
    const scoutCompat = model.compat ? { ...model.compat, thinkingFormat: undefined } : model.compat;
    const scoutModel = { ...model, reasoning: false, compat: scoutCompat } as Model<Api>;

    const agent = new Agent({
      initialState: {
        systemPrompt: options.systemPrompt,
        model: scoutModel,
        thinkingLevel: "off",
        tools,
      },
      getApiKey: async () => apiKey,
      onPayload: async (payload) => {
        if (payload && typeof payload === "object") {
          (payload as Record<string, unknown>).temperature = scoutProfile.temperature;
          (payload as Record<string, unknown>).top_p = scoutProfile.topP;
          (payload as Record<string, unknown>).top_k = scoutProfile.topK;
          (payload as Record<string, unknown>).presence_penalty = scoutProfile.presencePenalty;
        }
        return payload;
      },
      afterToolCall: async () => {
        toolCalls++;

        // Soft budget: steer the scout to wrap up with return budget guidance.
        if (toolCalls >= softBudget && !steered) {
          steered = true;
          try {
            agent.steer({
              role: "user",
              content: [
                {
                  type: "text",
                  text: `BUDGET REACHED (${toolCalls} tool calls). Stop exploring. ${RETURN_BUDGET_GUIDANCE[returnBudget]} Write your REPORT: section now.`,
                },
              ],
              timestamp: Date.now(),
            });
          } catch (err) {
            if (err instanceof TypeError && String(err).includes("is not a function")) {
              console.error("[pancode:shadow] Agent.steer() not available. Pi SDK agent-core API may have changed.");
            } else {
              throw err;
            }
          }
        }

        // Hard safety cap: abort if the model ignores the steer entirely.
        if (toolCalls >= hardCap) {
          try {
            agent.abort();
          } catch (err) {
            if (err instanceof TypeError && String(err).includes("is not a function")) {
              console.error("[pancode:shadow] Agent.abort() not available. Pi SDK agent-core API may have changed.");
            } else {
              throw err;
            }
          }
        }

        return undefined;
      },
    });

    const modelInfo = `${model.provider}/${model.id}`;
    console.error(
      `[pancode:shadow] Scout ready (model=${modelInfo}, depth=${depth}[${softBudget}/${hardCap}], return=${returnBudget})`,
    );

    // Collect ALL text responses across turns. The scout may produce partial
    // observations between tool calls, plus a final structured report after steer.
    const textParts: string[] = [];
    try {
      agent.subscribe((event) => {
        if (event.type === "message_end" && "message" in event) {
          const msg = event.message;
          if (msg?.role === "assistant" && Array.isArray(msg.content)) {
            for (const part of msg.content) {
              if (part && typeof part === "object" && "type" in part && part.type === "text" && "text" in part) {
                const text = String(part.text).trim();
                if (text.length > 0) {
                  textParts.push(text);
                }
              }
            }
          }
        }
      });
    } catch (err) {
      if (err instanceof TypeError && String(err).includes("is not a function")) {
        console.error("[pancode:shadow] Agent.subscribe() not available. Pi SDK agent-core API may have changed.");
      } else {
        throw err;
      }
    }

    const abortHandler = () => {
      try {
        agent.abort();
      } catch (err) {
        if (err instanceof TypeError && String(err).includes("is not a function")) {
          console.error("[pancode:shadow] Agent.abort() not available. Pi SDK agent-core API may have changed.");
        }
        // Swallow: abort handler is best-effort on external signal.
      }
    };
    options.signal?.addEventListener("abort", abortHandler, { once: true });

    try {
      await agent.prompt(query);
    } catch (err) {
      if (err instanceof TypeError && String(err).includes("is not a function")) {
        console.error("[pancode:shadow] Agent.prompt() not available. Pi SDK agent-core API may have changed.");
        return {
          query,
          response: "",
          toolCalls: 0,
          durationMs: Date.now() - startTime,
          error: "Agent.prompt() not available. Pi SDK agent-core API may have changed.",
        };
      }
      throw err;
    } finally {
      options.signal?.removeEventListener("abort", abortHandler);
    }

    const durationMs = Date.now() - startTime;
    const response = textParts.join("\n\n");

    // Warn when a scout returns suspiciously fast with no tool calls.
    // This typically indicates the model could not be reached, auth failed,
    // or the prompt was incompatible with the provider.
    if (durationMs < 1000 && toolCalls === 0 && response.length === 0) {
      console.error(
        `[pancode:shadow] Scout completed in ${durationMs}ms with 0 tool calls and empty response. ` +
          `Model: ${modelInfo}. This usually means the model request failed silently.`,
      );
    }

    return {
      query,
      response,
      toolCalls,
      durationMs,
    };
  } catch (err) {
    const durationMs = Date.now() - startTime;
    console.error(
      `[pancode:shadow] Scout error after ${durationMs}ms: ${err instanceof Error ? err.message : String(err)}`,
    );
    return {
      query,
      response: "",
      toolCalls: 0,
      durationMs,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
