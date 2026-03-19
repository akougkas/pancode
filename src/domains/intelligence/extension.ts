import { defineExtension } from "../../engine/extensions";
import { rulesUpgrade } from "./rules-upgrade";

export const extension = defineExtension((pi) => {
  // Intelligence domain is opt-in. Set PANCODE_INTELLIGENCE=enabled to activate.
  // When not enabled, no listeners are registered and this domain is inert.
  if (process.env.PANCODE_INTELLIGENCE !== "enabled") return;

  pi.on("session_start", (_event, _ctx) => {
    rulesUpgrade.enable();
  });

  // Observe dispatch tool completions for learning.
  pi.on("tool_execution_end", (event, _ctx) => {
    if (event.toolName !== "dispatch_agent" && event.toolName !== "batch_dispatch") return;
    // Record outcome for future rules upgrade.
  });
});
