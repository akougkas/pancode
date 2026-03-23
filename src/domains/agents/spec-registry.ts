import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import YAML from "yaml";
import { atomicWriteTextSync } from "../../core/config-writer";

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
  // Tier classification
  tier: "frontier" | "mid" | "any"; // Recommended model tier for this agent
  // Operational fields
  prompt: string; // "default" uses PanPrompt engine, or custom text
  speed: "fast" | "balanced" | "thorough";
  tokenBudget: number; // Max output tokens for this agent
  autonomy: "autonomous" | "supervised" | "confirmatory";
  isolation: "none" | "worktree" | "container";
  maxTurns: number; // Max conversation turns before timeout
  retryOnFailure: boolean; // Auto-retry on non-zero exit
  tags: string[]; // For routing and filtering
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
  tier?: string;
  // Operational fields (all optional, YAML uses snake_case)
  prompt?: string;
  speed?: "fast" | "balanced" | "thorough";
  token_budget?: number;
  autonomy?: "autonomous" | "supervised" | "confirmatory";
  isolation?: "none" | "worktree" | "container";
  max_turns?: number;
  retry_on_failure?: boolean;
  tags?: string[];
}

interface YamlAgentsFile {
  agents?: Record<string, YamlAgentEntry>;
}

const DEFAULT_AGENTS_YAML = `# PanCode Agent Definitions (panagents.yaml)
# Each agent specifies tools, sampling preset, readonly mode, and tier.
# The model field supports \${ENV_VAR} expansion.
# Tier indicates the recommended model capability: frontier, mid, or any.

agents:
  scout:
    description: "Fast codebase reconnaissance and exploration"
    model: \${PANCODE_WORKER_MODEL}
    tools: [read, grep, find, ls]
    sampling: general
    readonly: true
    tier: any
    prompt: default
    speed: fast
    token_budget: 4000
    autonomy: autonomous
    isolation: none
    max_turns: 10
    retry_on_failure: false
    tags: [recon, readonly]
    system_prompt: "You are a scout agent. Explore the codebase to answer questions. Report findings as FOUND: or NOT FOUND:. No opinions, no suggestions. Facts only."

  planner:
    description: "Architecture and implementation planning"
    model: \${PANCODE_WORKER_MODEL}
    tools: [read, grep, find, ls]
    sampling: general
    readonly: true
    tier: frontier
    prompt: default
    speed: thorough
    token_budget: 8000
    autonomy: supervised
    isolation: none
    max_turns: 15
    retry_on_failure: false
    tags: [planning, readonly]
    system_prompt: "You are a planner agent. Analyze requirements and produce step-by-step implementation plans. Identify files to modify, dependencies, and risks. Do not modify any files."

  builder:
    description: "Implementation and code generation"
    model: \${PANCODE_WORKER_MODEL}
    tools: [read, write, edit, bash, grep, find, ls]
    sampling: coding
    readonly: false
    tier: mid
    prompt: default
    speed: balanced
    token_budget: 8000
    autonomy: supervised
    isolation: none
    max_turns: 20
    retry_on_failure: true
    tags: [coding, mutable]
    system_prompt: "You are a builder agent. Implement the plan provided. Write clean, tested code. Use tools to read, understand, and modify code. Be concise in responses."

  reviewer:
    description: "Code review and quality analysis"
    model: \${PANCODE_WORKER_MODEL}
    tools: [read, bash, grep, find, ls]
    sampling: general
    readonly: true
    tier: mid
    prompt: default
    speed: thorough
    token_budget: 4000
    autonomy: autonomous
    isolation: none
    max_turns: 10
    retry_on_failure: false
    tags: [review, readonly]
    system_prompt: "You are a reviewer agent. Analyze the code for bugs, security issues, performance problems, and improvements. Run tests if available. Do not modify any files. Report findings clearly."

  plan-reviewer:
    description: "Plan critic and feasibility validator"
    model: \${PANCODE_WORKER_MODEL}
    tools: [read, grep, find, ls]
    sampling: general
    readonly: true
    tier: mid
    prompt: default
    speed: thorough
    token_budget: 4000
    autonomy: autonomous
    isolation: none
    max_turns: 10
    retry_on_failure: false
    tags: [review, planning, readonly]
    system_prompt: "You are a plan-reviewer agent. Challenge assumptions, identify gaps, flag risks, and evaluate feasibility of the proposed plan against the actual codebase. Do not modify files."

  documenter:
    description: "Documentation generation and maintenance"
    model: \${PANCODE_WORKER_MODEL}
    tools: [read, write, edit, grep, find, ls]
    sampling: general
    readonly: false
    tier: any
    prompt: default
    speed: balanced
    token_budget: 6000
    autonomy: supervised
    isolation: none
    max_turns: 15
    retry_on_failure: true
    tags: [docs, mutable]
    system_prompt: "You are a documenter agent. Write clear documentation, update READMEs, add code comments, and create examples. Match the project's existing documentation style."

  red-team:
    description: "Security and adversarial testing"
    model: \${PANCODE_WORKER_MODEL}
    tools: [read, bash, grep, find, ls]
    sampling: general
    readonly: true
    tier: mid
    prompt: default
    speed: thorough
    token_budget: 4000
    autonomy: autonomous
    isolation: none
    max_turns: 10
    retry_on_failure: false
    tags: [security, readonly]
    system_prompt: "You are a red-team agent. Find vulnerabilities, edge cases, injection risks, and missing validation. Think adversarially. Do not modify files. Report all findings with severity."

  # Scout is NOT a dispatchable agent. It runs as a shadow tool (shadow_explore)
  # inside the orchestrator process using PANCODE_SCOUT_MODEL. Users cannot
  # dispatch scouts. See src/engine/shadow.ts for the scout engine.

  # --- External agent examples (uncomment if installed) ---
  # claude-reviewer:
  #   runtime: cli:claude-code
  #   description: "Claude Code for deep code review"
  #   runtime_args: ["--allowedTools", "Read,Grep,Glob"]
  #   readonly: true
  #   tier: frontier
  #   system_prompt: "Review the code for bugs, security issues, and improvements."
  #
  # codex-builder:
  #   runtime: cli:codex
  #   description: "Codex for quick targeted edits"
  #   runtime_args: ["--full-auto"]
  #   readonly: false
  #   tier: mid
  #   system_prompt: "Fix the described issue efficiently."
`;

