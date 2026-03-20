/**
 * Shadow explore: orchestrator-internal tool for concurrent codebase reconnaissance.
 *
 * Registers shadow_explore as a tool the orchestrator can call to gather
 * intelligence before dispatch decisions. Spawns 1-4 concurrent in-process
 * scout agents on a fast model. Results are returned in memory as structured
 * data. Not visible to workers or users.
 */

import { Type } from "@sinclair/typebox";
import { type ScoutResult, runScouts } from "../../engine/shadow";
import type { AgentToolResult, ExtensionContext } from "../../engine/types";

function textResult(text: string): AgentToolResult<unknown> {
  return { content: [{ type: "text", text }], details: undefined };
}

// System prompt tuned for small, fast models (3B-8B parameters).
// Optimized for minimal token waste: short instructions, explicit tool
// strategy, structured output format, strict call budget. Small models
// need unambiguous directives to avoid wasting turns on exploration loops.
const SCOUT_SYSTEM_PROMPT = [
  "You are a code scout. Locate files and extract specific information from a codebase.",
  "",
  "Tools: read, grep, find, ls, bash",
  "",
  "Strategy (in priority order):",
  "1. Use find or ls FIRST to locate relevant files and directories.",
  "2. Use grep for pattern/symbol search across the codebase. Prefer grep over bash for search.",
  "3. Use bash with ripgrep (rg) for complex multi-pattern searches or file type filtering.",
  "4. Use read to examine file contents ONLY when you know the exact path.",
  "5. Limit to 3-5 tool calls total. Report what you found and stop immediately.",
  "",
  "Output rules:",
  "- Structure every finding as: FOUND: path/file.ts:line -- description",
  "- Report exact file paths and line numbers.",
  "- Be concise. Facts only. No opinions, no suggestions, no commentary.",
  "- If you cannot find what was asked for, say NOT FOUND and stop.",
  "- Do not apologize. Do not explain your search strategy. Just report results.",
].join("\n");

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
      if (found) return found;
    }
  }
  return ctx.model ?? undefined;
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
      params: { queries: string[] },
      signal: AbortSignal | undefined,
      onUpdate: ((result: AgentToolResult<unknown>) => void) | undefined,
      ctx: ExtensionContext,
    ) => Promise<AgentToolResult<unknown>>;
  }) => void,
): void {
  registerTool({
    name: "shadow_explore",
    label: "Shadow Explore",
    promptSnippet:
      "Concurrent codebase reconnaissance. Spawns 1-4 scout agents to explore in parallel before dispatch decisions.",
    promptGuidelines: [
      "Use shadow_explore for open-ended codebase questions (project structure, locating files, understanding architecture). It spawns parallel scouts on a fast model.",
      "Use read/grep/find/ls for targeted single-file operations (user asks to read a specific file, check a known path).",
      "Before dispatching workers, use shadow_explore to gather context about the relevant code areas.",
    ],
    description: [
      "Internal codebase reconnaissance before complex dispatch decisions.",
      "Spawns 1-4 concurrent scout agents to explore in parallel.",
      "Call ONLY when you need to understand project structure, locate files,",
      "or read configurations before deciding how to dispatch workers.",
      "Do NOT call for greetings, simple questions, conversations, or tasks you",
      "can answer directly. Do NOT call when the user already told you what to",
      "dispatch. Each query runs on a separate fast scout agent concurrently.",
    ].join(" "),
    parameters: Type.Object({
      queries: Type.Array(Type.String({ description: "Specific codebase question for one scout" }), {
        description: "1-4 concurrent scout queries. Each runs on a separate agent in parallel.",
        minItems: 1,
        maxItems: 4,
      }),
    }),
    async execute(_toolCallId, params, signal, onUpdate, ctx) {
      const { queries } = params;

      if (!queries || queries.length === 0) {
        return textResult("Error: no queries provided");
      }

      const scoutCount = Math.min(queries.length, 4);
      if (onUpdate) {
        onUpdate(textResult(`researching internally... (${scoutCount} scout${scoutCount > 1 ? "s" : ""})`));
      }

      const model = resolveScoutModel(ctx);
      const startTime = Date.now();

      let results: ScoutResult[];
      try {
        results = await runScouts(queries, {
          cwd: ctx.cwd,
          model,
          modelRegistry: ctx.modelRegistry as Parameters<typeof runScouts>[1]["modelRegistry"],
          systemPrompt: SCOUT_SYSTEM_PROMPT,
          signal: signal ?? undefined,
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[pancode:shadow] Scout run failed: ${msg}`);
        return textResult(`Shadow explore failed: ${msg}`);
      }

      const wallMs = Date.now() - startTime;
      const totalToolCalls = results.reduce((sum, r) => sum + r.toolCalls, 0);
      const errors = results.filter((r) => r.error);

      console.error(
        `[pancode:shadow] ${results.length} scouts completed in ${(wallMs / 1000).toFixed(1)}s (${totalToolCalls} tool calls${errors.length > 0 ? `, ${errors.length} errors` : ""})`,
      );

      // Build structured result for the orchestrator's context.
      // Each scout's findings are labeled so the orchestrator can synthesize.
      const sections: string[] = [];
      for (const r of results) {
        if (r.error) {
          sections.push(`[Scout: ${r.query}]\nError: ${r.error}`);
        } else {
          sections.push(`[Scout: ${r.query}]\n${r.response || "(no findings)"}`);
        }
      }

      const header = `${results.length} scout${results.length > 1 ? "s" : ""} completed in ${(wallMs / 1000).toFixed(1)}s (${totalToolCalls} tool calls)`;

      return textResult(`${header}\n\n${sections.join("\n\n")}`);
    },
  });
}
