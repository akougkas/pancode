---
title: "Modes and Presets"
description: "Behavioral modes and configuration presets"
---

:::caution[Experimental Preview]
This is an experimental preview release. APIs, commands, and features may change without notice.
:::


PanCode's behavior is configured through activity modes (what the system does)
and presets (named boot configurations). This document covers both systems and
how they interact.

## Activity Modes

PanCode operates in one of four activity modes. Modes physically gate which
tools the LLM sees, providing structural control over the orchestrator's
capabilities.

### Mode Reference

| Mode | Keyboard | Description |
|------|----------|-------------|
| **Plan** | Shift+Tab | Analysis and exploration. Read-only tools + shadow explore. No dispatch, no mutations. |
| **Build** | Shift+Tab | Full development. All tools including edit, write, dispatch. |
| **Review** | Shift+Tab | Quality checks. Read-only tools + dispatch for review workers. No mutations. |
| **Admin** | Alt+A | God mode. Full system management, config tools, diagnostic dispatch. No file mutations. |

### Mode Cycling

**Shift+Tab** cycles through plan, build, review in order. Admin is excluded
from this cycle to prevent accidental activation.

**Alt+A** toggles Admin mode directly. Pressing Alt+A from any mode enters
Admin. Pressing Alt+A while in Admin returns to the previous mode.

### Tool Visibility Per Mode

Each mode defines exactly which tools the LLM can see:

| Tool Category | Admin | Plan | Build | Review |
|--------------|-------|------|-------|--------|
| Read-only (read, bash, grep, find, ls) | Yes | Yes | Yes | Yes |
| Mutable (edit, write) | No | No | Yes | No |
| Shadow explore | Yes | Yes | Yes | Yes |
| Task tools (task_write, task_check, etc.) | Yes | Yes | Yes | No |
| Dispatch (dispatch_agent, batch_dispatch, chain) | Yes | No | Yes | Yes |
| Config (pan_read_config, pan_apply_config) | Yes | Yes | Yes | Yes |

### Reasoning Levels

Each mode has a preferred reasoning level that controls how deeply the LLM
thinks:

| Mode | Reasoning Level | Rationale |
|------|----------------|-----------|
| Admin | xhigh | System management needs deep analysis |
| Plan | high | Planning benefits from thorough reasoning |
| Build | medium | Execution needs efficiency over depth |
| Review | xhigh | Quality review needs careful analysis |

The reasoning level is clamped to model capabilities at runtime. If the model
does not support `xhigh` reasoning, the system falls back to the highest
supported level.

### Mode State

The current mode is managed by `src/core/modes.ts`:

```typescript
export type OrchestratorMode = "admin" | "plan" | "build" | "review";

let currentMode: OrchestratorMode = "build";

export function getCurrentMode(): OrchestratorMode;
export function setCurrentMode(mode: OrchestratorMode): void;
export function getModeDefinition(mode?: OrchestratorMode): ModeDefinition;
```

The default mode at boot is `build`.

## Presets

Presets are named boot configurations stored in `~/.pancode/panpresets.yaml`.
Each preset bundles model selection, reasoning level, and safety mode into a
single named configuration.

### Preset Structure

```typescript
interface Preset {
  name: string;
  description: string;
  model: string;              // Orchestrator model
  workerModel: string | null; // Worker model (null = use orchestrator model)
  scoutModel: string | null;  // Scout model for shadow explore
  reasoning: PanCodeReasoningPreference;
  safety: SafetyLevel;
}
```

### Default Presets

PanCode seeds `panpresets.yaml` on first run with four default presets:

```yaml
local:
  description: Local inference via homelab engines
  model: <from PANCODE_MODEL env var>
  workerModel: <from PANCODE_WORKER_MODEL>
  scoutModel: <from PANCODE_SCOUT_MODEL>
  reasoning: medium
  safety: auto-edit

openai:
  description: OpenAI (edit model IDs to match your subscription)
  reasoning: medium
  safety: auto-edit

openai-max:
  description: OpenAI high reasoning (edit model IDs to match your subscription)
  reasoning: high
  safety: full-auto

hybrid:
  description: Local orchestrator with remote workers (edit worker model)
  model: <from PANCODE_MODEL>
  scoutModel: <from PANCODE_SCOUT_MODEL>
  reasoning: medium
  safety: auto-edit
```

