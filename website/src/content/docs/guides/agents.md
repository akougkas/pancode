---
title: "Agents"
description: "Working with agents in PanCode"
---

:::caution[Experimental Preview]
This is an experimental preview release. APIs, commands, and features may change without notice.
:::


PanCode ships with a 7-agent default fleet. Each agent is a named configuration that defines tools, system prompt, model preferences, and operational parameters. Agents are dispatched as subprocess workers with their own context windows.

## The Default Fleet

Agent definitions live in `~/.pancode/panagents.yaml`. PanCode seeds this file on first run with seven agents:

| Agent | Role | Readonly | Tier | Speed | Max Turns |
|-------|------|----------|------|-------|-----------|
| `scout` | Fast codebase reconnaissance | Yes | any | fast | 10 |
| `planner` | Architecture and implementation planning | Yes | frontier | thorough | 15 |
| `builder` | Code implementation and generation | No | mid | balanced | 20 |
| `reviewer` | Code review and quality analysis | No (tools are readonly) | mid | thorough | 10 |
| `plan-reviewer` | Plan critic and feasibility validator | Yes | mid | thorough | 10 |
| `documenter` | Documentation generation | No | any | balanced | 15 |
| `red-team` | Security and adversarial testing | Yes | mid | thorough | 10 |

### Scout

Fast, cheap codebase exploration. Tools limited to read, grep, find, and ls. No opinions, only facts. Use for reconnaissance before planning.

### Planner

Produces step-by-step implementation plans. Reads the codebase to identify files, dependencies, and risks. Does not modify files. Requires a frontier-tier model for best results.

### Builder

The primary implementation agent. Has full tool access including write, edit, and bash. Runs with supervised autonomy and retries on failure.

### Reviewer

Analyzes code for bugs, security issues, and improvements. Runs tests if available. Readonly tools only. Reports findings without modifying files.

### Plan-Reviewer

Challenges assumptions in proposed plans. Evaluates feasibility against the actual codebase. Flags risks and gaps. Readonly.

### Documenter

Writes and updates documentation, READMEs, and code comments. Has write access to match the existing documentation style.

### Red-Team

Security testing and adversarial analysis. Readonly. Probes for vulnerabilities, injection points, and security misconfigurations.

## Agent Spec Schema

Each agent in `panagents.yaml` supports these fields:

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `description` | string | required | Human-readable purpose |
| `model` | string | none | Model override. Supports `${ENV_VAR}` expansion. |
| `tools` | string[] | varies | Tool allowlist for this agent |
| `sampling` | string | `"general"` | Sampling preset (general, coding) |
| `readonly` | boolean | false | If true, no file mutations allowed |
| `runtime` | string | `"pi"` | Runtime: `pi`, `cli:claude-code`, `cli:codex`, etc. |
| `runtime_args` | string[] | [] | Extra CLI arguments for the runtime |
| `tier` | string | `"any"` | Recommended model tier: `frontier`, `mid`, `any` |
| `prompt` | string | `"default"` | Prompt source. `default` uses PanPrompt engine. |
| `speed` | string | `"balanced"` | `fast`, `balanced`, or `thorough` |
| `token_budget` | number | 4000 | Max output tokens |
| `autonomy` | string | `"supervised"` | `autonomous`, `supervised`, `confirmatory` |
| `isolation` | string | `"none"` | `none`, `worktree`, `container` (future) |
| `max_turns` | number | 10 | Max conversation turns before timeout |
| `retry_on_failure` | boolean | false | Auto-retry on non-zero exit |
| `tags` | string[] | [] | Tags for routing and filtering |
| `system_prompt` | string | required | Instructions for the agent |

### Example Agent Definition

```yaml
agents:
  my-custom-agent:
    description: "Specialized TypeScript refactoring agent"
    model: ${PANCODE_WORKER_MODEL}
    tools: [read, write, edit, bash, grep, find, ls]
    sampling: coding
    readonly: false
    runtime: pi
    tier: mid
    prompt: default
    speed: balanced
    token_budget: 8000
    autonomy: supervised
    isolation: none
    max_turns: 20
    retry_on_failure: true
    tags: [refactoring, typescript]
    system_prompt: "You are a TypeScript refactoring specialist. Analyze code for opportunities to simplify, deduplicate, and improve type safety. Apply changes incrementally."
```

## Agent Class Profiles

PanCode defines three agent classes with distinct operational envelopes:

| Class | Context Window | Temperature | Reasoning | Max Tool Calls |
|-------|---------------|-------------|-----------|----------------|
| Orchestrator | 262,144 tokens | 0.6 | Enabled | Unlimited |
| Worker | 200,000 tokens | 0.3 | Disabled | Unlimited |
| Scout | 100,000 tokens | 0.1 | Disabled | 15 |

These profiles apply regardless of which model is used. A scout running a large model and a scout running a small model both use the same temperature and tool call limits.

## Managing Agents

### List Agents

```
/agents
```

Displays a table with agent name, model, speed, autonomy, tags, and readonly status.

### Modify Agent Fields at Runtime

```
/agents set <name> <field> <value>
```

Supported fields: `runtime`, `model`, `tier`.

Examples:

```
/agents set builder runtime cli:claude-code
/agents set reviewer model localhost-ollama/llama3.2
/agents set scout tier any
```

Changes are persisted to `~/.pancode/panagents.yaml`.

## Runtimes

PanCode supports multiple runtime backends. Each agent specifies which runtime to use.

### Available Runtimes

| Runtime ID | Type | Description |
|------------|------|-------------|
| `pi` | native | Built-in Pi SDK runtime. Full control over tools, model, and safety. |
| `cli:claude-code` | cli | Claude Code headless subprocess |
| `cli:codex` | cli | OpenAI Codex CLI |
| `cli:gemini` | cli | Gemini CLI |
| `cli:opencode` | cli | opencode CLI |
| `cli:copilot-cli` | cli | GitHub Copilot CLI |

Discovery at boot scans PATH for known binaries and registers them automatically.

### View Runtimes

```
/runtimes
```

Shows each runtime with type, tier, version, status, and binary path.

## Worker Pool

The worker pool materializes from the cross-product of agent specs, available runtimes, and discovered models. Each worker gets a composite score based on availability, capacity, load, capability, and cost.

```
/workers
```

Shows all materialized workers with their scoring breakdown.

## Skills

Skills are markdown-defined capabilities discovered from the project directory. PanCode scans `.pancode/skills/`, `.claude/`, `.codex/`, and `.gemini/` for `SKILL.md` and `*.skill.md` files.

```
/skills              List discovered skills
/skills show <name>  Show skill details
/skills validate     Check skill tool requirements
```

## See Also

- [Teams Guide](./teams.md): Multi-agent team definitions
- [Providers Guide](./providers.md): Configure model providers
- [Custom Agent Tutorial](../tutorials/custom-agent.md): Step-by-step agent creation
- [Commands Reference](../reference/commands.md): All slash commands
