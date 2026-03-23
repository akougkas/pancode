/**
 * Command surface audit for PanCode.
 *
 * Classifies every slash command by its relationship to Pi SDK built-ins,
 * headless compatibility, and JSON output support. The /audit-commands
 * diagnostic command uses this module to render the audit report.
 */

import { PANCODE_SHELL_COMMANDS, type PanCodeShellCommand } from "./shell-metadata";

/**
 * Pi SDK built-in commands that exist natively in the Pi shell.
 * PanCode commands with the same name shadow these built-ins by
 * registering extension commands that intercept the invocation.
 */
export const PI_SDK_BUILTINS = new Set([
  "new",
  "compact",
  "fork",
  "tree",
  "resume",
  "export",
  "copy",
  "login",
  "logout",
  "reload",
  "hotkeys",
  "help",
  "exit",
  "session",
]);

export type CommandStatus = "active" | "shadowed" | "pancode-only";

export interface CommandAuditEntry {
  name: string;
  category: string;
  /** Whether this command shadows a Pi SDK built-in. */
  status: CommandStatus;
  /** Whether the command produces useful output in headless (non-TUI) mode. */
  headlessCapable: boolean;
  /** Whether the command supports JSON envelope output. */
  jsonCapable: boolean;
}

/**
 * Commands that require the TUI to function and produce no meaningful
 * output in headless mode.
 */
const TUI_ONLY_COMMANDS = new Set(["dashboard", "theme", "hotkeys", "fork", "tree", "copy"]);

/**
 * Commands that currently support or could trivially support
 * JSON envelope output via the JsonEnvelope schema.
 */
const JSON_CAPABLE_COMMANDS = new Set([
  "runs",
  "batches",
  "cost",
  "agents",
  "runtimes",
  "skills",
  "audit",
  "doctor",
  "metrics",
  "perf",
  "budget",
  "status",
  "models",
  "session",
  "context",
  "settings",
  "modes",
  "safety",
  "reasoning",
  "dispatch-insights",
  "checkpoint",
  "stoprun",
  "receipt",
]);

/**
 * Build a complete audit of the command surface.
 * Returns one entry per registered PanCode command.
 */
export function auditCommandSurface(
  commands: readonly PanCodeShellCommand[] = PANCODE_SHELL_COMMANDS,
): CommandAuditEntry[] {
  return commands.map((cmd) => ({
    name: cmd.name,
    category: cmd.category,
    status: classifyCommandStatus(cmd.name),
    headlessCapable: !TUI_ONLY_COMMANDS.has(cmd.name),
    jsonCapable: JSON_CAPABLE_COMMANDS.has(cmd.name),
  }));
}

function classifyCommandStatus(name: string): CommandStatus {
  if (PI_SDK_BUILTINS.has(name)) return "shadowed";
  return "pancode-only";
}

/**
 * Format the audit report as human-readable lines.
 */
export function formatAuditReport(entries?: CommandAuditEntry[]): string[] {
  const audit = entries ?? auditCommandSurface();
  const lines: string[] = ["COMMAND SURFACE AUDIT", ""];

  const shadowed = audit.filter((e) => e.status === "shadowed");
  const pancodeOnly = audit.filter((e) => e.status === "pancode-only");
  const headlessGaps = audit.filter((e) => !e.headlessCapable);
  const jsonGaps = audit.filter((e) => !e.jsonCapable);

  lines.push(`Total commands: ${audit.length}`);
  lines.push(`Shadowed (overrides Pi built-in): ${shadowed.length}`);
  lines.push(`PanCode-only: ${pancodeOnly.length}`);
  lines.push(`Headless-capable: ${audit.length - headlessGaps.length}/${audit.length}`);
  lines.push(`JSON-capable: ${audit.length - jsonGaps.length}/${audit.length}`);
  lines.push("");

  if (shadowed.length > 0) {
    lines.push("SHADOWED COMMANDS (override Pi SDK built-ins):");
    for (const entry of shadowed) {
      lines.push(`  /${entry.name}  [${entry.category}]`);
    }
    lines.push("");
  }

  if (headlessGaps.length > 0) {
    lines.push("TUI-ONLY (no headless support):");
    for (const entry of headlessGaps) {
      lines.push(`  /${entry.name}  [${entry.category}]`);
    }
    lines.push("");
  }

  if (jsonGaps.length > 0) {
    lines.push("MISSING JSON OUTPUT:");
    for (const entry of jsonGaps) {
      lines.push(`  /${entry.name}  [${entry.category}]`);
    }
  }

  return lines;
}
