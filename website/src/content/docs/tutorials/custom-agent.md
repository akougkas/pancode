---
title: "Custom Agent"
description: "Create a custom agent adapter"
---

:::caution[Experimental Preview]
This is an experimental preview release. APIs, commands, and features may change without notice.
:::


This tutorial walks through adding a custom agent to PanCode, from definition to dispatch.

## Overview

PanCode agents are defined in `~/.pancode/panagents.yaml`. Each agent specifies tools, system prompt, model preferences, and operational parameters. Adding a new agent requires editing one YAML file.

## Step 1: Open the Agent Configuration

```bash
$EDITOR ~/.pancode/panagents.yaml
```

The file contains an `agents:` top-level key with nested agent definitions.

## Step 2: Define Your Agent

Add a new entry under the `agents:` key:

```yaml
agents:
  # ... existing agents ...

  ts-refactorer:
    description: "TypeScript refactoring specialist"
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
    tags: [refactoring, typescript, mutable]
    system_prompt: >
      You are a TypeScript refactoring specialist. Your job is to improve
      code quality without changing behavior. Focus on: type safety improvements,
      reducing duplication, simplifying complex functions, improving naming,
      and extracting reusable utilities. Always verify the project still
      compiles after changes by running the typecheck command.
```

## Step 3: Understanding Each Field

### Identity

| Field | Purpose |
|-------|---------|
| `description` | Human-readable purpose, shown in `/agents` |
| `tags` | Used for routing and filtering in the worker pool |

### Model and Runtime

| Field | Purpose |
|-------|---------|
| `model` | Model to use. Supports `${ENV_VAR}` expansion. |
| `runtime` | Execution backend. `pi` for native, or `cli:*` for CLI agents. |
| `runtime_args` | Extra arguments passed to CLI runtimes. |
| `tier` | Recommended model capability tier. |

**Tier values:**
- `frontier`: Requires the best available model (for complex reasoning)
- `mid`: Good general-purpose model (for most tasks)
- `any`: Works with any model (for simple tasks)

### Tools

| Field | Purpose |
|-------|---------|
| `tools` | Tool allowlist. Only these tools are available to the agent. |

Common tool sets:
- Readonly: `[read, grep, find, ls]`
- Standard: `[read, write, edit, bash, grep, find, ls]`
- Minimal: `[read, grep, find]`

### Operational Parameters

| Field | Purpose |
|-------|---------|
| `speed` | `fast`, `balanced`, or `thorough`. Affects routing priority. |
| `token_budget` | Maximum output tokens for this agent. |
| `max_turns` | Maximum conversation turns before timeout. |
| `autonomy` | Confirmation behavior. |
| `isolation` | Filesystem isolation strategy. |
| `retry_on_failure` | Whether to auto-retry on non-zero exit. |
| `readonly` | If true, the safety system prevents all file mutations. |
| `sampling` | Sampling preset (`general` or `coding`). |

**Autonomy levels:**
- `autonomous`: No confirmation needed for any action
- `supervised`: Confirm destructive operations
- `confirmatory`: Confirm every action

**Isolation modes:**
- `none`: Shared workspace with the orchestrator
- `worktree`: Git worktree for filesystem isolation
- `container`: Container isolation (planned for future release)

### System Prompt

The `system_prompt` field contains the agent's instructions. Write specific, actionable instructions:

```yaml
system_prompt: >
  You are a security auditor. Analyze code for:
  1. SQL injection vulnerabilities
  2. XSS attack vectors
  3. Authentication bypasses
  4. Sensitive data exposure
  Report each finding with severity (critical/high/medium/low),
  affected file and line, and recommended fix. Do not modify files.
```

Use YAML block scalar (`>` for folded, `|` for literal) for multi-line prompts.

## Step 4: Verify the Agent

Restart PanCode or start a new session. Then check:

```
/agents
```

Your new agent should appear in the table.

## Step 5: Dispatch to Your Agent

```
You: "Dispatch the ts-refactorer agent to refactor src/core/config.ts"
```

Or be explicit about using your custom agent:

```
You: "Use the ts-refactorer to improve type safety in the auth module"
```

## Using CLI Runtimes

To use a CLI agent runtime instead of the built-in Pi runtime:

### Step 1: Verify the CLI Agent is Installed

```
/runtimes
```

PanCode discovers CLI agents at boot by scanning PATH. Supported runtimes:

| Runtime ID | Binary |
|------------|--------|
| `cli:claude-code` | `claude` |
| `cli:codex` | `codex` |
| `cli:gemini` | `gemini` |
| `cli:opencode` | `opencode` |
| `cli:cline` | `cline` |
| `cli:copilot-cli` | `github-copilot-cli` |

### Step 2: Define an Agent Using That Runtime

```yaml
agents:
  claude-reviewer:
    description: "Claude Code for thorough code review"
    runtime: cli:claude-code
    readonly: true
    tier: frontier
    speed: thorough
    token_budget: 8000
    autonomy: autonomous
    isolation: none
    max_turns: 15
    retry_on_failure: false
    tags: [review, readonly, claude]
    system_prompt: "Review the provided code for bugs, security issues, and improvements. Be thorough."
```

Note: CLI agents use their own model selection. The `model` field in the agent spec is not used for CLI runtimes.

### Step 3: Dispatch

```
You: "Dispatch the claude-reviewer to review src/domains/dispatch/extension.ts"
```

## Modifying Agents at Runtime

You can change certain agent fields without editing YAML:

```
/agents set ts-refactorer model dynamo-ollama/qwen2.5-coder-32b
/agents set ts-refactorer tier frontier
/agents set ts-refactorer runtime cli:claude-code
```

Changes are persisted to `~/.pancode/panagents.yaml`.

## Example: A Documentation Audit Agent

```yaml
agents:
  doc-auditor:
    description: "Documentation completeness and accuracy auditor"
    model: ${PANCODE_WORKER_MODEL}
    tools: [read, grep, find, ls]
    sampling: general
    readonly: true
    runtime: pi
    tier: any
    prompt: default
    speed: thorough
    token_budget: 6000
    autonomy: autonomous
    isolation: none
    max_turns: 15
    retry_on_failure: false
    tags: [docs, audit, readonly]
    system_prompt: >
      You are a documentation auditor. For each source file you examine:
      1. Check if corresponding documentation exists
      2. Verify documented behavior matches actual code
      3. Identify undocumented public APIs
      4. Flag stale or misleading comments
      Report findings in a structured format with file paths and line numbers.
```

## See Also

- [Agents Guide](../guides/agents.md): Complete agent spec reference
- [Providers Guide](../guides/providers.md): Model and runtime configuration
- [Multi-Agent Dispatch](./multi-agent-dispatch.md): Dispatch patterns and monitoring
