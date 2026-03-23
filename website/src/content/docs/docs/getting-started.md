---
title: Getting Started
---

# Getting Started

This is the shortest path from a fresh checkout to a running PanCode shell.

## Prerequisites

- Node.js 20 or newer
- npm
- `tmux`
- At least one model provider
  - Local: LM Studio, Ollama, or llama.cpp
  - Cloud: API key for a supported provider

## Install

```bash
npm install -g pancode
```

For development, use a workspace link instead:

```bash
npm link
```

## First Launch

```bash
pancode
```

That starts a new tmux session and opens the PanCode shell. Use a preset at
boot with:

```bash
pancode --preset local
```

PanCode always boots inside tmux. The top-level CLI subcommands are:

- `pancode` - start a new session
- `pancode up` - reattach to the most recent session or a named session
- `pancode down` - stop the most recent session, a named session, or `--all`
- `pancode sessions` or `pancode --sessions` - list running sessions
- `pancode login` - print the in-shell login instructions
- `pancode version` - print the installed version

## Provider Setup

PanCode auto-discovers local engines at boot.

- LM Studio on `http://127.0.0.1:1234`
- Ollama on `http://127.0.0.1:11434`
- llama.cpp on `http://127.0.0.1:8080`

Additional machines can be added with `PANCODE_LOCAL_MACHINES`:

```bash
PANCODE_LOCAL_MACHINES=mini=192.168.86.141,dynamo=192.168.86.143
```

Discovery is cache-aware. Known providers are probed faster on warm boot.

## Essential Environment Variables

The minimal model-selection surface is:

- `PANCODE_MODEL` - orchestrator model
- `PANCODE_WORKER_MODEL` - default model for dispatched workers
- `PANCODE_SCOUT_MODEL` - model for shadow scouts
- `PANCODE_LOCAL_MACHINES` - extra discovery targets for local engines

The checked-in `.env` sample seeds those values for the PanCode homelab.

## First Dispatch

Once the shell opens, type a task in plain language. PanCode interprets the
request, compiles the orchestrator prompt, and dispatches a worker when the
current mode allows it.

Example:

```text
You: Review the dispatch admission logic for edge cases.

PanCode: Dispatching to reviewer worker...
         worker completed with 3 findings
         open /audit for the full run history
```

If you want to control the behavior before dispatching, switch modes with
`Shift+Tab` or `/mode`:

- `plan` - analyze and plan, no dispatch
- `build` - full dispatch and edits
- `review` - readonly review workers
- `admin` - full system management and diagnostics (Alt+A only)

## Core Shell Commands

- `/help` - show the command catalog
- `/status` - show session and dispatch summary
- `/models` - inspect loaded and available models
- `/settings` - inspect or change configuration
- `/mode` - switch the orchestrator mode
- `/preset` - inspect or apply a boot preset

## Stopping And Reattaching

- `pancode down` stops the current tmux session cleanly
- `pancode up` reattaches to a running session
- `pancode sessions` shows all PanCode sessions

## Next Read

- [Architecture](./architecture.md) for the layer map
- [Configuration](./configuration.md) for env vars and user state
- [Domains](./domains.md) for command ownership
