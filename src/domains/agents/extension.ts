import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import YAML from "yaml";
import { BusChannel } from "../../core/bus-events";
import { PanMessageType } from "../../core/message-types";
import { sharedBus } from "../../core/shared-bus";
import { PiEvent } from "../../engine/events";
import { defineExtension } from "../../engine/extensions";
import { discoverAndRegisterRuntimes } from "../../engine/runtimes/discovery";
import { runtimeRegistry } from "../../engine/runtimes/registry";
import { PANCODE_HOME, getModelProfileCache } from "../providers";
import { registerShadowExplore } from "./shadow-explore";
import { type SkillDefinition, discoverSkills, validateSkillTools } from "./skills";
import { agentRegistry, loadAgentsFromYaml } from "./spec-registry";
import { workerPool } from "./worker-pool";

/** Runtime ID to suggested agent name mapping for auto-suggest. */
const RUNTIME_AGENT_SUGGESTIONS: Record<string, { name: string; description: string }> = {
  "cli:claude-code": { name: "claude-reviewer", description: "Claude Code for code review" },
  "cli:codex": { name: "codex-dev", description: "Codex for development tasks" },
  "cli:gemini": { name: "gemini-reviewer", description: "Gemini CLI for code review" },
  "cli:opencode": { name: "opencode-scout", description: "opencode for codebase exploration" },
  "cli:cline": { name: "cline-planner", description: "Cline CLI for planning" },
  "cli:copilot-cli": { name: "copilot-reviewer", description: "GitHub Copilot CLI for code review" },
};

function persistAgentChange(agentName: string, field: string, value: string): void {
  const filePath = join(PANCODE_HOME, "panagents.yaml");
  try {
    const content = readFileSync(filePath, "utf8");
    const doc = YAML.parseDocument(content);
    const agentsNode = doc.get("agents");
    if (agentsNode && typeof agentsNode === "object") {
      const agentNode = (agentsNode as YAML.YAMLMap).get(agentName);
      if (agentNode && typeof agentNode === "object") {
        (agentNode as YAML.YAMLMap).set(field, value);
      }
    }
    writeFileSync(filePath, doc.toString(), "utf8");
  } catch {
    console.error(`[pancode:agents] Failed to persist ${field} change for ${agentName}`);
  }
}

