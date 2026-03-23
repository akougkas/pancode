/**
 * Command surface audit for PanCode.
 *
 * Compares PanCode slash commands against Pi SDK built-in commands to identify:
 * 1. Shadowed commands (PanCode replaces a Pi built-in with the same name)
 * 2. Pass-through commands (Pi built-in routed through PanCode handler)
 * 3. PanCode-only commands (no Pi SDK equivalent)
 * 4. Dead commands (registered in metadata but not implemented)
 * 5. Headless parity gaps (commands that only work in TUI mode)
 *
 * Also analyzes the relationship between orchestrator modes and safety levels
 * to surface potential unification opportunities.
 */

import { MODE_DEFINITIONS, type OrchestratorMode, getToolsetForMode } from "./modes";
import { PANCODE_SHELL_COMMANDS, type PanCodeShellCommand } from "./shell-metadata";

// ---------------------------------------------------------------------------
// Pi SDK built-in command catalog
// ---------------------------------------------------------------------------
// These are the commands Pi SDK registers in BUILTIN_SLASH_COMMANDS.
// Maintained here as a static list for auditing without importing the SDK
// (which would violate the engine boundary for code in src/core/).

const PI_SDK_BUILTINS: ReadonlyArray<{ name: string; description: string }> = [
  { name: "model", description: "Switch or search models" },
  { name: "scoped-models", description: "Show scoped model list" },
  { name: "settings", description: "Open settings selector" },
  { name: "export", description: "Export conversation" },
  { name: "share", description: "Share conversation" },
  { name: "copy", description: "Copy last message" },
  { name: "name", description: "Name the session" },
  { name: "session", description: "Show session info" },
  { name: "changelog", description: "Show Pi SDK changelog" },
  { name: "hotkeys", description: "Show keyboard shortcuts" },
  { name: "fork", description: "Fork conversation" },
  { name: "tree", description: "Show conversation tree" },
  { name: "login", description: "OAuth login" },
  { name: "logout", description: "OAuth logout" },
  { name: "new", description: "Start new conversation" },
  { name: "compact", description: "Compact context window" },
  { name: "resume", description: "Resume previous session" },
  { name: "quit", description: "Quit the application" },
  { name: "reload", description: "Reload extensions" },
] as const;

// ---------------------------------------------------------------------------
// Audit types
// ---------------------------------------------------------------------------

export type CommandRelation = "shadowed" | "pass-through" | "pancode-only" | "pi-only" | "hidden";

export interface CommandAuditEntry {
  name: string;
  relation: CommandRelation;
  piDescription: string | null;
  pancodeDescription: string | null;
  pancodeCategory: string | null;
  /** Whether the command can function in headless (non-TUI) mode. */
  headlessCapable: boolean;
}

export interface ModeAnalysis {
  mode: OrchestratorMode;
  name: string;
  dispatchEnabled: boolean;
  mutationsAllowed: boolean;
  toolCount: number;
  tools: string[];
}

export interface SafetyModeOverlap {
  modeId: OrchestratorMode;
  safetyLevel: string;
  description: string;
  redundant: boolean;
}

export interface CommandAuditReport {
  timestamp: string;
  totalPancodeCommands: number;
  totalPiBuiltins: number;
  commands: CommandAuditEntry[];
  summary: {
    shadowed: number;
    passThrough: number;
    pancodeOnly: number;
    piOnly: number;
    hidden: number;
    headlessGaps: number;
  };
  modeAnalysis: ModeAnalysis[];
  safetyCombinations: SafetyModeOverlap[];
  recommendations: string[];
}

// ---------------------------------------------------------------------------
// Commands that PanCode shadows (replaces) from the Pi SDK
// ---------------------------------------------------------------------------

const SHADOWED_COMMANDS = new Set(["model", "scoped-models", "settings", "session", "compact", "new", "reload"]);

// Commands Pi SDK provides that PanCode hides but passes through unchanged
const PASSTHROUGH_COMMANDS = new Set([
  "export",
  "share",
  "copy",
  "name",
  "changelog",
  "hotkeys",
  "fork",
  "tree",
  "login",
  "logout",
  "resume",
  "quit",
]);

// Commands that require TUI interaction and cannot work in headless mode
const TUI_ONLY_COMMANDS = new Set(["dashboard", "theme", "fork", "tree", "hotkeys", "preset"]);

