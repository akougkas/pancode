import { join } from "node:path";
import { BusChannel } from "../../core/bus-events";
import { PanMessageType } from "../../core/message-types";
import { sharedBus } from "../../core/shared-bus";
import { PANCODE_PRODUCT_NAME } from "../../core/shell-metadata";
import { PiEvent } from "../../engine/events";
import { defineExtension } from "../../engine/extensions";
import { createContextRegistry } from "./context-registry";
import { createSessionMemory } from "./memory";
import { createSharedBoard } from "./shared-board";

// Pi SDK session JSONL files (~/.pi/agent/sessions/<encoded-cwd>/*.jsonl):
// The SDK has context compaction (auto-triggers when context window fills) that
// appends a CompactionEntry with a summary and firstKeptEntryId pointer. On
// reload, old messages are skipped via the summary. However, the physical JSONL
// file is append-only; compaction never removes entries from disk.
// Config: ~/.pi/agent/settings.json { compaction: { enabled, reserveTokens, keepRecentTokens } }
// controls when compaction triggers but does not affect file size.
// TODO: Implement periodic cleanup of old session files. Worker sessions are
// ephemeral and can be deleted after result extraction. Orchestrator sessions
// can be pruned by age (>7 days) or size. Use SessionManager.list() for
// enumeration. PI_CODING_AGENT_DIR overrides the default ~/.pi base path.

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

function resetCoordinationState(): { contextCleared: number; boardCleared: number; memoryCleared: number } {
  const contextCleared = contextRegistry?.size() ?? 0;
  const boardCleared = sharedBoard?.size() ?? 0;
  const memoryCleared = sessionMemory?.temporal.getAll().length ?? 0;
  contextRegistry?.clear();
  sharedBoard?.clear();
  sessionMemory?.temporal.clear();
  console.error("[pancode:session] Coordination state reset.");
  return { contextCleared, boardCleared, memoryCleared };
}

function emitPanel(title: string, lines: string[]): void {
  // Use a direct reference captured at registration time.
  // This helper is set by the extension factory below.
  _emitPanel(title, lines);
}

let _emitPanel: (title: string, lines: string[]) => void = () => {};

