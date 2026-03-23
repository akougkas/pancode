import { Type } from "@sinclair/typebox";
import { getCurrentMode } from "../../core/modes";
import { ToolName } from "../../core/tool-names";
import { defineExtension } from "../../engine/extensions";
import type { AgentToolResult } from "../../engine/types";
import { configService } from "./config-service";

function textResult(text: string): AgentToolResult<unknown> {
  return { content: [{ type: "text", text }], details: undefined };
}

export const extension = defineExtension((pi) => {
  // -------------------------------------------------------------------------
  // pan_read_config: read configuration state (all modes)
  // -------------------------------------------------------------------------
  pi.registerTool({
    name: ToolName.PAN_READ_CONFIG,
    label: "Read Config",
    description:
      "Read PanCode configuration parameters. Returns current values, defaults, types, and descriptions. " +
      "Optionally filter by domain (runtime, models, budget, dispatch, preset).",
    parameters: Type.Object({
      domain: Type.Optional(
        Type.String({
          description:
            "Filter by config domain. Valid domains: runtime, models, budget, dispatch, preset. Omit to list all.",
        }),
      ),
    }),
    async execute(_id, params) {
      const params_ = configService.read(params.domain);
      if (params_.length === 0) {
        const msg = params.domain
          ? `No config params found for domain "${params.domain}".`
          : "No config params registered.";
        return textResult(msg);
      }
      return textResult(JSON.stringify(params_, null, 2));
    },
  });

  // -------------------------------------------------------------------------
  // pan_apply_config: apply a config change (mode-gated for adminOnly)
  // -------------------------------------------------------------------------
  pi.registerTool({
    name: ToolName.PAN_APPLY_CONFIG,
    label: "Apply Config",
    description:
      "Apply a PanCode configuration change. Validates the value against the param's type and options. " +
      "Admin-only params (dispatch.timeout, dispatch.maxDepth, dispatch.concurrency) require Admin mode.",
    parameters: Type.Object({
      key: Type.String({ description: "Config param key (e.g. runtime.safety, models.worker, budget.ceiling)." }),
      value: Type.Union([Type.String(), Type.Number(), Type.Boolean()], {
        description: "New value for the param.",
      }),
    }),
    async execute(_id, params) {
      // Check admin gating before applying
      const param = configService.get(params.key);
      if (param?.adminOnly) {
        const mode = getCurrentMode();
        if (mode !== "admin") {
          return textResult(
            `Parameter "${params.key}" requires Admin mode. Current mode: ${mode}. Switch to Admin mode (Alt+A) before changing this parameter.`,
          );
        }
      }

      const result = configService.apply(params.key, params.value);
      return textResult(JSON.stringify(result, null, 2));
    },
  });
});
