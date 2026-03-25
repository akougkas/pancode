// PanPrompt engine extension.
// Registers prompt debugging and versioning commands for development iteration.

import { PanMessageType } from "../../core/message-types";
import { defineExtension } from "../../engine/extensions";
import { getLastOrchestratorCompilation } from "./orchestrator-compiler";
import { loadHistory, loadLatestManifest } from "./versioning";
import { getRecentWorkerCompilations } from "./worker-compiler";

function panel(
  pi: { sendMessage: (msg: { customType: string; content: string; display: boolean; details?: unknown }) => void },
  title: string,
  content: string,
): void {
  pi.sendMessage({
    customType: PanMessageType.PANEL,
    content,
    display: true,
    details: { title },
  });
}

export const extension = defineExtension((pi) => {
  pi.registerCommand("prompt-debug", {
    description: "Show the last compiled orchestrator prompt breakdown",
    async handler(_args, _ctx) {
      const compilation = getLastOrchestratorCompilation();
      if (!compilation) {
        panel(pi, "PanPrompt Debug", "No orchestrator prompt has been compiled yet.");
        return;
      }

      const lines: string[] = [
        "PanPrompt Debug: Last Orchestrator Compilation",
        "",
        `Tokens: ~${compilation.estimatedTokens}`,
        `Fragments: ${compilation.includedFragments.length} included, ${compilation.excludedFragments.length} excluded`,
        `Hash: ${compilation.hash.slice(0, 16)}`,
        `Compiled: ${compilation.compiledAt}`,
        "",
        "Included fragments:",
        ...compilation.includedFragments.map((id) => `  + ${id}`),
      ];

      if (compilation.excludedFragments.length > 0) {
        lines.push("", "Excluded fragments:");
        for (const id of compilation.excludedFragments) {
          lines.push(`  - ${id}`);
        }
      }

      lines.push("", "--- Compiled text preview (first 500 chars) ---", compilation.text.slice(0, 500));

      panel(pi, "PanPrompt Debug", lines.join("\n"));
    },
  });

  pi.registerCommand("prompt-version", {
    description: "Show prompt compilation version history",
    async handler(args, _ctx) {
      const runtimeRoot = process.env.PANCODE_RUNTIME_ROOT ?? ".pancode/state";

      if (args === "latest") {
        const orch = loadLatestManifest(runtimeRoot, "orchestrator");
        const worker = loadLatestManifest(runtimeRoot, "worker");
        const scout = loadLatestManifest(runtimeRoot, "scout");
        const lines: string[] = ["Latest prompt manifests:", ""];
        for (const [label, manifest] of [
          ["Orchestrator", orch],
          ["Worker", worker],
          ["Scout", scout],
        ] as const) {
          if (manifest) {
            lines.push(
              `${label}: ${manifest.fragmentIds.length} fragments, ~${manifest.estimatedTokens} tokens, ${manifest.hash.slice(0, 12)}`,
            );
          } else {
            lines.push(`${label}: no manifest recorded`);
          }
        }
        panel(pi, "Prompt Versions", lines.join("\n"));
        return;
      }

      const count = Number.parseInt(args || "10", 10) || 10;
      const history = loadHistory(runtimeRoot, count);
      if (history.length === 0) {
        panel(pi, "Prompt Versions", "No prompt compilation history found.");
        return;
      }

      const lines: string[] = [`Prompt compilation history (last ${history.length} entries):`, ""];
      for (const entry of history) {
        lines.push(
          `${entry.compiledAt} | ${entry.role}/${entry.tier}/${entry.mode} | ${entry.fragmentIds.length} frags | ~${entry.estimatedTokens}t | ${entry.hash.slice(0, 12)}`,
        );
      }

      panel(pi, "Prompt Versions", lines.join("\n"));
    },
  });

  pi.registerCommand("prompt-workers", {
    description: "Show recent worker prompt compilations",
    async handler(_args, _ctx) {
      const recent = getRecentWorkerCompilations(10);
      if (recent.length === 0) {
        panel(pi, "Worker Prompts", "No worker prompts compiled yet.");
        return;
      }

      const lines: string[] = [`Recent worker compilations (${recent.length}):`, ""];
      for (const c of recent) {
        lines.push(
          `${c.compiledAt} | ${c.includedFragments.length} frags | ~${c.estimatedTokens}t | ${c.hash.slice(0, 12)}`,
        );
      }
      panel(pi, "Worker Prompts", lines.join("\n"));
    },
  });
});
