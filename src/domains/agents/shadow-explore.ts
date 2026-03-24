/**
 * Shadow explore: orchestrator-internal tool for concurrent codebase reconnaissance.
 *
 * The orchestrator calls shadow_explore to gather intelligence before dispatch
 * decisions. It controls exploration depth and return budget per invocation.
 * Scouts accumulate context through tool calls, then compact their findings
 * into structured reports the orchestrator can reference.
 *
 * Multi-round scouting is supported naturally: the orchestrator can call
 * shadow_explore multiple times, refining queries based on prior results.
 */

import { Type } from "@sinclair/typebox";
import { ToolName } from "../../core/tool-names";
import { type ScoutDepth, type ScoutResult, type ScoutReturnBudget, runScouts } from "../../engine/shadow";
import type { AgentToolResult, ExtensionContext } from "../../engine/types";
import { compileScoutPrompt } from "../prompts";
import { findModelProfile } from "../providers";

function textResult(text: string): AgentToolResult<unknown> {
  return { content: [{ type: "text", text }], details: undefined };
}

/**
 * Resolve the scout model from environment configuration.
 * Priority: PANCODE_SHADOW_MODEL > PANCODE_SCOUT_MODEL > orchestrator model.
 */
function resolveScoutModel(ctx: ExtensionContext) {
  for (const envVar of ["PANCODE_SHADOW_MODEL", "PANCODE_SCOUT_MODEL"]) {
    const value = process.env[envVar];
    if (value?.includes("/")) {
      const [provider, ...rest] = value.split("/");
      const id = rest.join("/");
      const found = ctx.modelRegistry.getAll().find((m) => m.provider === provider && m.id === id);
      if (found) {
        if (process.env.PANCODE_VERBOSE) {
          console.error(`[pancode:shadow] Scout model resolved from ${envVar}: ${provider}/${id}`);
        }
        return found;
      }
      console.error(
        `[pancode:shadow] ${envVar}=${value} not found in model registry. ` +
          `Available providers: ${[...new Set(ctx.modelRegistry.getAll().map((m) => m.provider))].join(", ")}`,
      );
    }
  }
  const fallback = ctx.model ?? undefined;
  console.error(
    `[pancode:shadow] Scout model falling back to orchestrator: ${fallback ? `${fallback.provider}/${fallback.id}` : "none"}`,
  );
  return fallback;
}

