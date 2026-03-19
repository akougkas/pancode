// Worker safety extension loaded by Pi SDK via --extension flag.
// This file runs inside the pi subprocess, NOT inside PanCode's engine boundary.
// It imports from @pancode/pi-coding-agent directly (allowlisted in check-boundaries).
// It does NOT import from src/domains/ or src/engine/.

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { ExtensionFactory, ToolCallEvent } from "@pancode/pi-coding-agent";
import { Type } from "@sinclair/typebox";

interface BoardEntry {
  value: string;
  source: string;
  timestamp: string;
}

interface BoardData {
  [namespace: string]: {
    [key: string]: BoardEntry;
  };
}

interface ContextEntry {
  value: string;
  source: string;
  timestamp: string;
}

interface ContextData {
  [key: string]: ContextEntry;
}

function readJsonFile<T>(filePath: string, fallback: T): T {
  if (!existsSync(filePath)) return fallback;
  try {
    return JSON.parse(readFileSync(filePath, "utf8")) as T;
  } catch {
    return fallback;
  }
}

// Local atomic write implementation. Cannot import from src/core/config-writer.ts
// because this file runs inside the Pi subprocess, not the PanCode process.
// Uses the same write-tmp-then-rename pattern for filesystem-level atomicity.
function atomicWriteJson(filePath: string, data: unknown): void {
  const dir = dirname(filePath);
  mkdirSync(dir, { recursive: true });
  const tmpPath = `${filePath}.tmp.${process.pid}`;
  writeFileSync(tmpPath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
  renameSync(tmpPath, filePath);
}

const safetyExtension: ExtensionFactory = (pi) => {
  const autonomyMode = process.env.PANCODE_SAFETY ?? "auto-edit";

  // Safety gating: enforce autonomy mode on tool calls
  pi.on("tool_call", (event: ToolCallEvent): { block?: boolean; reason?: string } | void => {
    const toolName = event.toolName.toLowerCase().replace(/-/g, "_");

    const READ_TOOLS = new Set(["read", "grep", "find", "ls", "glob"]);
    const WRITE_TOOLS = new Set(["write", "edit", "notebook_edit"]);
    const EXECUTE_TOOLS = new Set(["bash", "shell"]);

    let actionClass = "unknown";
    if (READ_TOOLS.has(toolName)) actionClass = "read";
    else if (WRITE_TOOLS.has(toolName)) actionClass = "write";
    else if (EXECUTE_TOOLS.has(toolName)) actionClass = "execute";

    if (autonomyMode === "suggest" && (actionClass === "write" || actionClass === "execute")) {
      return { block: true, reason: `[pancode:worker-safety] ${actionClass} blocked in suggest mode` };
    }

    return undefined;
  });

  // Coordination tools: register only if env vars are present
  const boardFile = process.env.PANCODE_BOARD_FILE || "";
  const contextFile = process.env.PANCODE_CONTEXT_FILE || "";
  const agentName = process.env.PANCODE_AGENT_NAME ?? "unknown";

  if (boardFile) {
    pi.registerTool({
      name: "board_read",
      label: "Board Read",
      description:
        "Read entries from the shared coordination board. " +
        "If key is provided, reads a specific entry. " +
        "If only namespace is provided, reads all entries in that namespace. " +
        "If neither, reads all board entries.",
      parameters: Type.Object({
        namespace: Type.Optional(Type.String({ description: "Board namespace to read from" })),
        key: Type.Optional(Type.String({ description: "Specific key to read within the namespace" })),
      }),
      execute: async (_callId, params) => {
        const board = readJsonFile<BoardData>(boardFile, {});

        if (params.key && params.namespace) {
          const entry = board[params.namespace]?.[params.key];
          return {
            content: [{ type: "text", text: entry ? JSON.stringify(entry, null, 2) : "Not found" }],
            details: undefined,
          };
        }

        if (params.namespace) {
          const ns = board[params.namespace] ?? {};
          return {
            content: [{ type: "text", text: JSON.stringify(ns, null, 2) }],
            details: undefined,
          };
        }

        return {
          content: [{ type: "text", text: JSON.stringify(board, null, 2) }],
          details: undefined,
        };
      },
    });

    pi.registerTool({
      name: "board_write",
      label: "Board Write",
      description: "Write an entry to the shared coordination board under a namespace and key.",
      parameters: Type.Object({
        namespace: Type.String({ description: "Board namespace" }),
        key: Type.String({ description: "Entry key within the namespace" }),
        value: Type.String({ description: "Value to store" }),
      }),
      execute: async (_callId, params) => {
        const board = readJsonFile<BoardData>(boardFile, {});
        if (!board[params.namespace]) {
          board[params.namespace] = {};
        }
        board[params.namespace][params.key] = {
          value: params.value,
          source: agentName,
          timestamp: new Date().toISOString(),
        };
        atomicWriteJson(boardFile, board);
        return {
          content: [{ type: "text", text: `Board updated: ${params.namespace}/${params.key}` }],
          details: undefined,
        };
      },
    });
  }

  if (contextFile) {
    pi.registerTool({
      name: "report_context",
      label: "Report Context",
      description: "Report a context entry (key/value) visible to all agents in this dispatch.",
      parameters: Type.Object({
        key: Type.String({ description: "Context key" }),
        value: Type.String({ description: "Context value to report" }),
      }),
      execute: async (_callId, params) => {
        const ctx = readJsonFile<ContextData>(contextFile, {});
        ctx[params.key] = {
          value: params.value,
          source: agentName,
          timestamp: new Date().toISOString(),
        };
        atomicWriteJson(contextFile, ctx);
        return {
          content: [{ type: "text", text: `Context reported: ${params.key}` }],
          details: undefined,
        };
      },
    });

    pi.registerTool({
      name: "read_context",
      label: "Read Context",
      description:
        "Read context entries reported by agents in this dispatch. " +
        "If key is provided, reads that specific entry. Otherwise reads all entries.",
      parameters: Type.Object({
        key: Type.Optional(Type.String({ description: "Specific context key to read" })),
      }),
      execute: async (_callId, params) => {
        const ctx = readJsonFile<ContextData>(contextFile, {});

        if (params.key) {
          const entry = ctx[params.key];
          return {
            content: [{ type: "text", text: entry ? JSON.stringify(entry, null, 2) : "Not found" }],
            details: undefined,
          };
        }

        return {
          content: [{ type: "text", text: JSON.stringify(ctx, null, 2) }],
          details: undefined,
        };
      },
    });
  }

  // Log that worker safety extension loaded
  console.error(`[pancode:worker-safety] loaded (mode=${autonomyMode}, agent=${agentName})`);
};

export default safetyExtension;