PanCode never overwrites this file after creation. Users edit it directly to
add or modify presets.

### Using Presets

**At boot:**
```bash
pancode --preset local
```

**During a session:**
```
/preset local
```

### Creating Custom Presets

Edit `~/.pancode/panpresets.yaml` to add custom presets:

```yaml
fast-local:
  description: Fast local models for quick iterations
  model: qwen2.5-coder:7b
  workerModel: qwen2.5-coder:3b
  scoutModel: qwen2.5-coder:1.5b
  reasoning: low
  safety: full-auto

cloud-review:
  description: Cloud models for thorough code review
  model: claude-sonnet-4-20250514
  reasoning: high
  safety: suggest
```

### Preset File Location

The presets file lives at `~/.pancode/panpresets.yaml`. The path is derived
from the PanCode home directory. PanCode seeds the file on first run and never
modifies it afterward.

## Configuration Resolution

PanCode resolves configuration from multiple sources, highest priority first:

1. **Runtime overrides**: `/settings` command during a session
2. **Environment variables**: `PANCODE_*` prefix
3. **Preset overrides**: `--preset` flag at boot
4. **Project config**: `<project>/.pancode/settings.json`
5. **Global config**: `~/.pancode/settings.json`
6. **Defaults**: `src/core/defaults.ts`

### Key Environment Variables

| Variable | Purpose | Default |
|----------|---------|---------|
| `PANCODE_MODEL` | Orchestrator model | (none) |
| `PANCODE_WORKER_MODEL` | Default worker model | (none) |
| `PANCODE_SCOUT_MODEL` | Scout/shadow model | (none) |
| `PANCODE_SAFETY` | Safety level | `auto-edit` |
| `PANCODE_REASONING` | Reasoning preference | `medium` |
| `PANCODE_THEME` | TUI theme | `dark` |
| `PANCODE_TIMEOUT_MS` | Tool execution timeout | `120000` |
| `PANCODE_PROJECT` | Project working directory | `.` |
| `PANCODE_PROFILE` | Boot profile | `standard` |
| `PANCODE_INTELLIGENCE` | Intelligence domain | (disabled) |

### Project-Level Configuration

Projects can override global settings via `<project>/.pancode/settings.json`:

```json
{
  "theme": "light",
  "safetyMode": "auto-edit",
  "reasoningPreference": "high",
  "preferredProvider": "ollama",
  "preferredModel": "qwen2.5-coder:32b"
}
```

## Mode and Safety Interaction

Mode and safety are independent axes. Mode controls tool visibility (structural).
Safety controls action permission (policy). They compose multiplicatively:

| Configuration | Effect |
|--------------|--------|
| Build + auto-edit | Standard development. Full tool access, standard permissions. |
| Build + suggest | Tools visible but most actions blocked. Useful for dry-run exploration. |
| Plan + full-auto | Shadow explore works, but dispatch is structurally invisible. |
| Review + auto-edit | Dispatch enabled for review workers. No file mutations. |
| Admin + full-auto | Maximum system access. Dispatch enabled, all config accessible. |

The `/modes` command shows the current mode and available modes.
The `/safety` command shows the current safety level.

## Runtime Configuration Changes

During a session, configuration can be changed through:

- **Keyboard shortcuts**: Shift+Tab (mode), Ctrl+Y (safety), Alt+A (Admin)
- **Slash commands**: `/preset`, `/settings`, `/safety`, `/modes`, `/reasoning`
- **Config tools**: `pan_read_config` and `pan_apply_config` (LLM-callable)

Changes take effect immediately. Mode changes update the active tool set.
Safety changes update the policy matrix. Preset changes update model, reasoning,
and safety simultaneously.

## Cross-References

- [Core Concepts](../getting-started/core-concepts.md): overview of modes and safety
- [Safety](./safety.md): complete 4-layer behavioral model
- [Architecture Overview](../architecture/overview.md): configuration resolution
