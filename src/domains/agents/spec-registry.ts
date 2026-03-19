import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import YAML from "yaml";

export interface AgentSpec {
  name: string;
  description: string;
  tools: string;
  systemPrompt: string;
  model?: string;
  sampling?: string;
  readonly: boolean;
  // Runtime selection
  runtime: string; // "pi" (default) | "cli:claude-code" | "cli:codex" | etc.
  runtimeArgs: string[]; // Extra args passed to the runtime CLI
}

export class AgentSpecRegistry {
  private readonly specs = new Map<string, AgentSpec>();

  register(spec: AgentSpec): void {
    this.specs.set(spec.name, spec);
  }

  get(name: string): AgentSpec | undefined {
    return this.specs.get(name);
  }

  getAll(): AgentSpec[] {
    return [...this.specs.values()];
  }

  has(name: string): boolean {
    return this.specs.has(name);
  }

  names(): string[] {
    return [...this.specs.keys()];
  }

  clear(): void {
    this.specs.clear();
  }
}

export const agentRegistry = new AgentSpecRegistry();

interface YamlAgentEntry {
  description?: string;
  model?: string;
  tools?: string[];
  sampling?: string;
  readonly?: boolean;
  system_prompt?: string;
  runtime?: string;
  runtime_args?: string[];
}

interface YamlAgentsFile {
  agents?: Record<string, YamlAgentEntry>;
}

const DEFAULT_AGENTS_YAML = `# PanCode Agent Definitions
# Each agent specifies tools, sampling preset, and readonly mode.
# The model field supports \${ENV_VAR} expansion.

agents:
  dev:
    description: "General-purpose coding agent"
    model: \${PANCODE_WORKER_MODEL}
    tools: [read, bash, grep, find, ls, write, edit]
    sampling: coding
    readonly: false
    system_prompt: "You are a skilled software developer. Complete the task efficiently. Use tools to read, understand, and modify code. Be concise in responses."
  reviewer:
    description: "Code review with read-only tools"
    model: \${PANCODE_WORKER_MODEL}
    tools: [read, grep, find, ls]
    sampling: general
    readonly: true
    system_prompt: "You are a code reviewer. Analyze the code for bugs, security issues, and improvements. Do not modify any files. Report findings clearly."
  # PANCODE_SCOUT_MODEL: fast small model for exploration (default: falls back to PANCODE_WORKER_MODEL)
  scout:
    description: "Research and exploration"
    model: \${PANCODE_SCOUT_MODEL}
    tools: [read, grep, find, ls]
    sampling: general
    readonly: true
    system_prompt: "You are a research scout. Explore the codebase to answer questions and gather information. Do not modify any files. Summarize findings concisely."

  # --- External agent examples (uncomment if installed) ---
  # claude-reviewer:
  #   runtime: cli:claude-code
  #   description: "Claude Code for deep code review"
  #   runtime_args: ["--allowedTools", "Read,Grep,Glob"]
  #   readonly: true
  #   system_prompt: "Review the code for bugs, security issues, and improvements."
  #
  # codex-fixer:
  #   runtime: cli:codex
  #   description: "Codex for quick targeted edits"
  #   runtime_args: ["--full-auto"]
  #   readonly: false
  #   system_prompt: "Fix the described issue efficiently."
  #
  # opencode-scout:
  #   runtime: cli:opencode
  #   description: "opencode explore agent for codebase research"
  #   readonly: true
  #   system_prompt: "Explore the codebase to answer questions. Summarize findings concisely."
  #
  # opencode-builder:
  #   runtime: cli:opencode
  #   description: "opencode build agent for implementation"
  #   readonly: false
  #   runtime_args: ["--variant", "high"]
  #   system_prompt: "Implement the requested changes efficiently."
  #
  # cline-planner:
  #   runtime: cli:cline
  #   description: "Cline CLI for codebase analysis and planning"
  #   readonly: true
  #   system_prompt: "Analyze the codebase and create a detailed plan. Do not modify files."
  #
  # cline-builder:
  #   runtime: cli:cline
  #   description: "Cline CLI for implementation tasks"
  #   readonly: false
  #   runtime_args: ["--max-consecutive-mistakes", "3"]
  #   system_prompt: "Implement the requested changes efficiently."
  #
  # copilot-reviewer:
  #   runtime: cli:copilot-cli
  #   description: "GitHub Copilot CLI for code review"
  #   readonly: true
  #   system_prompt: "Review the code for bugs, security issues, and improvements."
  #
  # copilot-builder:
  #   runtime: cli:copilot-cli
  #   description: "GitHub Copilot CLI for implementation"
  #   readonly: false
  #   system_prompt: "Implement the requested changes efficiently."
`;

function expandEnvVars(value: string): string {
  return value.replace(/\$\{([^}]+)\}/g, (_match, varName: string) => {
    return process.env[varName.trim()] ?? "";
  });
}

export function ensureAgentsYaml(pancodeHome: string): string {
  const filePath = join(pancodeHome, "agents.yaml");
  if (!existsSync(filePath)) {
    mkdirSync(dirname(filePath), { recursive: true });
    writeFileSync(filePath, DEFAULT_AGENTS_YAML, "utf8");
  }
  return filePath;
}

export function loadAgentsFromYaml(pancodeHome: string): AgentSpec[] {
  const filePath = ensureAgentsYaml(pancodeHome);

  let content: string;
  try {
    content = readFileSync(filePath, "utf8");
  } catch {
    return [];
  }

  let parsed: YamlAgentsFile;
  try {
    parsed = YAML.parse(content) as YamlAgentsFile;
  } catch {
    console.error(`[pancode:agents] Failed to parse ${filePath}`);
    return [];
  }

  if (!parsed?.agents) return [];

  const specs: AgentSpec[] = [];
  for (const [name, entry] of Object.entries(parsed.agents)) {
    if (!entry) continue;

    const model = entry.model ? expandEnvVars(entry.model) : undefined;
    const tools = Array.isArray(entry.tools) ? entry.tools.join(",") : "read,grep,find,ls";

    specs.push({
      name,
      description: entry.description ?? name,
      tools,
      systemPrompt: entry.system_prompt ?? "",
      model: model && model.length > 0 ? model : undefined,
      sampling: entry.sampling,
      readonly: entry.readonly ?? false,
      runtime: entry.runtime ?? "pi",
      runtimeArgs: Array.isArray(entry.runtime_args) ? entry.runtime_args : [],
    });
  }

  return specs;
}
