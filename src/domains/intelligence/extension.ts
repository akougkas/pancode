import { ToolName } from "../../core/tool-names";
import { PiEvent } from "../../engine/events";
import { defineExtension } from "../../engine/extensions";
import { rulesUpgrade } from "./rules-upgrade";

export const extension = defineExtension((pi) => {
  // Intelligence domain is opt-in. Set PANCODE_INTELLIGENCE=enabled to activate.
  // When not enabled, no listeners are registered and this domain is inert.
  if (process.env.PANCODE_INTELLIGENCE !== "enabled") return;

  pi.on(PiEvent.SESSION_START, (_event, _ctx) => {
    rulesUpgrade.enable();
  });

  // Observe dispatch tool completions for learning.
  pi.on(PiEvent.TOOL_EXECUTION_END, (event, _ctx) => {
    if (event.toolName !== ToolName.DISPATCH_AGENT && event.toolName !== ToolName.BATCH_DISPATCH) return;
    // Record outcome for future rules upgrade.
  });
});
