// src/core/shell-metadata.ts
var PANCODE_PRODUCT_NAME = "PanCode";
var PANCODE_SHELL_COMMANDS = [
  { name: "settings", description: "Open PanCode preferences" },
  { name: "models", args: "[provider | provider/model-id | all]", description: "Show model inventory or switch models" },
  { name: "dashboard", description: "Open the PanCode dashboard" },
  { name: "status", description: "Show the PanCode session summary" },
  { name: "theme", args: "[name|list]", description: "Inspect or change the active PanCode theme" },
  { name: "reasoning", args: "[off|on]", description: "Inspect or change the PanCode reasoning preference" },
  { name: "help", description: "Show PanCode shell commands" },
  { name: "exit", description: "Exit PanCode" }
];
function formatOption(flag, description) {
  return `  ${flag.padEnd(24, " ")}${description}`;
}
function formatShellCommandLines(commands = PANCODE_SHELL_COMMANDS) {
  return commands.map((command) => {
    const suffix = command.args ? ` ${command.args}` : "";
    return `/${command.name}${suffix}  ${command.description}`;
  });
}
function formatPanCodeCliUsage(target = "orchestrator") {
  if (target === "worker") {
    return `Usage:
  npm run worker -- --prompt "list files" --result-file result.json

Options:
${formatOption("--prompt <text>", "Prompt to send to the worker")}
${formatOption("--result-file <path>", "JSON file written by the worker")}
${formatOption("--provider <name>", "Explicit provider override")}
${formatOption("--model <id>", "Explicit model override")}
${formatOption("--cwd <path>", "Working directory for the worker")}
${formatOption("--tools <csv>", "Tool allowlist passed to the worker")}
${formatOption("--timeout-ms <ms>", "Kill the worker if it exceeds the timeout")}
${formatOption("--help", "Show this help")}
${formatOption("--version", "Show PanCode version")}`;
  }
  return `Usage:
  npm start
  npm start -- --model anthropic/claude-opus-4-5

Options:
${formatOption("--cwd <path>", "Working directory for the session")}
${formatOption("--provider <name>", "Preferred provider for model resolution")}
${formatOption("--model <id>", "Model override, usually provider/model-id")}
${formatOption("--profile <name>", "Config profile name")}
${formatOption("--safety <level>", "suggest | auto-edit | full-auto")}
${formatOption("--theme <name>", "PanCode theme name")}
${formatOption("--help", "Show this help")}
${formatOption("--version", "Show PanCode version")}`;
}

export {
  PANCODE_PRODUCT_NAME,
  formatShellCommandLines,
  formatPanCodeCliUsage
};
//# sourceMappingURL=chunk-WNATMMYV.js.map