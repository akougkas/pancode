export const PANCODE_PRODUCT_NAME = "PanCode";

export type CommandCategory = "session" | "dispatch" | "agents" | "observe" | "schedule" | "display" | "utility";

export interface PanCodeShellCommand {
  name: string;
  args?: string;
  description: string;
  category: CommandCategory;
}

/**
 * Master command registry. Every PanCode-visible command appears here.
 * The /help command reads this array to render the categorized listing.
 * Commands that wrap Pi SDK builtins are registered both here (for display)
 * and as extension commands or prototype patches (for execution).
 */
export const PANCODE_SHELL_COMMANDS: readonly PanCodeShellCommand[] = [
  // SESSION
  { name: "new", description: "Start a new session (clears board, tasks, memory)", category: "session" },
  {
    name: "compact",
    args: "[instructions]",
    description: "Compact context (prune registry, log to audit)",
    category: "session",
  },
  { name: "fork", description: "Fork session from a prior message", category: "session" },
  { name: "tree", description: "Navigate the session branch tree", category: "session" },
  { name: "session", description: "Show session info with PanCode state summary", category: "session" },
  { name: "resume", description: "Resume a previous session", category: "session" },
  { name: "checkpoint", description: "Mark a session checkpoint", category: "session" },
  { name: "context", description: "Show the cross-agent context registry", category: "session" },
  { name: "reset", description: "Reset coordination state (board, registry)", category: "session" },

  // DISPATCH
  { name: "runs", args: "[count]", description: "Show dispatch run history", category: "dispatch" },
  { name: "batches", description: "Show batch dispatch history", category: "dispatch" },
  { name: "stoprun", args: "<run-id>", description: "Stop a running dispatch", category: "dispatch" },
  { name: "cost", description: "Show per-run cost breakdown", category: "dispatch" },

  // AGENTS
  { name: "agents", description: "List registered PanCode agent specs", category: "agents" },
  { name: "runtimes", description: "List agent runtimes with availability status", category: "agents" },
  { name: "skills", description: "List agent skills", category: "agents" },

  // OBSERVE
  { name: "audit", description: "Structured audit trail", category: "observe" },
  { name: "doctor", description: "Run diagnostic health checks", category: "observe" },
  { name: "metrics", args: "[count]", description: "Show dispatch metrics", category: "observe" },
  {
    name: "receipt",
    args: "[verify <id>]",
    description: "List or verify reproducibility receipts",
    category: "observe",
  },
  { name: "perf", description: "Show boot phase timing breakdown", category: "observe" },

  // SCHEDULE
  { name: "budget", description: "Show dispatch budget status", category: "schedule" },

  // DISPLAY
  { name: "dashboard", description: "Open the PanCode dashboard", category: "display" },
  { name: "status", description: "Show the PanCode session summary", category: "display" },
  {
    name: "models",
    args: "[provider | all]",
    description: "Show model inventory and active engines",
    category: "display",
  },
  { name: "settings", description: "Show PanCode configuration", category: "display" },
  { name: "theme", args: "[list]", description: "Show current theme and available themes", category: "display" },
  {
    name: "modes",
    description: "Show orchestrator behavior modes",
    category: "display",
  },
  { name: "reasoning", description: "Show reasoning preference and model capability", category: "display" },
  {
    name: "safety",
    description: "Show current safety level",
    category: "display",
  },
  { name: "help", description: "Show PanCode commands", category: "display" },
  { name: "exit", description: "Exit PanCode", category: "display" },
  { name: "quit", description: "Exit PanCode (Pi built-in)", category: "display" },

  // UTILITY
  {
    name: "export",
    args: "[path.html|path.jsonl]",
    description: "Export session to file (Pi SDK passthrough, defaults to HTML)",
    category: "utility",
  },
  { name: "copy", description: "Copy last agent message to clipboard", category: "utility" },
  { name: "login", description: "Login with OAuth provider", category: "utility" },
  { name: "logout", description: "Logout from OAuth provider", category: "utility" },
  { name: "reload", description: "Reload extensions and themes", category: "utility" },
  { name: "hotkeys", description: "Show keyboard shortcuts", category: "utility" },
] as const;

const CATEGORY_LABELS: Record<CommandCategory, string> = {
  session: "SESSION",
  dispatch: "DISPATCH",
  agents: "AGENTS",
  observe: "OBSERVE",
  schedule: "SCHEDULE",
  display: "DISPLAY",
  utility: "UTILITY",
};

const CATEGORY_ORDER: CommandCategory[] = [
  "session",
  "dispatch",
  "agents",
  "observe",
  "schedule",
  "display",
  "utility",
];

/**
 * Format commands as a flat list (one line per command).
 */
export function formatShellCommandLines(commands = PANCODE_SHELL_COMMANDS): string[] {
  return commands.map((command) => {
    const suffix = command.args ? ` ${command.args}` : "";
    return `/${command.name}${suffix}  ${command.description}`;
  });
}

/**
 * Format commands grouped by category for the /help display.
 * Each category is a header followed by its command names on one line,
 * then individual command descriptions below.
 */
export function formatCategorizedHelp(commands = PANCODE_SHELL_COMMANDS): string[] {
  const grouped = new Map<CommandCategory, PanCodeShellCommand[]>();
  for (const cmd of commands) {
    const group = grouped.get(cmd.category) ?? [];
    group.push(cmd);
    grouped.set(cmd.category, group);
  }

  const lines: string[] = [];

  for (const category of CATEGORY_ORDER) {
    const group = grouped.get(category);
    if (!group || group.length === 0) continue;

    if (lines.length > 0) lines.push("");

    const label = CATEGORY_LABELS[category];
    const cmdNames = group.map((c) => `/${c.name}`).join("  ");
    lines.push(`${label}:  ${cmdNames}`);

    for (const cmd of group) {
      const suffix = cmd.args ? ` ${cmd.args}` : "";
      lines.push(`  /${cmd.name}${suffix}  ${cmd.description}`);
    }
  }

  return lines;
}

function formatOption(flag: string, description: string): string {
  return `  ${flag.padEnd(24, " ")}${description}`;
}

export function formatWorkerCliUsage(): string {
  return `Usage:
  pancode --worker --prompt "list files" --result-file result.json

Options:
${formatOption("--prompt <text>", "Prompt to send to the worker")}
${formatOption("--result-file <path>", "JSON file written by the worker")}
${formatOption("--provider <name>", "Explicit provider override")}
${formatOption("--model <id>", "Explicit model override")}
${formatOption("--cwd <path>", "Working directory for the worker")}
${formatOption("--tools <csv>", "Tool allowlist passed to the worker")}
${formatOption("--timeout-ms <ms>", "Kill the worker if it exceeds the timeout")}`;
}
