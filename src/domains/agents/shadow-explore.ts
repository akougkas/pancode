/**
 * Shadow explore: orchestrator-internal tool for pre-dispatch codebase intelligence.
 *
 * Registers shadow_explore as a tool the orchestrator can call to gather information
 * before making dispatch decisions. Runs in-process with a cheap/fast model and
 * readonly tools. Not visible to workers or users.
 */

import { Type } from "@sinclair/typebox";
import type { ExtensionContext, AgentToolResult } from "../../engine/types";
import { runShadowQuery, type ShadowQueryResult } from "../../engine/shadow";

function textResult(text: string): AgentToolResult<unknown> {
  return { content: [{ type: "text", text }], details: undefined };
}

const SHADOW_SYSTEM_CONTEXT = [
  "You are a codebase exploration agent. Your job is to investigate the project",
  "structure, find relevant files, read key configurations, and return structured",
  "findings. Be concise and factual. Focus on what is relevant to the query.",
  "Do not suggest changes or make judgments. Report what you find.",
].join(" ");

/**
 * Resolve the shadow model from configuration or fall back to the orchestrator model.
 * Prefers PANCODE_SHADOW_MODEL env var, then looks for cheap local models in the
 * model registry, then falls back to the current orchestrator model.
 */
function resolveShadowModel(ctx: ExtensionContext): { provider: string; id: string } | null {
  const shadowModelEnv = process.env.PANCODE_SHADOW_MODEL;
  if (shadowModelEnv && shadowModelEnv.includes("/")) {
    const [provider, ...rest] = shadowModelEnv.split("/");
    return { provider, id: rest.join("/") };
  }

  // Fall back to orchestrator model
  if (ctx.model) {
    return { provider: ctx.model.provider, id: ctx.model.id };
  }

  return null;
}

export function registerShadowExplore(
  registerTool: (tool: {
    name: string;
    label: string;
    description: string;
    parameters: ReturnType<typeof Type.Object>;
    execute: (
      toolCallId: string,
      params: { query: string },
      signal: AbortSignal | undefined,
      onUpdate: ((result: AgentToolResult<unknown>) => void) | undefined,
      ctx: ExtensionContext,
    ) => Promise<AgentToolResult<unknown>>;
  }) => void,
): void {
  registerTool({
    name: "shadow_explore",
    label: "Shadow Explore",
    description:
      "Explore the codebase to gather intelligence before dispatching work. Use this to understand file structure, find relevant code, and orient yourself before planning dispatch. Runs in-process with a lightweight model.",
    parameters: Type.Object({
      query: Type.String({ description: "What to explore or investigate in the codebase" }),
    }),
    async execute(_toolCallId, params, _signal, onUpdate, ctx) {
      const { query } = params;

      if (!query?.trim()) {
        return textResult("Error: empty query");
      }

      if (onUpdate) {
        onUpdate(textResult("Exploring codebase..."));
      }

      const shadowModel = resolveShadowModel(ctx);

      // Build full query with system context
      const fullQuery = `${SHADOW_SYSTEM_CONTEXT}\n\nExplore: ${query}`;

      let result: ShadowQueryResult;
      try {
        result = await runShadowQuery({
          query: fullQuery,
          cwd: ctx.cwd,
          model: shadowModel && ctx.model ? ctx.model : undefined,
          modelRegistry: ctx.modelRegistry as Parameters<typeof runShadowQuery>[0]["modelRegistry"],
          timeoutMs: 30000,
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[pancode:shadow] Explore failed: ${msg}`);
        return textResult(`Shadow explore failed: ${msg}`);
      }

      if (result.error) {
        console.error(`[pancode:shadow] Explore error: ${result.error}`);
        return textResult(`Shadow explore error: ${result.error}`);
      }

      const durStr = (result.durationMs / 1000).toFixed(1);
      console.error(`[pancode:shadow] Explore completed in ${durStr}s, ${result.toolCalls} tool calls`);

      const summary = [
        `Shadow explore completed (${durStr}s, ${result.toolCalls} tool calls)`,
        "",
        result.response || "(no response)",
      ].join("\n");

      return textResult(summary);
    },
  });
}
