import { defineExtension } from "../../engine/extensions";
import { PANCODE_HOME } from "../providers";
import { agentRegistry, loadAgentsFromYaml } from "./spec-registry";
import { registerShadowExplore } from "./shadow-explore";
import { discoverSkills, validateSkillTools, type SkillDefinition } from "./skills";

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

  pi.registerCommand("skills", {
    description: "Discover and inspect agent skills",
    async handler(args, ctx) {
      const parts = args.trim().split(/\s+/);
      const subcommand = parts[0]?.toLowerCase() || "list";
      const skills = discoverSkills(ctx.cwd);

      if (subcommand === "list" || !subcommand) {
        if (skills.length === 0) {
          pi.sendMessage({
            customType: "pancode-panel",
            content: "No skills discovered. Place SKILL.md or *.skill.md files in .pancode/skills/, .claude/, .codex/, or .gemini/",
            display: true,
            details: { title: "PanCode Skills" },
          });
          return;
        }

        const lines = skills.map((s: SkillDefinition) => {
          const tools = s.requiredTools.length > 0 ? ` (tools: ${s.requiredTools.join(", ")})` : "";
          const ver = s.version ? ` v${s.version}` : "";
          return `- ${s.name}${ver}: ${s.description}${tools}`;
        });

        pi.sendMessage({
          customType: "pancode-panel",
          content: [`${skills.length} skills discovered:`, "", ...lines].join("\n"),
          display: true,
          details: { title: "PanCode Skills" },
        });
        return;
      }

      if (subcommand === "show") {
        const name = parts[1];
        if (!name) {
          ctx.ui.notify("Usage: /skills show <name>", "error");
          return;
        }
        const skill = skills.find((s: SkillDefinition) => s.name === name);
        if (!skill) {
          ctx.ui.notify(`Skill not found: ${name}`, "error");
          return;
        }

        const lines = [
          `Name: ${skill.name}`,
          `Description: ${skill.description}`,
          `Version: ${skill.version ?? "unversioned"}`,
          `Source: ${skill.source}`,
          `Required tools: ${skill.requiredTools.join(", ") || "(none)"}`,
          "",
          skill.body || "(no body)",
        ];

        pi.sendMessage({
          customType: "pancode-panel",
          content: lines.join("\n"),
          display: true,
          details: { title: `Skill: ${skill.name}` },
        });
        return;
      }

      if (subcommand === "validate") {
        if (skills.length === 0) {
          ctx.ui.notify("No skills to validate.", "info");
          return;
        }

        const activeTools = pi.getActiveTools();
        const lines: string[] = [];
        let allValid = true;

        for (const skill of skills) {
          const missing = validateSkillTools(skill, activeTools);
          if (missing.length > 0) {
            lines.push(`  [FAIL] ${skill.name}: missing tools: ${missing.join(", ")}`);
            allValid = false;
          } else {
            lines.push(`  [OK]   ${skill.name}`);
          }
        }

        const header = allValid ? "All skills validated." : "Some skills have missing tools.";
        pi.sendMessage({
          customType: "pancode-panel",
          content: [header, "", ...lines].join("\n"),
          display: true,
          details: { title: "PanCode Skill Validation" },
        });
        return;
      }

      ctx.ui.notify(`Unknown skills subcommand: ${subcommand}. Use list, show <name>, or validate.`, "error");
    },
  });
});
