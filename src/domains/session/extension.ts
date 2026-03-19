import { join } from "node:path";
import { PANCODE_PRODUCT_NAME } from "../../core/shell-metadata";
import { sharedBus } from "../../core/shared-bus";
import { defineExtension } from "../../engine/extensions";
import { createContextRegistry } from "./context-registry";
import { createSharedBoard } from "./shared-board";
import { createSessionMemory } from "./memory";

// Module-level singletons accessible by other domains via barrel export.
let contextRegistry: ReturnType<typeof createContextRegistry> | null = null;
let sharedBoard: ReturnType<typeof createSharedBoard> | null = null;
let sessionMemory: ReturnType<typeof createSessionMemory> | null = null;

export function getContextRegistry() {
  return contextRegistry;
}
export function getSharedBoard() {
  return sharedBoard;
}
export function getSessionMemory() {
  return sessionMemory;
}

function resetCoordinationState(): void {
  contextRegistry?.clear();
  sharedBoard?.clear();
  sessionMemory?.temporal.clear();
  console.error("[pancode:session] Coordination state reset.");
}

export const extension = defineExtension((pi) => {
  pi.on("session_start", (_event, _ctx) => {
    const runtimeRoot = process.env.PANCODE_RUNTIME_ROOT
      ?? join(process.env.PANCODE_PACKAGE_ROOT ?? process.cwd(), ".pancode", "runtime");
    contextRegistry = createContextRegistry(runtimeRoot);
    sharedBoard = createSharedBoard(runtimeRoot);
    sessionMemory = createSessionMemory(runtimeRoot, contextRegistry);
    console.error(
      `[pancode:session] Coordination ready. Context: ${contextRegistry.size()} entries, Board: ${sharedBoard.size()} entries`,
    );

    // Listen for session reset events from shell-overrides (/new command).
    sharedBus.on("pancode:session-reset", () => {
      resetCoordinationState();
    });

    // Listen for compaction events to prune stale context entries.
    sharedBus.on("pancode:compaction-started", () => {
      if (contextRegistry && contextRegistry.size() > 0) {
        console.error(`[pancode:session] Compaction: context registry has ${contextRegistry.size()} entries (preserved).`);
      }
    });
  });

  pi.on("session_shutdown", async () => {
    if (sharedBoard) sharedBoard.persist();
    console.error("[pancode:session] Session shutdown. Board persisted.");
  });

  // === /session: Show Pi session info + PanCode domain state summary ===
  pi.registerCommand("session", {
    description: "Show session info with PanCode state summary",
    async handler(_args, ctx) {
      const lines: string[] = [
        `${PANCODE_PRODUCT_NAME} Session`,
        "",
      ];

      // Pi session info
      const sessionFile = ctx.sessionManager.getSessionFile();
      if (sessionFile) {
        lines.push(`Session file: ${sessionFile}`);
      }
      const sessionId = ctx.sessionManager.getSessionId();
      if (sessionId) {
        lines.push(`Session ID: ${sessionId}`);
      }
      const sessionName = ctx.sessionManager.getSessionName();
      if (sessionName) {
        lines.push(`Session name: ${sessionName}`);
      }
      const branch = ctx.sessionManager.getBranch();
      lines.push(`Branch depth: ${branch.length} entries`);

      // Context usage
      const usage = ctx.getContextUsage?.();
      if (usage && usage.tokens !== null) {
        const pct = usage.contextWindow ? Math.round((usage.tokens / usage.contextWindow) * 100) : null;
        const pctStr = pct !== null ? ` (${pct}%)` : "";
        lines.push(`Context tokens: ${usage.tokens}${pctStr}`);
      }

      // Model
      if (ctx.model) {
        lines.push(`Model: ${ctx.model.provider}/${ctx.model.id}`);
      }

      // PanCode domain state
      lines.push("");
      lines.push("Coordination:");
      lines.push(`  Context registry: ${contextRegistry?.size() ?? 0} entries`);
      lines.push(`  Shared board: ${sharedBoard?.size() ?? 0} entries`);
      const temporalCount = sessionMemory?.temporal.getAll().length ?? 0;
      const persistentCount = sessionMemory?.persistent.getAll().length ?? 0;
      lines.push(`  Memory: ${temporalCount} temporal, ${persistentCount} persistent`);

      pi.sendMessage({
        customType: "pancode-panel",
        content: lines.join("\n"),
        display: true,
        details: { title: `${PANCODE_PRODUCT_NAME} Session` },
      });
    },
  });

  // === /checkpoint: Mark a lightweight session checkpoint ===
  pi.registerCommand("checkpoint", {
    description: "Mark a session checkpoint",
    async handler(args, ctx) {
      const label = args.trim() || `checkpoint-${Date.now()}`;
      pi.appendEntry("pancode-checkpoint", { label, timestamp: new Date().toISOString() });
      ctx.ui.notify(`Checkpoint marked: ${label}`, "info");
      console.error(`[pancode:session] Checkpoint: ${label}`);
    },
  });

  // === /context: Show the cross-agent context registry ===
  pi.registerCommand("context", {
    description: "Show the cross-agent context registry",
    async handler(args, _ctx) {
      if (!contextRegistry) {
        pi.sendMessage({
          customType: "pancode-panel",
          content: "Context registry not initialized.",
          display: true,
          details: { title: `${PANCODE_PRODUCT_NAME} Context` },
        });
        return;
      }

      const entries = contextRegistry.getAll();
      if (entries.length === 0) {
        pi.sendMessage({
          customType: "pancode-panel",
          content: "Context registry is empty.",
          display: true,
          details: { title: `${PANCODE_PRODUCT_NAME} Context` },
        });
        return;
      }

      const filter = args.trim();
      const filtered = filter
        ? entries.filter((e) => e.source.includes(filter) || e.key.includes(filter))
        : entries;

      const lines: string[] = [`${filtered.length} entries${filter ? ` (filter: ${filter})` : ""}:`, ""];
      for (const entry of filtered.slice(-20)) {
        const preview = entry.value.length > 60 ? `${entry.value.slice(0, 57)}...` : entry.value;
        lines.push(`  [${entry.source}] ${entry.key}: ${preview}`);
      }

      if (filtered.length > 20) {
        lines.push(`  ... and ${filtered.length - 20} more`);
      }

      pi.sendMessage({
        customType: "pancode-panel",
        content: lines.join("\n"),
        display: true,
        details: { title: `${PANCODE_PRODUCT_NAME} Context` },
      });
    },
  });

  // === /reset: Reset coordination state (board, registry, temporal memory) ===
  pi.registerCommand("reset", {
    description: "Reset coordination state (board, registry)",
    async handler(_args, ctx) {
      resetCoordinationState();
      sharedBus.emit("pancode:session-reset", {});
      ctx.ui.notify("Coordination state reset. Context registry, shared board, and temporal memory cleared.", "info");
    },
  });
});