export const extension = defineExtension((pi) => {
  _emitPanel = (title: string, lines: string[]) => {
    pi.sendMessage({
      customType: PanMessageType.PANEL,
      content: lines.join("\n"),
      display: true,
      details: { title },
    });
  };

  pi.on(PiEvent.SESSION_START, (_event, _ctx) => {
    const runtimeRoot =
      process.env.PANCODE_RUNTIME_ROOT ?? join(process.env.PANCODE_PACKAGE_ROOT ?? process.cwd(), ".pancode", "state");
    contextRegistry = createContextRegistry(runtimeRoot);
    sharedBoard = createSharedBoard(runtimeRoot);
    sessionMemory = createSessionMemory(runtimeRoot, contextRegistry);

    // Sync board to pick up entries left by workers from a previous session.
    sharedBoard.sync();

    if (process.env.PANCODE_VERBOSE) {
      console.error(
        `[pancode:session] Coordination ready. Context: ${contextRegistry.size()} entries, Board: ${sharedBoard.size()} entries`,
      );
    }

    // Listen for session reset events from shell-overrides (/new command).
    sharedBus.on(BusChannel.SESSION_RESET, () => {
      resetCoordinationState();
    });

    // Listen for compaction events to prune stale context entries.
    sharedBus.on(BusChannel.COMPACTION_STARTED, () => {
      if (contextRegistry && contextRegistry.size() > 0) {
        console.error(
          `[pancode:session] Compaction: context registry has ${contextRegistry.size()} entries (preserved).`,
        );
      }
    });

    // Sync board after worker dispatch completes.
    sharedBus.on(BusChannel.RUN_FINISHED, () => {
      if (sharedBoard) {
        sharedBoard.sync();
      }
    });
  });

  pi.on(PiEvent.SESSION_SHUTDOWN, async () => {
    if (sharedBoard) sharedBoard.persist();
    if (process.env.PANCODE_VERBOSE) {
      console.error("[pancode:session] Session shutdown. Board persisted.");
    }
  });

  // === /session: Show Pi session info + PanCode domain state summary ===
  // NOTE: /session uses the same name as Pi's built-in session command.
  // This registration only works because shell-overrides.ts hides the Pi
  // built-in first. If shell-overrides fails, this registration is silently
  // skipped and Pi's native session display runs instead.
  pi.registerCommand("session", {
    description: "Show session info with PanCode state summary",
    async handler(_args, ctx) {
      const lines: string[] = [];

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
      const usage = ctx.getContextUsage();
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

      emitPanel(`${PANCODE_PRODUCT_NAME} Session`, lines);
    },
  });

  // === /checkpoint: Mark, list, or inspect session checkpoints ===
  pi.registerCommand("checkpoint", {
    description: "Mark a session checkpoint",
    async handler(args, ctx) {
      const parts = args.trim().split(/\s+/);
      const subcommand = parts[0]?.toLowerCase();

      // /checkpoint list: show all checkpoints from session entries
      if (subcommand === "list") {
        const entries = ctx.sessionManager.getEntries();
        interface CheckpointData {
          label?: string;
          timestamp?: string;
          contextEntries?: number;
          boardEntries?: number;
        }
        const checkpoints: Array<{ label: string; timestamp: string; data: CheckpointData }> = [];
        for (const entry of entries) {
          if (
            "customType" in entry &&
            (entry.customType === PanMessageType.CHECKPOINT || entry.customType === "pancode:checkpoint")
          ) {
            const data = ("data" in entry ? entry.data : undefined) as CheckpointData | undefined;
            checkpoints.push({
              label: data?.label ?? "(unlabeled)",
              timestamp: data?.timestamp ?? entry.timestamp ?? "unknown",
              data: data ?? {},
            });
          }
        }

        if (checkpoints.length === 0) {
          emitPanel(`${PANCODE_PRODUCT_NAME} Checkpoints`, ["No checkpoints recorded in this session."]);
          return;
        }

        const lines = checkpoints.map((cp, i) => {
          const ctxStr = cp.data.contextEntries !== undefined ? `, ctx: ${cp.data.contextEntries}` : "";
          const boardStr = cp.data.boardEntries !== undefined ? `, board: ${cp.data.boardEntries}` : "";
          return `  ${i + 1}. ${cp.label}  (${cp.timestamp}${ctxStr}${boardStr})`;
        });
        emitPanel(`${PANCODE_PRODUCT_NAME} Checkpoints`, [`${checkpoints.length} checkpoints:`, "", ...lines]);
        return;
      }

      // /checkpoint restore <id>: display checkpoint data (no auto-restore in Phase B)
      if (subcommand === "restore") {
        ctx.ui.notify(
          "Checkpoint restore is display-only in this version. Full restore is planned for a future release.",
          "warning",
        );
        return;
      }

      // Default: save a new checkpoint
      const label = args.trim() || `checkpoint-${Date.now()}`;
      const checkpointData = {
        label,
        timestamp: new Date().toISOString(),
        contextEntries: contextRegistry?.size() ?? 0,
        boardEntries: sharedBoard?.size() ?? 0,
        temporalMemory: sessionMemory?.temporal.getAll().length ?? 0,
        persistentMemory: sessionMemory?.persistent.getAll().length ?? 0,
        budgetSpent: process.env.PANCODE_BUDGET_SPENT ?? "0",
      };

      pi.appendEntry(PanMessageType.CHECKPOINT, checkpointData);
      ctx.ui.notify(`Checkpoint marked: ${label}`, "info");
      console.error(`[pancode:session] Checkpoint: ${label}`);
    },
  });

  // === /context: View the cross-agent context registry ===
  pi.registerCommand("context", {
    description: "View the PanCode context registry",
    async handler(args, _ctx) {
      if (!contextRegistry) {
        emitPanel(`${PANCODE_PRODUCT_NAME} Context`, ["Context registry not initialized."]);
        return;
      }

      const entries = contextRegistry.getAll();
      if (entries.length === 0) {
        emitPanel(`${PANCODE_PRODUCT_NAME} Context`, ["Context registry is empty."]);
        return;
      }

      const query = args.trim();

      // /context <key>: show full value for a specific key
      if (query && !query.includes(" ")) {
        const entry = contextRegistry.get(query);
        if (entry) {
          emitPanel(`${PANCODE_PRODUCT_NAME} Context`, [
            `Key: ${entry.key}`,
            `Source: ${entry.source}`,
            `Timestamp: ${entry.timestamp}`,
            "",
            entry.value,
          ]);
          return;
        }

        // Try as source filter
        const bySource = contextRegistry.getBySource(query);
        if (bySource.length > 0) {
          const lines: string[] = [`${bySource.length} entries from source "${query}":`, ""];
          for (const e of bySource) {
            const preview = e.value.length > 80 ? `${e.value.slice(0, 77)}...` : e.value;
            lines.push(`  ${e.key.padEnd(24)} ${e.source.padEnd(12)} ${preview}`);
          }
          emitPanel(`${PANCODE_PRODUCT_NAME} Context`, lines);
          return;
        }

        emitPanel(`${PANCODE_PRODUCT_NAME} Context`, [`No entry found for key or source: ${query}`]);
        return;
      }

      // Default: list all entries with table format
      const lines: string[] = [`${entries.length} entries:`, ""];
      lines.push(`  ${"KEY".padEnd(24)} ${"SOURCE".padEnd(12)} ${"TIMESTAMP".padEnd(24)} VALUE`);
      lines.push(`  ${"---".padEnd(24)} ${"------".padEnd(12)} ${"---".padEnd(24)} -----`);

      const shown = entries.slice(-20);
      for (const entry of shown) {
        const preview = entry.value.length > 40 ? `${entry.value.slice(0, 37)}...` : entry.value;
        const ts = entry.timestamp.slice(0, 19);
        lines.push(`  ${entry.key.padEnd(24)} ${entry.source.padEnd(12)} ${ts.padEnd(24)} ${preview}`);
      }

      if (entries.length > 20) {
        lines.push(`  ... and ${entries.length - 20} more. Use /context <key> for details.`);
      }

      emitPanel(`${PANCODE_PRODUCT_NAME} Context`, lines);
    },
  });

  // === /reset: Reset coordination state with subcommands ===
  pi.registerCommand("reset", {
    description: "Reset coordination state (board, registry)",
    async handler(args, ctx) {
      const subcommand = args.trim().toLowerCase();

      if (subcommand === "context") {
        // Clear context registry only, with confirmation
        if (!contextRegistry || contextRegistry.size() === 0) {
          ctx.ui.notify("Context registry is already empty.", "info");
          return;
        }
        const count = contextRegistry.size();
        const confirmed = await ctx.ui.confirm(
          "Reset Context Registry",
          `Clear all ${count} context entries? This cannot be undone.`,
        );
        if (!confirmed) {
          ctx.ui.notify("Reset cancelled.", "info");
          return;
        }
        contextRegistry.clear();
        ctx.ui.notify(`Context registry cleared. ${count} entries removed.`, "info");
        console.error(`[pancode:session] Context registry cleared: ${count} entries.`);
        return;
      }

      if (subcommand === "all") {
        // Clear everything with confirmation
        const ctxSize = contextRegistry?.size() ?? 0;
        const boardSize = sharedBoard?.size() ?? 0;
        const memSize = sessionMemory?.temporal.getAll().length ?? 0;
        const total = ctxSize + boardSize + memSize;

        if (total === 0) {
          ctx.ui.notify("All coordination stores are already empty.", "info");
          return;
        }

        const confirmed = await ctx.ui.confirm(
          "Reset All Coordination State",
          `Clear ${ctxSize} context + ${boardSize} board + ${memSize} temporal memory entries?`,
        );
        if (!confirmed) {
          ctx.ui.notify("Reset cancelled.", "info");
          return;
        }

        const cleared = resetCoordinationState();
        sharedBus.emit(BusChannel.SESSION_RESET, {});
        ctx.ui.notify(
          `All coordination state cleared. Context: ${cleared.contextCleared}, Board: ${cleared.boardCleared}, Memory: ${cleared.memoryCleared}`,
          "info",
        );
        return;
      }

      // Default (no args): clear board + temporal memory (non-destructive quick reset)
      const boardCount = sharedBoard?.size() ?? 0;
      const memCount = sessionMemory?.temporal.getAll().length ?? 0;
      sharedBoard?.clear();
      sessionMemory?.temporal.clear();
      sharedBus.emit(BusChannel.SESSION_RESET, {});
      ctx.ui.notify(
        `Board and temporal memory cleared. Board: ${boardCount}, Memory: ${memCount}. Context registry preserved (use /reset context or /reset all).`,
        "info",
      );
      console.error(`[pancode:session] Quick reset. Board: ${boardCount}, Memory: ${memCount}.`);
    },
  });
});
