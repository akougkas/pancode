# PanCode

Universal agent control plane for software engineering.

PanCode orchestrates coding agents through one tmux-first shell, one dispatch
system, and one safety model. The current tree ships 165 TypeScript files,
about 22.5k LOC, 10 composable domains, and 6 CLI runtime adapters. Native Pi
workers and installed CLI agents all run through the same runtime boundary.

See [docs/](./docs/README.md) for the full guide set.

## Highlights

- Tmux-first launcher: `pancode` starts a session, `pancode up` reattaches,
  `pancode down` stops, and `pancode version` prints the installed version.
- Shared runtime boundary: `src/engine/` is the only place that imports the
  vendored Pi SDK packages.
- Dispatch hardening: recursion depth guard, provider backoff and resilience,
  hard worker timeouts, long-prompt temp files, NDJSON progress parsing,
  staggered parallel launches, worktree isolation, and stale artifact cleanup.
- 10 composable domains: safety, session, agents, prompts, dispatch,
  observability, scheduling, intelligence, providers, and ui.
- 6 CLI runtime adapters plus native Pi: Claude Code, Codex, Gemini, OpenCode,
  Cline, and Copilot CLI.
- Model presets in `~/.pancode/panpresets.yaml`.
- Agent specs in `~/.pancode/panagents.yaml`.
- User settings in `~/.pancode/settings.json`.

## Documentation

- [Getting Started](./docs/getting-started.md)
- [Architecture](./docs/architecture.md)
- [Configuration](./docs/configuration.md)
- [Domains](./docs/domains.md)
- [Dispatch](./docs/dispatch.md)
- [Development](./docs/development.md)
- [Demo Scenarios](./docs/demos.md)

## Quick Start

### Prerequisites

- Node.js 20 or newer
- npm
- `tmux`
- At least one provider:
  - Local: LM Studio, Ollama, or llama.cpp
  - Cloud: a supported API key

### Install

```bash
npm install -g pancode
```

For local development, use a workspace link instead:

```bash
npm link
```

### Launch

```bash
pancode
pancode --preset local
```

`pancode` always starts inside tmux. Use `pancode up` to reattach to an
existing session and `pancode down` to stop it cleanly.

### Core Commands

| Command | Purpose |
|---------|---------|
| `pancode` | Start a new tmux session |
| `pancode up` | Reattach to the most recent session or a named session |
| `pancode down` | Stop the current session, a named session, or `--all` |
| `pancode sessions` | List running sessions |
| `pancode login` | Show the in-shell login instructions |
| `pancode version` | Print the installed version |
| `pancode --help` | Show the full CLI help |
| `pancode --version` | Print the version without starting the shell |

## Supported Runtimes

| Runtime | Tier | Binary | Output Parsing |
|---------|------|--------|----------------|
| Pi (native) | Native | built-in | NDJSON streaming + result file |
| Claude Code | CLI | `claude` | JSON structured output |
| Codex CLI | CLI | `codex` | JSON lines |
| Gemini CLI | CLI | `gemini` | JSON output |
| OpenCode | CLI | `opencode` | NDJSON |
| Cline CLI | CLI | `cline` | NDJSON |
| Copilot CLI | CLI | `copilot` | Text |

## Configuration

PanCode reads configuration from `.env`, environment variables, and user files
under `~/.pancode/`. The full reference lives in
[docs/configuration.md](./docs/configuration.md).

### Common Environment Variables

| Variable | Purpose | Default |
|----------|---------|---------|
| `PANCODE_MODEL` | Orchestrator model | Sample `.env` value |
| `PANCODE_WORKER_MODEL` | Default dispatched worker model | Sample `.env` value |
| `PANCODE_SCOUT_MODEL` | Shadow scout model | Sample `.env` value |
| `PANCODE_LOCAL_MACHINES` | Extra local discovery targets | Unset |
| `PANCODE_DEFAULT_AGENT` | Default dispatch agent | `dev` |
| `PANCODE_WORKER_TIMEOUT_MS` | Hard worker timeout in milliseconds | `300000` |
| `PANCODE_DISPATCH_MAX_DEPTH` | Dispatch recursion limit | `2` |
| `PANCODE_NODE_CONCURRENCY` | Max workers per node | `4` |
| `PANCODE_SAFETY` | Autonomy mode | `auto-edit` |
| `PANCODE_BUDGET_CEILING` | Session budget ceiling | `10.0` |
| `PANCODE_THEME` | UI theme | `dark` |
| `PANCODE_REASONING` | Reasoning preference | `medium` |
| `PANCODE_INTELLIGENCE` | Opt-in intelligence gate | `enabled` |

### Advanced Plumbing

