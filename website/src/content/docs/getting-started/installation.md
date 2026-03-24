---
title: "Installation"
description: "Install PanCode and its prerequisites"
---

:::caution[Experimental Preview]
This is an experimental preview release. APIs, commands, and features may change without notice.
:::


PanCode is a composable multi-agent runtime for software engineering. It orchestrates coding agents the way Kubernetes orchestrates containers.

## Prerequisites

| Requirement | Minimum Version | Purpose |
|-------------|-----------------|---------|
| Node.js | 20.0.0 | Runtime |
| npm | (bundled with Node) | Package management |
| tmux | Any recent version | Session management |
| LLM provider | At least one | Model inference |

PanCode requires tmux for session management. Every PanCode session runs inside a tmux session, enabling detach/reattach and persistent operation.

You need at least one LLM provider available. Options include:

- **Local engines**: Ollama (port 11434), LM Studio (port 1234), llama-server (port 8080)
- **Cloud APIs**: Set `ANTHROPIC_API_KEY` or `OPENAI_API_KEY` in your environment

## Install from npm

```bash
npm install -g pancode
```

Verify the installation:

```bash
pancode version
# 0.3.0
```

## Install from Source (Development)

```bash
git clone https://github.com/akougkas/pancode.git
cd pancode
npm install
npm link
```

This builds the Pi SDK packages and links the `pancode` binary to your PATH. The build process:

1. Builds four Pi SDK workspace packages (`pi-tui`, `pi-ai`, `pi-agent-core`, `pi-coding-agent`)
2. Bundles the PanCode application with tsup

To verify a development build:

```bash
npm run build          # Full production build
npm run typecheck      # TypeScript strict mode check
npm run check-boundaries  # Verify engine/worker isolation
pancode version        # Should print the current version
```

## Development Commands

```bash
npm run dev            # Dev mode (tsx, skips tmux wrapper)
npm run build          # Production build
npm run typecheck      # Must pass before any commit
npm run check-boundaries  # Engine + worker isolation check
npm run lint           # Biome linter
```

## Directory Structure

PanCode uses two directory locations for persistent data.

### User Configuration: `~/.pancode/`

Created on first run. Contains user-level configuration that survives reinstall.

```
~/.pancode/
  panpresets.yaml       # Boot presets (local, openai, hybrid, etc.)
  panagents.yaml        # Agent fleet definitions (7 default agents)
  panproviders.yaml     # Discovered provider endpoints (auto-generated)
  settings.json         # Global user preferences
  model-cache.yaml      # Cached model profiles for fast boot
  agent-engine/
    auth.json           # Provider authentication tokens
    sessions/           # Pi SDK session history
```

### Project Runtime: `.pancode/`

Created per project. Contains runtime state for the current project.

```
<project>/.pancode/
  settings.json         # Project-level config overrides
  runs.json             # Dispatch run history
  metrics.json          # Dispatch metrics
  budget.json           # Budget tracking state
  tasks.json            # Task list state
  runtime/
    board.json          # Shared coordination board
    results/            # Worker result files
```

## Environment Setup

PanCode reads a `.env` file from the project root at startup. Create one to configure your providers:

```bash
# .env
PANCODE_MODEL=localhost-ollama/llama3.2
PANCODE_WORKER_MODEL=localhost-ollama/codellama
PANCODE_SCOUT_MODEL=localhost-ollama/llama3.2
PANCODE_LOCAL_MACHINES=mini=192.168.86.141,dynamo=192.168.86.143
```

The loader sets these internal environment variables automatically:

| Variable | Value |
|----------|-------|
| `PANCODE_PACKAGE_ROOT` | Absolute path to PanCode installation |
| `PANCODE_HOME` | `~/.pancode` (or `$PANCODE_HOME` if set) |
| `PANCODE_AGENT_DIR` | `~/.pancode/agent-engine` |
| `PANCODE_BIN_PATH` | Path to the loader script |

## First Run

When you run `pancode` for the first time, it:

1. Creates `~/.pancode/` if it does not exist
2. Seeds `panpresets.yaml` with default presets
3. Seeds `panagents.yaml` with the 7-agent default fleet
4. Discovers local engines (Ollama, LM Studio, llama.cpp)
5. Starts an interactive tmux session

## Troubleshooting

### Node.js version too old

```
pancode requires Node.js 20 or newer.
```

Check your version with `node --version`. Use nvm or your system package manager to upgrade.

### tmux not installed

```
[pancode] tmux is not installed. Install tmux to use PanCode.
```

Install tmux:
- macOS: `brew install tmux`
- Ubuntu/Debian: `sudo apt install tmux`
- Fedora: `sudo dnf install tmux`

### No models available at boot

PanCode starts in degraded mode if no models are found. Start a local engine or set an API key:

```bash
# Option 1: Start Ollama
ollama serve

# Option 2: Set an API key
export ANTHROPIC_API_KEY=sk-...
```

Then restart PanCode or run `/doctor` inside the shell to diagnose.

## Next Steps

- [Quick Start](./quick-start.md): Launch PanCode and run your first dispatch
- [Configuration Guide](../guides/configuration.md): Customize PanCode for your workflow
- [Providers Guide](../guides/providers.md): Set up local and cloud LLM providers