function expandEnvVars(value: string): string {
  return value.replace(/\$\{([^}]+)\}/g, (_match, varName: string) => {
    return process.env[varName.trim()] ?? "";
  });
}

export function ensureAgentsYaml(pancodeHome: string): string {
  const filePath = join(pancodeHome, "panagents.yaml");
  if (!existsSync(filePath)) {
    mkdirSync(dirname(filePath), { recursive: true });
    atomicWriteTextSync(filePath, DEFAULT_AGENTS_YAML);
  } else {
    // Detect stale format missing v0.3.0 operational fields and regenerate.
    // Pre-release: clean cut, no backward compatibility needed.
    try {
      const content = readFileSync(filePath, "utf8");
      const parsed = YAML.parse(content) as YamlAgentsFile;
      if (parsed?.agents) {
        const firstAgent = Object.values(parsed.agents)[0];
        if (firstAgent && !("speed" in firstAgent)) {
          atomicWriteTextSync(filePath, DEFAULT_AGENTS_YAML);
        }
      }
    } catch {
      atomicWriteTextSync(filePath, DEFAULT_AGENTS_YAML);
    }
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

    const tierValue = entry.tier;
    const tier: "frontier" | "mid" | "any" = tierValue === "frontier" || tierValue === "mid" ? tierValue : "any";

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
      tier,
      prompt: entry.prompt ?? "default",
      speed: entry.speed ?? "balanced",
      tokenBudget: entry.token_budget ?? 8000,
      autonomy: entry.autonomy ?? "supervised",
      isolation: entry.isolation ?? "none",
      maxTurns: entry.max_turns ?? 20,
      retryOnFailure: entry.retry_on_failure ?? true,
      tags: Array.isArray(entry.tags) ? entry.tags : [],
    });
  }

  return specs;
}
