import { defineExtension } from "../../engine/extensions";
import { PANCODE_HOME } from "../providers";
import { agentRegistry, loadAgentsFromYaml } from "./spec-registry";
import { registerShadowExplore } from "./shadow-explore";

export const extension = defineExtension((pi) => {
  // Register shadow_explore as an orchestrator-internal tool.
  // Shadow agents are not visible in /agents and are not part of the dispatch system.
  registerShadowExplore(pi.registerTool.bind(pi));

  pi.on("session_start", (_event, _ctx) => {
    const specs = loadAgentsFromYaml(PANCODE_HOME);
    for (const spec of specs) {
      if (!agentRegistry.has(spec.name)) {
        agentRegistry.register(spec);
      }
    }
  });

  pi.registerCommand("agents", {
    description: "List registered PanCode agent specs",
    async handler(_args, _ctx) {
      const specs = agentRegistry.getAll();
      const lines = specs.map((spec) => {
        const readonlyTag = spec.readonly ? " [readonly]" : "";
        const samplingTag = spec.sampling ? ` (sampling: ${spec.sampling})` : "";
        return `- ${spec.name}: ${spec.description}${readonlyTag}${samplingTag} (tools: ${spec.tools})`;
      });

      pi.sendMessage({
        customType: "pancode-panel",
        content: lines.length > 0 ? lines.join("\n") : "No agents registered.",
        display: true,
        details: { title: "PanCode Agents" },
      });
    },
  });
});
