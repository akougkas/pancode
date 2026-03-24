---
title: "Configuration Reference"
description: "Full configuration file reference"
---

:::caution[Experimental Preview]
This is an experimental preview release. APIs, commands, and features may change without notice.
:::


Complete schema reference for all PanCode configuration fields, settings files, presets, and agent specs.

## PanCodeConfig Schema

The main runtime configuration object.

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `packageRoot` | string | (auto) | Absolute path to PanCode installation |
| `cwd` | string | (auto) | Working directory for the session |
| `profile` | string | `"standard"` | Config profile name |
| `domains` | string[] | (see below) | Enabled PanCode domains |
| `extensions` | string[] | (same as domains) | Backward-compatible alias |
| `safety` | SafetyLevel | `"auto-edit"` | Safety enforcement level |
| `reasoningPreference` | string | `"medium"` | Reasoning/thinking level |
| `theme` | string | `"dark"` | TUI theme name |
| `prompt` | string | `"list files in the current directory"` | Default prompt |
| `provider` | string or null | null | Provider override |
| `model` | string or null | null | Model override (provider/model-id) |
| `preferredProvider` | string or null | null | Preferred provider for resolution |
| `preferredModel` | string or null | null | Preferred model for resolution |
| `tools` | string | `"read,bash,grep,find,ls"` | Default tool set |
| `timeoutMs` | number | `120000` | Default timeout in milliseconds |
| `runtimeRoot` | string | (auto) | Path to `.pancode/runtime/` |
| `resultsDir` | string | (auto) | Path to `.pancode/runtime/results/` |

### SafetyLevel Values

| Value | Description |
|-------|-------------|
| `"suggest"` | Read-only tools only. Model suggests changes. |
| `"auto-edit"` | File reads and edits allowed. Destructive actions gated. |
| `"full-auto"` | All operations allowed without confirmation. |

### ReasoningPreference Values

| Value | Description |
|-------|-------------|
| `"off"` | No reasoning/thinking |
| `"minimal"` | Minimal internal reasoning |
| `"low"` | Light reasoning |
| `"medium"` | Balanced reasoning (default) |
| `"high"` | Extended reasoning |
| `"xhigh"` | Maximum reasoning depth |

### Default Enabled Domains

```
safety, session, agents, prompts, dispatch,
observability, scheduling, panconfigure, ui
```

The `intelligence` domain is opt-in via `PANCODE_INTELLIGENCE=enabled`.

## Settings File Schema

Both `~/.pancode/settings.json` (global) and `.pancode/settings.json` (project) share the same schema.

```json
{
  "theme": "dark",
  "safetyMode": "auto-edit",
  "reasoningPreference": "medium",
  "preferredProvider": "localhost-ollama",
  "preferredModel": "localhost-ollama/llama3.2"
}
```

| Field | Type | Description |
|-------|------|-------------|
| `theme` | string | TUI theme name |
| `safetyMode` | SafetyLevel | Safety enforcement level |
| `reasoningPreference` | string | Reasoning level |
| `preferredProvider` | string | Default provider for model resolution |
| `preferredModel` | string | Default model reference |

## Preset Schema

Presets are defined in `~/.pancode/panpresets.yaml`.

```yaml
local:
  description: "Local inference via homelab engines"
  model: localhost-ollama/llama3.2
  workerModel: dynamo-ollama/codellama
  scoutModel: localhost-ollama/llama3.2
  reasoning: medium
  safety: auto-edit
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `description` | string | No | Human-readable description |
| `model` | string | Yes | Orchestrator model (provider/model-id) |
| `workerModel` | string or null | No | Worker model override |
| `scoutModel` | string or null | No | Scout model override |
| `reasoning` | string | No | Reasoning level (default: medium) |
| `safety` | SafetyLevel | No | Safety level (default: auto-edit) |

## Agent Spec Schema

Agent specifications in `~/.pancode/panagents.yaml`.

```yaml
agents:
  agent-name:
    description: "Agent purpose"
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
    tags: [coding, mutable]
    system_prompt: "Instructions for the agent"
```

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `description` | string | required | Human-readable purpose |
| `model` | string | none | Model reference. Supports `${ENV_VAR}` expansion. |
| `tools` | string[] | varies | Tool allowlist |
| `sampling` | string | `"general"` | Sampling preset |
| `readonly` | boolean | `false` | If true, no file mutations |
| `system_prompt` | string | required | System prompt text |
| `runtime` | string | `"pi"` | Runtime backend |
| `runtime_args` | string[] | `[]` | Extra runtime CLI arguments |
| `tier` | string | `"any"` | Model tier: `frontier`, `mid`, `any` |
| `prompt` | string | `"default"` | Prompt source (`default` for PanPrompt) |
| `speed` | string | `"balanced"` | `fast`, `balanced`, `thorough` |
| `token_budget` | number | `4000` | Max output tokens |
| `autonomy` | string | `"supervised"` | `autonomous`, `supervised`, `confirmatory` |
| `isolation` | string | `"none"` | `none`, `worktree`, `container` |
| `max_turns` | number | `10` | Max conversation turns |
| `retry_on_failure` | boolean | `false` | Auto-retry on failure |
| `tags` | string[] | `[]` | Routing and filtering tags |

## Agent Class Profiles

Fixed operational envelopes for each agent class.

| Profile | Context Window | Temperature | Top-P | Top-K | Reasoning | Max Tool Calls |
|---------|---------------|-------------|-------|-------|-----------|----------------|
| Orchestrator | 262,144 | 0.6 | 0.95 | 20 | Yes | Unlimited |
| Worker | 200,000 | 0.3 | 0.9 | 40 | No | Unlimited |
| Scout | 100,000 | 0.1 | 0.9 | 40 | No | 15 |

## Mode Definitions

| Mode | Dispatch | Shadow | Mutations | Reasoning | Description |
|------|----------|--------|-----------|-----------|-------------|
| Admin | Yes | Yes | No | xhigh | Full system management |
| Plan | No | Yes | No | high | Analysis and planning |
| Build | Yes | Yes | Yes | medium | Implementation |
| Review | Yes | Yes | No | xhigh | Quality checks |

## Validation

PanCode validates configuration at load time:

- `profile`, `theme`, `prompt`: must be strings
- `provider`, `model`, `preferredProvider`, `preferredModel`: must be strings or null
- `safety`: must be `suggest`, `auto-edit`, or `full-auto`
- `reasoningPreference`: must be `off`, `on`, `minimal`, `low`, `medium`, `high`, or `xhigh`
- `domains`, `extensions`: must be arrays of strings
- `timeoutMs`: must be a positive finite number

Invalid project settings produce a warning on stderr and are skipped.

## See Also

- [Configuration Guide](../guides/configuration.md): Resolution order and usage patterns
- [Environment Variables](./environment-variables.md): All PANCODE_* variables
- [Agents Guide](../guides/agents.md): Agent fleet management