// ---------------------------------------------------------------------------
// Audit logic
// ---------------------------------------------------------------------------

function auditCommands(): CommandAuditEntry[] {
  const entries: CommandAuditEntry[] = [];
  const piByName = new Map(PI_SDK_BUILTINS.map((c) => [c.name, c]));
  const pancodeByName = new Map<string, PanCodeShellCommand>(PANCODE_SHELL_COMMANDS.map((c) => [c.name, c]));

  // Process all PanCode commands
  for (const cmd of PANCODE_SHELL_COMMANDS) {
    const piCmd = piByName.get(cmd.name);
    let relation: CommandRelation;

    if (piCmd && SHADOWED_COMMANDS.has(cmd.name)) {
      relation = "shadowed";
    } else if (piCmd && PASSTHROUGH_COMMANDS.has(cmd.name)) {
      relation = "pass-through";
    } else {
      relation = "pancode-only";
    }

    entries.push({
      name: cmd.name,
      relation,
      piDescription: piCmd?.description ?? null,
      pancodeDescription: cmd.description,
      pancodeCategory: cmd.category,
      headlessCapable: !TUI_ONLY_COMMANDS.has(cmd.name),
    });
  }

  // Process Pi SDK builtins not in PanCode's registry
  for (const piCmd of PI_SDK_BUILTINS) {
    if (!pancodeByName.has(piCmd.name)) {
      // Check if it is a hidden builtin (PanCode removes it from autocomplete)
      const isHidden = PASSTHROUGH_COMMANDS.has(piCmd.name) || SHADOWED_COMMANDS.has(piCmd.name);
      entries.push({
        name: piCmd.name,
        relation: isHidden ? "hidden" : "pi-only",
        piDescription: piCmd.description,
        pancodeDescription: null,
        pancodeCategory: null,
        headlessCapable: false,
      });
    }
  }

  return entries.sort((a, b) => a.name.localeCompare(b.name));
}

function analyzeModes(): ModeAnalysis[] {
  return MODE_DEFINITIONS.map((def) => {
    const tools = getToolsetForMode(def.id);
    return {
      mode: def.id,
      name: def.name,
      dispatchEnabled: def.dispatchEnabled,
      mutationsAllowed: def.mutationsAllowed,
      toolCount: tools.length,
      tools,
    };
  });
}

function analyzeModeSafetyOverlap(): SafetyModeOverlap[] {
  const overlaps: SafetyModeOverlap[] = [];

  // capture mode + any safety level: safety is irrelevant because dispatch is disabled
  for (const safety of ["suggest", "auto-edit", "full-auto"]) {
    overlaps.push({
      modeId: "capture",
      safetyLevel: safety,
      description: `Capture mode disables dispatch, so safety level "${safety}" has no practical effect.`,
      redundant: true,
    });
  }

  // ask/review + full-auto: mutations are not allowed by mode, so full-auto permissions are wasted
  for (const modeId of ["ask", "review"] as OrchestratorMode[]) {
    overlaps.push({
      modeId,
      safetyLevel: "full-auto",
      description: `${modeId} mode is readonly. Full-auto grants write permissions that the mode blocks.`,
      redundant: true,
    });
  }

  // plan + auto-edit/full-auto: dispatch disabled, so safety level is moot for tool calls
  for (const safety of ["auto-edit", "full-auto"]) {
    overlaps.push({
      modeId: "plan",
      safetyLevel: safety,
      description: `Plan mode disables dispatch. Safety level "${safety}" only affects shadow agents.`,
      redundant: false,
    });
  }

  return overlaps;
}

