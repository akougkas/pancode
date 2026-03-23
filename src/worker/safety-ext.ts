// Worker safety extension loaded by Pi SDK via --extension flag.
// This file runs inside the pi subprocess, NOT inside PanCode's engine boundary.
// It imports from @pancode/pi-coding-agent directly (allowlisted in check-boundaries).
// It does NOT import from src/domains/ or src/engine/.

import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
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
  const tmpPath = `${filePath}.tmp.${process.pid}.${Date.now()}`;
  writeFileSync(tmpPath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
  renameSync(tmpPath, filePath);
}

const LOCK_SLEEP_BUFFER = new SharedArrayBuffer(4);
const LOCK_SLEEP_VIEW = new Int32Array(LOCK_SLEEP_BUFFER);

function sleepSync(ms: number): void {
  Atomics.wait(LOCK_SLEEP_VIEW, 0, 0, ms);
}

function withFileLock<T>(filePath: string, fn: () => T, timeoutMs = 2000): T {
  mkdirSync(dirname(filePath), { recursive: true });
  const lockPath = `${filePath}.lock`;
  const deadline = Date.now() + timeoutMs;

  for (;;) {
    try {
      mkdirSync(lockPath);
      break;
    } catch (error) {
      const err = error as NodeJS.ErrnoException;
      if (err.code !== "EEXIST") throw error;
      if (Date.now() >= deadline) {
        throw new Error(`Timed out acquiring file lock for ${filePath}`);
      }
      sleepSync(10);
    }
  }

  try {
    return fn();
  } finally {
    rmSync(lockPath, { recursive: true, force: true });
  }
}

// Worker-local policy matrix. Mirrors DEFAULT_MODE_POLICIES from src/domains/safety/scope.ts.
// Duplicated here because worker/ cannot import from domains/ (isolation boundary).
type ActionClass =
  | "file_read"
  | "file_write"
  | "file_delete"
  | "bash_exec"
  | "bash_destructive"
  | "git_push"
  | "git_destructive"
  | "network"
  | "agent_dispatch"
  | "system_modify";

type SafetyTier = "block" | "allow";

const WORKER_POLICY: Record<string, Record<ActionClass, SafetyTier>> = {
  suggest: {
    file_read: "allow",
    file_write: "block",
    file_delete: "block",
    bash_exec: "block",
    bash_destructive: "block",
    git_push: "block",
    git_destructive: "block",
    network: "allow",
    agent_dispatch: "block",
    system_modify: "block",
  },
  "auto-edit": {
    file_read: "allow",
    file_write: "allow",
    file_delete: "block",
    bash_exec: "allow",
    bash_destructive: "block",
    git_push: "block",
    git_destructive: "block",
    network: "allow",
    agent_dispatch: "allow",
    system_modify: "block",
  },
  "full-auto": {
    file_read: "allow",
    file_write: "allow",
    file_delete: "allow",
    bash_exec: "allow",
    bash_destructive: "allow",
    git_push: "allow",
    git_destructive: "block",
    network: "allow",
    agent_dispatch: "allow",
    system_modify: "block",
  },
};

const TOOL_ACTION_MAP: Record<string, ActionClass> = {
  read: "file_read",
  grep: "file_read",
  find: "file_read",
  ls: "file_read",
  glob: "file_read",
  write: "file_write",
  edit: "file_write",
  notebook_edit: "file_write",
  bash: "bash_exec",
  shell: "bash_exec",
  web_fetch: "network",
  web_search: "network",
};

const DESTRUCTIVE_BASH_PATTERNS = [
  /rm\s+(-rf|-fr|--force)/,
  /git\s+reset\s+--hard/,
  /git\s+push\s+.*--force/,
  /git\s+clean\s+-[dfx]/,
  /chmod\s+777/,
  /sudo\s/,
];

function classifyWorkerBashCommand(command: string): ActionClass {
  for (const pattern of DESTRUCTIVE_BASH_PATTERNS) {
    if (pattern.test(command)) return "bash_destructive";
  }
  if (/git\s+push/.test(command)) return "git_push";
  if (/git\s+(reset|rebase|cherry-pick|merge)/.test(command)) return "git_destructive";
  if (/rm\s/.test(command)) return "file_delete";
  return "bash_exec";
}

function isWorkerActionAllowed(mode: string, action: ActionClass): boolean {
  const policy = WORKER_POLICY[mode];
  if (!policy) return false;
  return policy[action] === "allow";
}

const safetyExtension: ExtensionFactory = (pi) => {
  const autonomyMode = process.env.PANCODE_SAFETY ?? "auto-edit";

  // Safety gating: enforce full policy matrix on tool calls.
  // Workers inherit the orchestrator's autonomy mode and cannot exceed it.
  pi.on("tool_call", (event: ToolCallEvent): { block?: boolean; reason?: string } | undefined => {
    const toolName = event.toolName.toLowerCase().replace(/-/g, "_");
    const actionClass = TOOL_ACTION_MAP[toolName] ?? "file_read";

    // Check base action class against policy
    if (!isWorkerActionAllowed(autonomyMode, actionClass)) {
      return {
        block: true,
        reason: `[pancode:worker-safety] Safety level "${autonomyMode}" blocks ${actionClass}`,
      };
    }

    // Elevated classification for bash/shell commands
    if (toolName === "bash" || toolName === "shell") {
      const input = event.input as Record<string, unknown>;
      const command = typeof input?.command === "string" ? input.command : "";
      if (command) {
        const bashAction = classifyWorkerBashCommand(command);
        if (!isWorkerActionAllowed(autonomyMode, bashAction)) {
          return {
            block: true,
            reason: `[pancode:worker-safety] Safety level "${autonomyMode}" blocks ${bashAction}`,
          };
        }
      }
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
        withFileLock(boardFile, () => {
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
        });
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
        withFileLock(contextFile, () => {
          const ctx = readJsonFile<ContextData>(contextFile, {});
          ctx[params.key] = {
            value: params.value,
            source: agentName,
            timestamp: new Date().toISOString(),
          };
          atomicWriteJson(contextFile, ctx);
        });
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