The internal runtime surface also includes `PANCODE_HOME`,
`PANCODE_PACKAGE_ROOT`, `PANCODE_PROJECT`, `PANCODE_PROFILE`,
`PANCODE_PROVIDER`, `PANCODE_PRESET`, `PANCODE_RUNTIME_ROOT`,
`PANCODE_INSIDE_TMUX`, `PANCODE_PARENT_PID`, `PANCODE_AGENT_NAME`,
`PANCODE_BOARD_FILE`, `PANCODE_CONTEXT_FILE`, `PI_CODING_AGENT_DIR`, and
`PI_SKIP_VERSION_CHECK`. See the configuration guide for where each one is
read and written.

## panagents.yaml

`~/.pancode/panagents.yaml` defines dispatchable agents.

### Fields

| Field | Meaning |
|-------|---------|
| `name` | Agent key in the registry |
| `description` | Human-readable summary |
| `tools` | Tool allowlist, stored as a comma-separated string after normalization |
| `system_prompt` | Custom system prompt for the agent |
| `model` | Explicit model override |
| `sampling` | Sampling profile or overrides |
| `readonly` | Whether the agent may mutate files |
| `runtime` | Runtime ID, default `pi` |
| `runtime_args` | Extra CLI arguments, default `[]` |

### Default Agents

The template seeds two native agents:

- `dev` - mutable general-purpose worker
- `reviewer` - readonly review worker

The file also includes commented examples for CLI runtimes:

- `cli:claude-code`
- `cli:codex`
- `cli:gemini`
- `cli:opencode`
- `cli:cline`
- `cli:copilot-cli`

### Minimal Example

```yaml
agents:
  dev:
    description: "General-purpose coding agent"
    model: ${PANCODE_WORKER_MODEL}
    tools: [read, bash, grep, find, ls, write, edit]
    sampling: coding
    readonly: false

  reviewer:
    description: "Readonly review agent"
    model: ${PANCODE_WORKER_MODEL}
    tools: [read, bash, grep, find, ls]
    readonly: true
```

## Local AI Setup

### LM Studio

```bash
export PANCODE_WORKER_MODEL=lmstudio/qwen3.5-35b-a3b
pancode
```

### Ollama

```bash
ollama serve
ollama pull qwen3:8b

export PANCODE_WORKER_MODEL=ollama/qwen3:8b
pancode
```

### llama.cpp

```bash
llama-server -m model.gguf --port 8080

export PANCODE_WORKER_MODEL=llamacpp/model
pancode
```

## Dispatch

Inside the shell, PanCode interprets a task, compiles the orchestrator prompt,
and dispatches a worker when the current mode allows it.

Example:

```text
You: Review the dispatch admission logic for edge cases.

PanCode: Dispatching to reviewer worker...
         worker completed with 3 findings
         open /audit for the full run history
```

Mode gating controls whether dispatch is allowed:

- `capture` - record tasks only
- `plan` - analyze and plan, no dispatch
- `build` - full dispatch and edits
- `ask` - readonly research
- `review` - readonly review workers

## Changelog

### v0.3.0

- 10 composable domains with manifest-driven registration (agents, dispatch,
  intelligence, observability, prompts, providers, safety, scheduling,
  session, ui).
- 7 runtime adapters (Pi native, Claude Code, Codex, Gemini, OpenCode, Cline,
  Copilot CLI) with unified discovery, health checks, and adapter parity.
- 38 slash commands across 7 categories (session, dispatch, agents, observe,
  schedule, display, utility).
- Agent spec registry with panagents.yaml supporting per-agent runtime,
  sampling, isolation, tier, and autonomy configuration.
- PanModels catalog with offline model metadata for provider-aware routing.
- Constitution-driven safety with 21 auditable rules, 4 behavioral modes
  (capture, plan, build, review, ask), and live safety level switching.
- Dispatch hardening with admission gating, recursion guards, provider
  backoff, heartbeat monitoring, staggered batch launches, and worktree
  isolation.
- Observability layer with dispatch ledger, structured receipts, audit trail,
  metrics persistence, boot timing, and /perf command.
- Worker pool with health scoring, heartbeat supervision, and configurable
  concurrency limits.
- Session management with checkpoint, resume, fork, tree navigation, and
  cross-agent context registry.
- Dynamic multi-line footer with context category visualization and live
  provider status.
- Config validation, settings persistence, and secure credential handling.
- Diagnostic health checks (/doctor) covering 6 verification categories.

### v0.2.4

- Dispatch hardening: recursion guard, provider backoff and resilience,
  hard worker timeouts, long-prompt temp files, NDJSON progress tracking,
  staggered batch starts, worktree isolation, and stale artifact cleanup.
- CLI simplification: tmux-first launcher, smaller command surface, clean
  reattach path through `pancode up`.
- Singleton cleanup: shared bus and shared types consolidated, dead code
  removed from the docs-facing surface.
- Cluster isolation: `/cluster` stays hidden while the SSH redesign is still
  pending.