function suggestAgentsForUnconfiguredRuntimes(): void {
  const availableRuntimes = runtimeRegistry.available();
  const specs = agentRegistry.getAll();
  const assignedRuntimes = new Set(specs.map((s) => s.runtime));

  for (const rt of availableRuntimes) {
    // Skip the built-in pi runtime (always has default agents)
    if (rt.id === "pi") continue;
    if (assignedRuntimes.has(rt.id)) continue;

    const suggestion = RUNTIME_AGENT_SUGGESTIONS[rt.id];
    const agentName = suggestion?.name ?? `${rt.id.replace(/^cli:/, "")}-agent`;
    const description = suggestion?.description ?? `${rt.id} agent`;
    const version = rt.getVersion() ?? "unknown";

    console.error(
      `[pancode:agents] Discovered ${rt.id} (v${version}) with no matching agent.\n  Add to ~/.pancode/panagents.yaml:\n    ${agentName}:\n      runtime: ${rt.id}\n      description: "${description}"\n      readonly: true`,
    );
  }
}

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

    // Materialize the worker pool from specs x runtimes x models
    const allRuntimes = runtimeRegistry.all();
    const modelProfiles = getModelProfileCache();
    workerPool.materialize(agentRegistry.getAll(), allRuntimes, modelProfiles);

    // Suggest agent configs for discovered runtimes that no agent references
    suggestAgentsForUnconfiguredRuntimes();
  });

  pi.registerCommand("agents", {
    description: "List and configure PanCode agent specs",
    async handler(args, _ctx) {
      const parts = args.trim().split(/\s+/);

      // Handle /agents set <name> <field> <value>
      if (parts[0] === "set" && parts.length >= 4) {
        const agentName = parts[1];
        const field = parts[2];
        const value = parts.slice(3).join(" ");

        const spec = agentRegistry.get(agentName);
        if (!spec) {
          pi.sendMessage({
            customType: PanMessageType.PANEL,
            content: `Unknown agent: ${agentName}`,
            display: true,
            details: { title: "Error" },
          });
          return;
        }

        if (field === "runtime") {
          if (!runtimeRegistry.has(value)) {
            const available = runtimeRegistry
              .all()
              .map((r) => r.id)
              .join(", ");
            pi.sendMessage({
              customType: PanMessageType.PANEL,
              content: `Unknown runtime: ${value}\nAvailable: ${available}`,
              display: true,
              details: { title: "Error" },
            });
            return;
          }
          spec.runtime = value;
          persistAgentChange(agentName, "runtime", value);
          pi.sendMessage({
            customType: PanMessageType.PANEL,
            content: `${agentName}.runtime = ${value}`,
            display: true,
            details: { title: "Agent Updated" },
          });
          return;
        }

        if (field === "model") {
          spec.model = value || undefined;
          persistAgentChange(agentName, "model", value);
          pi.sendMessage({
            customType: PanMessageType.PANEL,
            content: `${agentName}.model = ${value || "(provider default)"}`,
            display: true,
            details: { title: "Agent Updated" },
          });
          return;
        }

        if (field === "tier") {
          if (!["frontier", "mid", "any"].includes(value)) {
            pi.sendMessage({
              customType: PanMessageType.PANEL,
              content: `Invalid tier: ${value}. Use frontier, mid, or any.`,
              display: true,
              details: { title: "Error" },
            });
            return;
          }
          spec.tier = value as "frontier" | "mid" | "any";
          persistAgentChange(agentName, "tier", value);
          pi.sendMessage({
            customType: PanMessageType.PANEL,
            content: `${agentName}.tier = ${value}`,
            display: true,
            details: { title: "Agent Updated" },
          });
          return;
        }

        pi.sendMessage({
          customType: PanMessageType.PANEL,
          content: `Unknown field: ${field}. Use runtime, model, or tier.`,
          display: true,
          details: { title: "Error" },
        });
        return;
      }

      // List agents
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

      // Table header (fits 90-column terminals)
      const lines: string[] = [
        `${"AGENT".padEnd(16)} ${"RUNTIME".padEnd(18)} ${"MODEL".padEnd(16)} ${"TIER".padEnd(10)} ${"READONLY"}`,
        `${"-----".padEnd(16)} ${"-------".padEnd(18)} ${"-----".padEnd(16)} ${"----".padEnd(10)} ${"--------"}`,
      ];

      for (const spec of specs) {
        const agent = spec.name.padEnd(16);
        const runtime = spec.runtime.padEnd(18);
        const modelName = spec.model ? (spec.model.split("/").pop() ?? spec.model) : "(provider)";
        const model = modelName.slice(0, 14).padEnd(16);
        const tier = spec.tier.padEnd(10);
        const readonly = spec.readonly ? "yes" : "no";
        lines.push(`${agent} ${runtime} ${model} ${tier} ${readonly}`);
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

  pi.registerCommand("workers", {
    description: "Show the PanCode worker pool with scores",
    async handler(_args, _ctx) {
      const workers = workerPool.all();
      if (workers.length === 0) {
        pi.sendMessage({
          customType: PanMessageType.PANEL,
          content: "No workers materialized. Run /agents to trigger discovery.",
          display: true,
          details: { title: "PanCode Workers" },
        });
        return;
      }

      const lines: string[] = [
        `${"WORKER".padEnd(30)} ${"TIER".padEnd(10)} ${"AVAIL".padEnd(7)} ${"CAP".padEnd(7)} ${"LOAD".padEnd(7)} ${"SKILL".padEnd(7)} ${"COST".padEnd(7)} SCORE`,
        `${"------".padEnd(30)} ${"----".padEnd(10)} ${"-----".padEnd(7)} ${"---".padEnd(7)} ${"----".padEnd(7)} ${"-----".padEnd(7)} ${"----".padEnd(7)} -----`,
      ];

      for (const w of workers) {
        const id = w.id.padEnd(30);
        const tier = w.tier.padEnd(10);
        const avail = w.score.availability.toFixed(1).padEnd(7);
        const cap = w.score.capacity.toFixed(1).padEnd(7);
        const load = w.score.load.toFixed(1).padEnd(7);
        const skill = w.score.capability.toFixed(2).padEnd(7);
        const cost = w.score.cost.toFixed(1).padEnd(7);
        const overall = w.score.overall.toFixed(3);
        lines.push(`${id} ${tier} ${avail} ${cap} ${load} ${skill} ${cost} ${overall}`);
      }

      pi.sendMessage({
        customType: PanMessageType.PANEL,
        content: lines.join("\n"),
        display: true,
        details: { title: "PanCode Worker Pool" },
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
