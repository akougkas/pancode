import "../chunk-DGUM43GV.js";

// src/worker/safety-ext.ts
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "fs";
import { dirname } from "path";
import { Type } from "@sinclair/typebox";
function readJsonFile(filePath, fallback) {
  if (!existsSync(filePath)) return fallback;
  try {
    return JSON.parse(readFileSync(filePath, "utf8"));
  } catch {
    return fallback;
  }
}
function atomicWriteJson(filePath, data) {
  const dir = dirname(filePath);
  mkdirSync(dir, { recursive: true });
  const tmpPath = `${filePath}.tmp.${process.pid}`;
  writeFileSync(tmpPath, `${JSON.stringify(data, null, 2)}
`, "utf8");
  renameSync(tmpPath, filePath);
}
var safetyExtension = (pi) => {
  const autonomyMode = process.env.PANCODE_SAFETY ?? "auto-edit";
  pi.on("tool_call", (event) => {
    const toolName = event.toolName.toLowerCase().replace(/-/g, "_");
    const READ_TOOLS = /* @__PURE__ */ new Set(["read", "grep", "find", "ls", "glob"]);
    const WRITE_TOOLS = /* @__PURE__ */ new Set(["write", "edit", "notebook_edit"]);
    const EXECUTE_TOOLS = /* @__PURE__ */ new Set(["bash", "shell"]);
    let actionClass = "unknown";
    if (READ_TOOLS.has(toolName)) actionClass = "read";
    else if (WRITE_TOOLS.has(toolName)) actionClass = "write";
    else if (EXECUTE_TOOLS.has(toolName)) actionClass = "execute";
    if (autonomyMode === "suggest" && (actionClass === "write" || actionClass === "execute")) {
      return { block: true, reason: `[pancode:worker-safety] ${actionClass} blocked in suggest mode` };
    }
    return void 0;
  });
  const boardFile = process.env.PANCODE_BOARD_FILE || "";
  const contextFile = process.env.PANCODE_CONTEXT_FILE || "";
  const agentName = process.env.PANCODE_AGENT_NAME ?? "unknown";
  if (boardFile) {
    pi.registerTool({
      name: "board_read",
      label: "Board Read",
      description: "Read entries from the shared coordination board. If key is provided, reads a specific entry. If only namespace is provided, reads all entries in that namespace. If neither, reads all board entries.",
      parameters: Type.Object({
        namespace: Type.Optional(Type.String({ description: "Board namespace to read from" })),
        key: Type.Optional(Type.String({ description: "Specific key to read within the namespace" }))
      }),
      execute: async (_callId, params) => {
        const board = readJsonFile(boardFile, {});
        if (params.key && params.namespace) {
          const entry = board[params.namespace]?.[params.key];
          return {
            content: [{ type: "text", text: entry ? JSON.stringify(entry, null, 2) : "Not found" }],
            details: void 0
          };
        }
        if (params.namespace) {
          const ns = board[params.namespace] ?? {};
          return {
            content: [{ type: "text", text: JSON.stringify(ns, null, 2) }],
            details: void 0
          };
        }
        return {
          content: [{ type: "text", text: JSON.stringify(board, null, 2) }],
          details: void 0
        };
      }
    });
    pi.registerTool({
      name: "board_write",
      label: "Board Write",
      description: "Write an entry to the shared coordination board under a namespace and key.",
      parameters: Type.Object({
        namespace: Type.String({ description: "Board namespace" }),
        key: Type.String({ description: "Entry key within the namespace" }),
        value: Type.String({ description: "Value to store" })
      }),
      execute: async (_callId, params) => {
        const board = readJsonFile(boardFile, {});
        if (!board[params.namespace]) {
          board[params.namespace] = {};
        }
        board[params.namespace][params.key] = {
          value: params.value,
          source: agentName,
          timestamp: (/* @__PURE__ */ new Date()).toISOString()
        };
        atomicWriteJson(boardFile, board);
        return {
          content: [{ type: "text", text: `Board updated: ${params.namespace}/${params.key}` }],
          details: void 0
        };
      }
    });
  }
  if (contextFile) {
    pi.registerTool({
      name: "report_context",
      label: "Report Context",
      description: "Report a context entry (key/value) visible to all agents in this dispatch.",
      parameters: Type.Object({
        key: Type.String({ description: "Context key" }),
        value: Type.String({ description: "Context value to report" })
      }),
      execute: async (_callId, params) => {
        const ctx = readJsonFile(contextFile, {});
        ctx[params.key] = {
          value: params.value,
          source: agentName,
          timestamp: (/* @__PURE__ */ new Date()).toISOString()
        };
        atomicWriteJson(contextFile, ctx);
        return {
          content: [{ type: "text", text: `Context reported: ${params.key}` }],
          details: void 0
        };
      }
    });
    pi.registerTool({
      name: "read_context",
      label: "Read Context",
      description: "Read context entries reported by agents in this dispatch. If key is provided, reads that specific entry. Otherwise reads all entries.",
      parameters: Type.Object({
        key: Type.Optional(Type.String({ description: "Specific context key to read" }))
      }),
      execute: async (_callId, params) => {
        const ctx = readJsonFile(contextFile, {});
        if (params.key) {
          const entry = ctx[params.key];
          return {
            content: [{ type: "text", text: entry ? JSON.stringify(entry, null, 2) : "Not found" }],
            details: void 0
          };
        }
        return {
          content: [{ type: "text", text: JSON.stringify(ctx, null, 2) }],
          details: void 0
        };
      }
    });
  }
  console.error(`[pancode:worker-safety] loaded (mode=${autonomyMode}, agent=${agentName})`);
};
var safety_ext_default = safetyExtension;
export {
  safety_ext_default as default
};
//# sourceMappingURL=safety-ext.js.map