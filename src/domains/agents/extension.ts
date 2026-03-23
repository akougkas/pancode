import { BusChannel } from "../../core/bus-events";
import { PanMessageType } from "../../core/message-types";
import { sharedBus } from "../../core/shared-bus";
import { PiEvent } from "../../engine/events";
import { defineExtension } from "../../engine/extensions";
import { discoverAndRegisterRuntimes } from "../../engine/runtimes/discovery";
import { runtimeRegistry } from "../../engine/runtimes/registry";
import { PANCODE_HOME } from "../providers";
import { registerShadowExplore } from "./shadow-explore";
import { type SkillDefinition, discoverSkills, validateSkillTools } from "./skills";
import { agentRegistry, loadAgentsFromYaml } from "./spec-registry";

export const extension = defineExtension((pi) => {
  // Register shadow_explore as an orchestrator-internal tool.
  // Shadow agents are not visible in /agents and are not part of the dispatch system.
  registerShadowExplore(pi.registerTool.bind(pi));

  pi.on(PiEvent.SESSION_START, (_event, _ctx) => {
    // Discover and register runtimes before loading agents
    const discovery = discoverAndRegisterRuntimes();
    sharedBus.emit(BusChannel.RUNTIMES_DISCOVERED, discovery);

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
      if (specs.length === 0) {
        pi.sendMessage({
          customType: PanMessageType.PANEL,
          content: "No agents registered.",
          display: true,
          details: { title: "PanCode Agents" },
        });
        return;
      }

      // Table header
      const lines: string[] = [
        `${"AGENT".padEnd(16)} ${"MODEL".padEnd(30)} ${"SPEED".padEnd(10)} ${"AUTONOMY".padEnd(14)} ${"TAGS".padEnd(20)} ${"READONLY"}`,
        `${"-----".padEnd(16)} ${"-----".padEnd(30)} ${"-----".padEnd(10)} ${"--------".padEnd(14)} ${"----".padEnd(20)} ${"--------"}`,
      ];

      for (const spec of specs) {
        const agent = spec.name.padEnd(16);
        const modelName = spec.model ? (spec.model.split("/").pop() ?? spec.model) : "(provider)";
        const model = modelName.slice(0, 28).padEnd(30);
        const speed = spec.speed.padEnd(10);
        const autonomy = spec.autonomy.padEnd(14);
        const tags = (spec.tags.length > 0 ? spec.tags.join(", ") : "-").slice(0, 18).padEnd(20);
        const readonly = spec.readonly ? "yes" : "no";
        lines.push(`${agent} ${model} ${speed} ${autonomy} ${tags} ${readonly}`);
      }

      pi.sendMessage({
        customType: PanMessageType.PANEL,
        content: lines.join("\n"),
        display: true,
        details: { title: "PanCode Agents" },
      });
    },
  });

  pi.registerCommand("runtimes", {
    description: "List all registered agent runtimes with availability status",
    async handler(_args, _ctx) {
      const allRuntimes = runtimeRegistry.all();
      if (allRuntimes.length === 0) {
        pi.sendMessage({
          customType: PanMessageType.PANEL,
          content: "No runtimes registered. Run /agents to trigger discovery.",
          display: true,
          details: { title: "PanCode Runtimes" },
        });
        return;
      }

      const lines: string[] = [
        `${"RUNTIME".padEnd(20)} ${"TYPE".padEnd(9)} ${"TIER".padEnd(11)} ${"VERSION".padEnd(12)} ${"STATUS".padEnd(10)} BINARY`,
        `${"-------".padEnd(20)} ${"----".padEnd(9)} ${"----".padEnd(11)} ${"-------".padEnd(12)} ${"------".padEnd(10)} ------`,
      ];

      for (const rt of allRuntimes) {
        const id = rt.id.padEnd(20);
        const tier = rt.tier.padEnd(9);
        const telemetry = rt.telemetryTier.padEnd(11);
        const version = (rt.getVersion() ?? "-").padEnd(12);
        const available = rt.isAvailable();
        const status = (available ? "active" : "missing").padEnd(10);
        const binary = rt.tier === "native" ? "(built-in)" : ((rt as { binaryName?: string }).binaryName ?? "unknown");
        lines.push(`${id} ${tier} ${telemetry} ${version} ${status} ${binary}`);
      }

      pi.sendMessage({
        customType: PanMessageType.PANEL,
        content: lines.join("\n"),
        display: true,
        details: { title: "PanCode Runtimes" },
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
            customType: PanMessageType.PANEL,
            content:
              "No skills discovered. Place SKILL.md or *.skill.md files in .pancode/skills/, .claude/, .codex/, or .gemini/",
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
          customType: PanMessageType.PANEL,
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
          customType: PanMessageType.PANEL,
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
          customType: PanMessageType.PANEL,
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
