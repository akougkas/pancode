import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import YAML from "yaml";

export interface AgentSpec {
  name: string;
  description: string;
  tools: string;
  systemPrompt: string;
  model?: string;
  sampling?: string;
  readonly: boolean;
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
    });
  }

  return specs;
}