export function registerShadowExplore(
  registerTool: (tool: {
    name: string;
    label: string;
    description: string;
    promptSnippet?: string;
    promptGuidelines?: string[];
    parameters: ReturnType<typeof Type.Object>;
    execute: (
      toolCallId: string,
      params: { queries: string[]; depth?: string; returnBudget?: string },
      signal: AbortSignal | undefined,
      onUpdate: ((result: AgentToolResult<unknown>) => void) | undefined,
      ctx: ExtensionContext,
    ) => Promise<AgentToolResult<unknown>>;
  }) => void,
): void {
  registerTool({
    name: ToolName.SHADOW_EXPLORE,
    label: "Shadow Explore",
    promptSnippet:
      "Concurrent codebase reconnaissance. Spawns 1-4 scout agents on a fast model to explore in parallel.",
    promptGuidelines: [
      "Use shadow_explore to gather codebase intelligence: project structure, file locations, dependency maps, git state, config discovery, import graphs.",
      "Decompose broad questions into 2-4 targeted sub-queries. Each scout handles one specific question.",
      "Control exploration with depth (shallow/medium/deep) and returnBudget (brief/standard/detailed).",
      "Use read/grep/find/ls directly for simple single-file operations you can do yourself.",
      "You can call shadow_explore multiple times. Refine queries based on prior scout results.",
    ],
    description: [
      "Codebase reconnaissance via 1-4 concurrent scout agents on a fast model.",
      "Each scout explores independently, accumulates context, and returns structured findings.",
      "Use depth to control exploration thoroughness (shallow=quick scan, deep=thorough analysis).",
      "Use returnBudget to control output size (brief=key facts, detailed=full report with code).",
      "Call multiple times to refine: first round maps territory, second round digs into specifics.",
    ].join(" "),
    parameters: Type.Object({
      queries: Type.Array(Type.String({ description: "Specific codebase question for one scout" }), {
        description: "1-4 concurrent scout queries. Each runs on a separate agent in parallel.",
        minItems: 1,
        maxItems: 4,
      }),
      depth: Type.Optional(
        Type.Union([Type.Literal("shallow"), Type.Literal("medium"), Type.Literal("deep")], {
          description:
            "Exploration depth. shallow=directory scan(4 calls), medium=grep+read(12 calls), deep=thorough(20 calls). Default: medium.",
        }),
      ),
      returnBudget: Type.Optional(
        Type.Union([Type.Literal("brief"), Type.Literal("standard"), Type.Literal("detailed")], {
          description:
            "Output size. brief=500tok key facts, standard=2K findings+summary, detailed=5K with code excerpts. Default: standard.",
        }),
      ),
    }),
    async execute(_toolCallId, params, signal, onUpdate, ctx) {
      const { queries, depth, returnBudget } = params;

      if (!queries || queries.length === 0) {
        return textResult("Error: no queries provided");
      }

      const scoutCount = Math.min(queries.length, 4);
      const depthLabel = depth ?? "medium";
      const budgetLabel = returnBudget ?? "standard";

      if (onUpdate) {
        onUpdate(
          textResult(
            `scouting... (${scoutCount} scout${scoutCount > 1 ? "s" : ""}, depth=${depthLabel}, return=${budgetLabel})`,
          ),
        );
      }

      const model = resolveScoutModel(ctx);
      const startTime = Date.now();

      const scoutProfile = model ? (findModelProfile(model.provider, model.id) ?? null) : null;
      const scoutPrompt = compileScoutPrompt(scoutProfile);

      let results: ScoutResult[];
      try {
        results = await runScouts(queries, {
          cwd: ctx.cwd,
          model,
          modelRegistry: ctx.modelRegistry as Parameters<typeof runScouts>[1]["modelRegistry"],
          systemPrompt: scoutPrompt,
          signal: signal ?? undefined,
          queryOptions: {
            depth: (depthLabel as ScoutDepth) ?? "medium",
            returnBudget: (budgetLabel as ScoutReturnBudget) ?? "standard",
          },
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[pancode:shadow] Scout run failed: ${msg}`);
        return textResult(`Shadow explore failed: ${msg}`);
      }

      const wallMs = Date.now() - startTime;
      const totalToolCalls = results.reduce((sum, r) => sum + r.toolCalls, 0);
      const errors = results.filter((r) => r.error);

      // Per-scout diagnostic logging for debugging silent failures.
      for (const r of results) {
        const status = r.error ? `error: ${r.error}` : `${r.toolCalls} tool calls`;
        console.error(
          `[pancode:shadow] Scout "${r.query.slice(0, 60)}" completed in ${(r.durationMs / 1000).toFixed(1)}s (${status})`,
        );
      }
      console.error(
        `[pancode:shadow] ${results.length} scouts completed in ${(wallMs / 1000).toFixed(1)}s ` +
          `(${totalToolCalls} tool calls, depth=${depthLabel}, return=${budgetLabel}` +
          `${errors.length > 0 ? `, ${errors.length} errors` : ""})`,
      );

      // Build structured result for the orchestrator's context.
      const sections: string[] = [];
      for (const r of results) {
        if (r.error) {
          sections.push(`[Scout: ${r.query}]\nError: ${r.error}`);
        } else {
          sections.push(`[Scout: ${r.query}]\n${r.response || "(no findings)"}`);
        }
      }

      const header =
        `${results.length} scout${results.length > 1 ? "s" : ""} completed in ${(wallMs / 1000).toFixed(1)}s ` +
        `(${totalToolCalls} tool calls, depth=${depthLabel})`;

      return textResult(`${header}\n\n${sections.join("\n\n")}`);
    },
  });
}
