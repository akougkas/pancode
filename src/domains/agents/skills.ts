/**
 * Skill discovery: scan standard directories for SKILL.md files.
 *
 * Skills are discovered from .pancode/skills, .claude, .codex, .gemini.
 * Phase B is discovery and display only. No execution.
 */

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

export interface SkillDefinition {
  name: string;
  description: string;
  requiredTools: string[];
  version?: string;
  source: string;
  body: string;
}

const SKILL_DIRS = [".pancode/skills", ".claude", ".codex", ".gemini"];

function parseFrontmatter(content: string): { meta: Record<string, string>; body: string } {
  const lines = content.split("\n");
  if (lines[0]?.trim() !== "---") {
    return { meta: {}, body: content };
  }

  let closingIndex = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim() === "---") {
      closingIndex = i;
      break;
    }
  }

  if (closingIndex < 0) {
    return { meta: {}, body: content };
  }

  const meta: Record<string, string> = {};
  for (let i = 1; i < closingIndex; i++) {
    const line = lines[i];
    const colonIdx = line.indexOf(":");
    if (colonIdx > 0) {
      const key = line.slice(0, colonIdx).trim();
      const value = line.slice(colonIdx + 1).trim();
      meta[key] = value;
    }
  }

  const body = lines
    .slice(closingIndex + 1)
    .join("\n")
    .trim();
  return { meta, body };
}

function parseSkillFile(filePath: string, sourceDir: string): SkillDefinition | null {
  try {
    const content = readFileSync(filePath, "utf8");
    const { meta, body } = parseFrontmatter(content);

    const name = meta.name;
    if (!name) return null;

    const description = meta.description || "";
    const toolsRaw = meta.tools || meta.requiredTools || "";
    const requiredTools = toolsRaw
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);
    const version = meta.version || undefined;

    return { name, description, requiredTools, version, source: sourceDir, body };
  } catch {
    return null;
  }
}

export function discoverSkills(projectRoot: string): SkillDefinition[] {
  const skills: SkillDefinition[] = [];
  const seen = new Set<string>();

  for (const dir of SKILL_DIRS) {
    const fullDir = join(projectRoot, dir);
    if (!existsSync(fullDir)) continue;

    try {
      const files = readdirSync(fullDir);
      for (const file of files) {
        if (!file.endsWith(".md")) continue;
        if (file !== "SKILL.md" && !file.endsWith(".skill.md")) continue;

        const filePath = join(fullDir, file);
        const skill = parseSkillFile(filePath, fullDir);
        if (skill && !seen.has(skill.name)) {
          skills.push(skill);
          seen.add(skill.name);
        }
      }
    } catch {
      /* directory read failure is non-fatal */
    }
  }

  return skills;
}

export function validateSkillTools(skill: SkillDefinition, availableTools: string[]): string[] {
  return skill.requiredTools.filter((t) => !availableTools.includes(t));
}
