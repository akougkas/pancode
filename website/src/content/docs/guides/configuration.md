---
title: "Configuration"
description: "Configure PanCode providers, models, and behavior"
---

:::caution[Experimental Preview]
This is an experimental preview release. APIs, commands, and features may change without notice.
:::


PanCode uses a 6-layer configuration system where each layer overrides the one below it. Configuration is conversational by default: ask the orchestrator to change settings rather than editing files manually.

## Configuration Resolution Order

Priority from highest to lowest:

1. **Runtime overrides**: Changes made via `/settings`, conversational PanConfigure tools, or keyboard shortcuts during a session
2. **Environment variables**: `PANCODE_*` variables from your shell or `.env` file
3. **Project config**: `.pancode/settings.json` in the current project directory
4. **Global config**: `~/.pancode/settings.json` for user-wide preferences
5. **Preset values**: Applied from `panpresets.yaml` when `--preset` is used
6. **Defaults**: Hard-coded values from the PanCode source

## Configuration Fields

The `PanCodeConfig` object contains all runtime configuration:

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `profile` | string | `"standard"` | Config profile name |
| `domains` | string[] | 9 domains | Enabled PanCode domains |
| `safety` | SafetyLevel | `"auto-edit"` | Safety enforcement level |
| `reasoningPreference` | string | `"medium"` | Reasoning/thinking level |
| `theme` | string | `"dark"` | TUI theme name |
| `prompt` | string | `"list files..."` | Default prompt |
| `provider` | string or null | null | Provider override |
| `model` | string or null | null | Model override (provider/model-id) |
| `preferredProvider` | string or null | null | Preferred provider for resolution |
| `preferredModel` | string or null | null | Preferred model for resolution |
| `tools` | string | `"read,bash,grep,find,ls"` | Default tool set |
| `timeoutMs` | number | 120000 | Default timeout in milliseconds |

### Safety Levels

| Level | Description |
|-------|-------------|
| `suggest` | Read-only. Model suggests changes but cannot write files. |
| `auto-edit` | File reads and edits allowed. Destructive actions gated. |
| `full-auto` | All operations allowed without confirmation. |

### Reasoning Preferences

| Level | Description |
|-------|-------------|
| `off` | No reasoning/thinking |
| `minimal` | Minimal internal reasoning |
| `low` | Light reasoning |
| `medium` | Balanced (default) |
| `high` | Extended reasoning |
| `xhigh` | Maximum reasoning depth |

### Default Enabled Domains

```
safety, session, agents, prompts, dispatch,
observability, scheduling, panconfigure, ui
```

The `intelligence` domain is opt-in and requires `PANCODE_INTELLIGENCE=enabled`.

## Preset System

Presets bundle model, reasoning, and safety settings into named configurations. They live in `~/.pancode/panpresets.yaml`.

### Built-in Presets

PanCode seeds four presets on first run:

| Preset | Description | Model Source |
|--------|-------------|--------------|
| `local` | Local inference via homelab engines | `PANCODE_MODEL` env var |
| `openai` | OpenAI (user fills in model IDs) | Not set by default |
| `openai-max` | OpenAI with high reasoning | Not set by default |
| `hybrid` | Local orchestrator, remote workers | `PANCODE_MODEL` + custom worker |

### Preset Schema

```yaml
local:
  description: "Local inference via homelab engines"
  model: localhost-ollama/llama3.2       # Orchestrator model
  workerModel: dynamo-ollama/codellama   # Worker model override
  scoutModel: localhost-ollama/llama3.2  # Scout model override
  reasoning: medium                       # off|minimal|low|medium|high|xhigh
  safety: auto-edit                       # suggest|auto-edit|full-auto
```

### Using Presets

```bash
# At boot
pancode --preset local

# At runtime
/preset local
/preset          # List available presets
```

CLI flags (`--model`, `--safety`) take precedence over preset values.

### Editing Presets

Edit `~/.pancode/panpresets.yaml` directly. PanCode never overwrites this file after initial creation. Changes take effect on next boot or `/preset` application.

## Settings Files

### Global Settings: `~/.pancode/settings.json`

User-wide preferences persisted across all projects.

```json
{
  "theme": "dark",
  "safetyMode": "auto-edit",
  "reasoningPreference": "medium",
  "preferredProvider": "localhost-ollama",
  "preferredModel": "localhost-ollama/llama3.2"
}
```

### Project Settings: `.pancode/settings.json`

Per-project overrides. Same fields as global settings. Takes priority over global.

```json
{
  "safetyMode": "full-auto",
  "preferredModel": "dynamo-lmstudio/qwen2.5-coder"
}
```

## PanConfigure (Conversational Config)

PanCode provides two tools for the orchestrator to read and modify configuration through conversation:

### `pan_read_config`

Available in all modes. Reads current configuration values with types, defaults, and descriptions.

```
You: "Show me the current configuration"
You: "What is the budget ceiling?"
You: "Read the dispatch config"
```

Optional domain filter: `runtime`, `models`, `budget`, `dispatch`, `preset`.

### `pan_apply_config`

Applies configuration changes. Some parameters are admin-only and require Admin mode (Alt+A).

```
You: "Set the budget ceiling to $20"
You: "Change safety to full-auto"
```

Admin-only parameters include `dispatch.timeout`, `dispatch.maxDepth`, and `dispatch.concurrency`.

## Environment Variables

Key environment variables for configuration:

| Variable | Purpose |
|----------|---------|
| `PANCODE_MODEL` | Orchestrator model (provider/model-id) |
| `PANCODE_WORKER_MODEL` | Default worker model |
| `PANCODE_SCOUT_MODEL` | Scout model |
| `PANCODE_SAFETY` | Safety level |
| `PANCODE_REASONING` | Reasoning preference |
| `PANCODE_THEME` | TUI theme |
| `PANCODE_PROFILE` | Config profile |
| `PANCODE_BUDGET_CEILING` | Budget ceiling in dollars |
| `PANCODE_LOCAL_MACHINES` | Additional machines for discovery |
| `PANCODE_VERBOSE` | Enable verbose logging |
| `PANCODE_HOME` | Override base config directory |

For the complete list, see the [Environment Variables Reference](../reference/environment-variables.md).

## `.env` File

PanCode reads a `.env` file from the project root at startup. Variables already set in the shell are not overwritten.

```bash
# .env
PANCODE_MODEL=localhost-ollama/llama3.2
PANCODE_WORKER_MODEL=dynamo-ollama/codellama
PANCODE_BUDGET_CEILING=25.00
PANCODE_LOCAL_MACHINES=mini=192.168.86.141,dynamo=192.168.86.143
ANTHROPIC_API_KEY=sk-ant-...
```

## Runtime State vs. User Config

PanCode maintains a clear separation:

**User config** (preserved across resets):
- `~/.pancode/panpresets.yaml`
- `~/.pancode/panagents.yaml`
- `~/.pancode/settings.json`
- `~/.pancode/agent-engine/auth.json`

**Runtime state** (cleared by `pancode reset` or `--fresh`):
- `.pancode/runs.json`, `metrics.json`, `budget.json`, `tasks.json`
- `.pancode/runtime/` (board.json, worker results)
- `~/.pancode/agent-engine/sessions/`

## See Also

- [Configuration Reference](../reference/configuration-reference.md): Complete schema for all config fields
- [Environment Variables](../reference/environment-variables.md): Every environment variable
- [Quick Start](../getting-started/quick-start.md): First-time setup walkthrough
