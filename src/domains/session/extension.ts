import { join } from "node:path";
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
  });

  pi.on("session_shutdown", async () => {
    if (sharedBoard) sharedBoard.persist();
    console.error("[pancode:session] Session shutdown. Board persisted.");
  });
});