function generateRecommendations(commands: CommandAuditEntry[], overlaps: SafetyModeOverlap[]): string[] {
  const recs: string[] = [];

  const headlessGaps = commands.filter((c) => !c.headlessCapable && c.relation !== "pi-only");
  if (headlessGaps.length > 0) {
    recs.push(
      `${headlessGaps.length} commands lack headless parity: ${headlessGaps.map((c) => `/${c.name}`).join(", ")}. Consider adding --json output for CI/automation use cases.`,
    );
  }

  const redundantCombos = overlaps.filter((o) => o.redundant);
  if (redundantCombos.length > 0) {
    recs.push(
      `${redundantCombos.length} mode+safety combinations are redundant. Consider a unified --mode flag that combines behavior and permission level. For example, "plan" could imply "suggest" safety, and "build" could imply "auto-edit".`,
    );
  }

  const piOnlyCommands = commands.filter((c) => c.relation === "pi-only");
  if (piOnlyCommands.length > 0) {
    recs.push(
      `${piOnlyCommands.length} Pi SDK builtins have no PanCode equivalent: ` +
        `${piOnlyCommands.map((c) => `/${c.name}`).join(", ")}. Evaluate whether to expose or explicitly hide them.`,
    );
  }

  const shadowedCount = commands.filter((c) => c.relation === "shadowed").length;
  if (shadowedCount > 0) {
    recs.push(
      `${shadowedCount} commands shadow Pi SDK builtins. Document these in a compatibility matrix so users upgrading Pi SDK understand which commands PanCode replaces.`,
    );
  }

  return recs;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Run a comprehensive command surface audit and return the report.
 */
export function runCommandAudit(): CommandAuditReport {
  const commands = auditCommands();
  const modeAnalysis = analyzeModes();
  const safetyCombinations = analyzeModeSafetyOverlap();
  const recommendations = generateRecommendations(commands, safetyCombinations);

  const summary = {
    shadowed: commands.filter((c) => c.relation === "shadowed").length,
    passThrough: commands.filter((c) => c.relation === "pass-through").length,
    pancodeOnly: commands.filter((c) => c.relation === "pancode-only").length,
    piOnly: commands.filter((c) => c.relation === "pi-only").length,
    hidden: commands.filter((c) => c.relation === "hidden").length,
    headlessGaps: commands.filter((c) => !c.headlessCapable && c.relation !== "pi-only").length,
  };

  return {
    timestamp: new Date().toISOString(),
    totalPancodeCommands: PANCODE_SHELL_COMMANDS.length,
    totalPiBuiltins: PI_SDK_BUILTINS.length,
    commands,
    summary,
    modeAnalysis,
    safetyCombinations,
    recommendations,
  };
}

/**
 * Format the audit report as human-readable text for /audit-commands output.
 */
export function formatAuditReport(report: CommandAuditReport): string[] {
  const lines: string[] = [];

  lines.push("COMMAND SURFACE AUDIT");
  lines.push(`PanCode commands: ${report.totalPancodeCommands}  Pi SDK builtins: ${report.totalPiBuiltins}`);
  lines.push("");

  lines.push("RELATION SUMMARY");
  lines.push(`  Shadowed (PanCode replaces Pi):  ${report.summary.shadowed}`);
  lines.push(`  Pass-through (Pi handles):       ${report.summary.passThrough}`);
  lines.push(`  PanCode-only:                    ${report.summary.pancodeOnly}`);
  lines.push(`  Pi SDK only (no PanCode):        ${report.summary.piOnly}`);
  lines.push(`  Hidden from autocomplete:        ${report.summary.hidden}`);
  lines.push(`  Headless gaps:                   ${report.summary.headlessGaps}`);
  lines.push("");

  // Shadowed commands detail
  const shadowed = report.commands.filter((c) => c.relation === "shadowed");
  if (shadowed.length > 0) {
    lines.push("SHADOWED COMMANDS");
    for (const cmd of shadowed) {
      lines.push(`  /${cmd.name}`);
      lines.push(`    Pi:      ${cmd.piDescription}`);
      lines.push(`    PanCode: ${cmd.pancodeDescription}`);
    }
    lines.push("");
  }

  // Mode analysis
  lines.push("MODE ANALYSIS");
  for (const m of report.modeAnalysis) {
    const flags = [m.dispatchEnabled ? "dispatch" : "no-dispatch", m.mutationsAllowed ? "mutable" : "readonly"].join(
      ", ",
    );
    lines.push(`  ${m.name.padEnd(10)} ${m.toolCount} tools  [${flags}]`);
  }
  lines.push("");

  // Safety overlap
  const redundant = report.safetyCombinations.filter((o) => o.redundant);
  if (redundant.length > 0) {
    lines.push("REDUNDANT MODE+SAFETY COMBINATIONS");
    for (const o of redundant) {
      lines.push(`  ${o.modeId} + ${o.safetyLevel}: ${o.description}`);
    }
    lines.push("");
  }

  // Recommendations
  if (report.recommendations.length > 0) {
    lines.push("RECOMMENDATIONS");
    for (const rec of report.recommendations) {
      lines.push(`  * ${rec}`);
    }
  }

  return lines;
}
