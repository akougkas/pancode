/**
 * Configuration import and export for cross-tool interoperability.
 *
 * Import: reads configuration from other AI coding tools (Claude Code,
 * Codex, Cursor, VS Code) and converts to PanCode format. Import is
 * additive and requires user confirmation.
 *
 * Export: packages PanCode configuration as shareable artifacts with
 * API keys stripped.
 */

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

export interface ImportedConfig {
  source: string;
  sourcePath: string;
  settings: ImportedSetting[];
}

export interface ImportedSetting {
  key: string;
  value: string;
  category: "model" | "tools" | "safety" | "general";
  description: string;
}

export interface ExportedConfig {
  format: "yaml" | "json" | "markdown";
  content: string;
  /** Whether any sensitive values were redacted. */
  redacted: boolean;
}

// ---------------------------------------------------------------------------
// Import: discover settings from other AI tools
// ---------------------------------------------------------------------------

/**
 * Scan the project directory for AI tool configuration files.
 * Returns discovered configurations from all recognized tools.
 */
export function discoverImportableConfigs(projectRoot: string): ImportedConfig[] {
  const configs: ImportedConfig[] = [];

  // Claude Code: .claude/settings.json
  const claudeSettings = join(projectRoot, ".claude", "settings.json");
  if (existsSync(claudeSettings)) {
    const imported = importClaudeCode(claudeSettings);
    if (imported) configs.push(imported);
  }

  // Cursor: .cursor/rules (directory of .mdc files or single file)
  const cursorRules = join(projectRoot, ".cursor", "rules");
  if (existsSync(cursorRules)) {
    const imported = importCursorRules(cursorRules);
    if (imported) configs.push(imported);
  }

  // VS Code: .vscode/settings.json
  const vscodeSettings = join(projectRoot, ".vscode", "settings.json");
  if (existsSync(vscodeSettings)) {
    const imported = importVSCode(vscodeSettings);
    if (imported) configs.push(imported);
  }

  // Codex: .codex/ directory
  const codexDir = join(projectRoot, ".codex");
  if (existsSync(codexDir)) {
    const imported = importCodex(codexDir);
    if (imported) configs.push(imported);
  }

  return configs;
}

function importClaudeCode(settingsPath: string): ImportedConfig | null {
  try {
    const raw = readFileSync(settingsPath, "utf8");
    const settings = JSON.parse(raw) as Record<string, unknown>;
    const imported: ImportedSetting[] = [];

    if (Array.isArray(settings.allowedTools)) {
      imported.push({
        key: "allowedTools",
        value: (settings.allowedTools as string[]).join(", "),
        category: "tools",
        description: "Allowed tools from Claude Code settings",
      });
    }

    if (typeof settings.model === "string") {
      imported.push({
        key: "model",
        value: settings.model,
        category: "model",
        description: "Default model from Claude Code settings",
      });
    }

    if (imported.length === 0) return null;

    return { source: "Claude Code", sourcePath: settingsPath, settings: imported };
  } catch {
    return null;
  }
}

function importCursorRules(rulesPath: string): ImportedConfig | null {
  try {
    const imported: ImportedSetting[] = [];

    // .cursor/rules can be a file or directory of .mdc files
    try {
      const entries = readdirSync(rulesPath);
      for (const entry of entries) {
        if (entry.endsWith(".mdc") || entry.endsWith(".md")) {
          const content = readFileSync(join(rulesPath, entry), "utf8");
          imported.push({
            key: `cursor-rule:${entry}`,
            value: content.slice(0, 500),
            category: "general",
            description: `Cursor rule from ${entry}`,
          });
        }
      }
    } catch {
      // Not a directory, try as a file
      const content = readFileSync(rulesPath, "utf8");
      imported.push({
        key: "cursor-rules",
        value: content.slice(0, 500),
        category: "general",
        description: "Cursor project rules",
      });
    }

    if (imported.length === 0) return null;
    return { source: "Cursor", sourcePath: rulesPath, settings: imported };
  } catch {
    return null;
  }
}

function importVSCode(settingsPath: string): ImportedConfig | null {
  try {
    const raw = readFileSync(settingsPath, "utf8");
    const settings = JSON.parse(raw) as Record<string, unknown>;
    const imported: ImportedSetting[] = [];

    // Look for AI-related settings
    for (const [key, value] of Object.entries(settings)) {
      if (key.includes("copilot") || key.includes("ai") || key.includes("claude") || key.includes("anthropic")) {
        imported.push({
          key,
          value: typeof value === "string" ? value : JSON.stringify(value),
          category: "general",
          description: `VS Code AI setting: ${key}`,
        });
      }
    }

    if (imported.length === 0) return null;
    return { source: "VS Code", sourcePath: settingsPath, settings: imported };
  } catch {
    return null;
  }
}

function importCodex(codexDir: string): ImportedConfig | null {
  try {
    const imported: ImportedSetting[] = [];
    const entries = readdirSync(codexDir);

    for (const entry of entries) {
      if (entry.endsWith(".json") || entry.endsWith(".yaml") || entry.endsWith(".yml")) {
        const content = readFileSync(join(codexDir, entry), "utf8");
        imported.push({
          key: `codex:${entry}`,
          value: content.slice(0, 500),
          category: "general",
          description: `Codex config from ${entry}`,
        });
      }
    }

    if (imported.length === 0) return null;
    return { source: "Codex", sourcePath: codexDir, settings: imported };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Export: package PanCode config as shareable artifacts
// ---------------------------------------------------------------------------

/** Regex to match API key patterns for redaction. */
const API_KEY_PATTERN = /\b(sk-[a-zA-Z0-9]{20,}|[a-zA-Z0-9]{32,})\b/g;

/**
 * Redact API keys and sensitive values from exported configuration.
 */
export function redactSensitiveValues(content: string): { redacted: string; hadSensitive: boolean } {
  let hadSensitive = false;
  const redacted = content.replace(API_KEY_PATTERN, () => {
    hadSensitive = true;
    return "[REDACTED]";
  });
  return { redacted, hadSensitive };
}

/**
 * Export agent definitions as a Markdown document.
 */
export function exportAgentsMarkdown(
  agents: Array<{ name: string; description: string; tools: string; model?: string; tier: string; readonly: boolean }>,
): ExportedConfig {
  const lines: string[] = ["# PanCode Agent Fleet", ""];

  for (const agent of agents) {
    lines.push(`## ${agent.name}`);
    lines.push(`- **Description:** ${agent.description}`);
    lines.push(`- **Tools:** ${agent.tools}`);
    lines.push(`- **Model:** ${agent.model ?? "(session default)"}`);
    lines.push(`- **Tier:** ${agent.tier}`);
    lines.push(`- **Readonly:** ${agent.readonly ? "yes" : "no"}`);
    lines.push("");
  }

  return { format: "markdown", content: lines.join("\n"), redacted: false };
}
