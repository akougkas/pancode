---
title: "Quick Start"
description: "Get PanCode running in under a minute"
---

:::caution[Experimental Preview]
This is an experimental preview release. APIs, commands, and features may change without notice.
:::


This guide walks you through launching PanCode, understanding the interface, and running your first dispatch. Total time: about 5 minutes.

## Launch PanCode

```bash
pancode
```

This creates a tmux session and starts the PanCode orchestrator. The session name is derived from your working directory (e.g., `pancode-a3f2b1`).

To start with a specific preset:

```bash
pancode --preset local     # Local inference engines
pancode --preset openai    # OpenAI models
pancode --preset hybrid    # Local orchestrator, remote workers
```

Presets are defined in `~/.pancode/panpresets.yaml` and configure the orchestrator model, worker model, reasoning level, and safety mode in one command.

## The Welcome Screen

On startup, PanCode displays a welcome screen showing:

- The active model and provider
- Current orchestrator mode (default: Build)
- Safety level (default: auto-edit)
- Reasoning preference (default: medium)
- Number of registered agents and runtimes
- Available slash commands

## Orchestrator Modes

PanCode has four orchestrator modes that control what the system does with your input. Modes are orthogonal to safety levels.

### Plan Mode

Analyze and plan without executing. Shadow agents explore the codebase. No dispatch, no file mutations. Reasoning level: high.

### Build Mode (Default)

Full dispatch capability. Workers implement, test, and review. File mutations allowed. Reasoning level: medium.

### Review Mode

Quality checks and code review. Only readonly agents can be dispatched. No file mutations. Reasoning level: xhigh.

### Admin Mode (God Mode)

Full system management, configuration, and diagnostic dispatch. Safety escalates to full-auto, reasoning to xhigh. File mutations remain disabled. Toggle with Alt+A.

Switch modes with:

- **Shift+Tab**: Cycle through Plan, Build, and Review
- **Alt+A**: Toggle Admin mode
- **/modes admin|plan|build|review**: Switch by name

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| Shift+Tab | Cycle modes (Plan, Build, Review) |
| Alt+A | Toggle Admin (God Mode) |
| Ctrl+Y | Cycle safety level |
| Ctrl+D | Exit PanCode |
| Ctrl+O | Expand tool output |
| Ctrl+T | Toggle thinking visibility |

## Safety Levels

PanCode enforces three safety levels that control what actions are allowed:

| Level | Behavior |
|-------|----------|
| `suggest` | Read-only tools only. Model suggests changes but cannot execute them. |
| `auto-edit` | File reads and edits allowed. Destructive operations require confirmation. |
| `full-auto` | All operations allowed without confirmation. |

Cycle with Ctrl+Y or use `/safety`.

## Essential Slash Commands

Try these commands to explore PanCode:

```
/help              Show all available commands
/agents            List the 7-agent fleet
/models            List discovered models
/doctor            Run diagnostic health checks
/budget            Show dispatch budget status
/dashboard         Open the session dashboard
/session           Show session info and coordination state
/runtimes          List discovered agent runtimes
/workers           Show the worker pool with scores
```

## Your First Dispatch

In Build mode, ask PanCode to perform a task. The orchestrator decides whether to handle it directly or dispatch a worker.

For tasks that benefit from delegation, the orchestrator uses the `dispatch_agent` tool:

```
You: "Review the code in src/core/config.ts for potential issues"
```

PanCode may dispatch a reviewer agent to analyze the file. The worker runs as a separate subprocess with its own context window and returns results to the orchestrator.

You can also be explicit:

```
You: "Dispatch the scout agent to explore the test directory structure"
```

### Monitoring Dispatches

While workers are running, the footer shows active dispatch status. After completion:

```
/runs              View dispatch history
/cost              See per-run cost breakdown
/metrics           View aggregate statistics
/receipt           List reproducibility receipts
```

## Session Management

PanCode sessions persist in tmux. You can detach and reattach freely.

### From Outside PanCode

```bash
pancode sessions     # List running sessions
pancode up           # Attach to most recent session
pancode up pancode-a3f2b1   # Attach to specific session
pancode down         # Stop most recent session
pancode down --all   # Stop all sessions
```

### From Inside PanCode

```
/exit              Exit the current session
/session           Show session info
/checkpoint label  Save a session checkpoint
/reset             Reset coordination state
```

## Configuration at a Glance

PanCode uses conversational configuration. Ask the orchestrator to change settings:

```
You: "Set the budget ceiling to $20"
You: "Switch to the openai preset"
You: "Change reasoning to high"
```

In Admin mode, you can modify administrative parameters:

```
You: "Set dispatch timeout to 5 minutes"
You: "Set max dispatch depth to 3"
```

Quick toggles via keyboard shortcuts handle the most common changes (mode, safety, reasoning).

## The Dashboard

Run `/dashboard` to see a visual summary:

- Mode badge and safety level
- Active dispatches with progress
- Session statistics (runs, cost, tokens)
- Context window usage bar
- Budget status

## Next Steps

- [Configuration Guide](../guides/configuration.md): Deep dive into the 6-layer config system
- [Agents Guide](../guides/agents.md): Understand and customize the agent fleet
- [Providers Guide](../guides/providers.md): Set up local and cloud LLM providers
- [Commands Reference](../reference/commands.md): Complete list of all slash commands
- [Multi-Agent Dispatch Tutorial](../tutorials/multi-agent-dispatch.md): Advanced dispatch patterns
