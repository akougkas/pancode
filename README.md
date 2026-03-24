# PanCode

[![Version](https://img.shields.io/badge/version-0.3.0--exp-blue)](https://github.com/akougkas/pancode)
[![License](https://img.shields.io/badge/license-Apache%202.0-green)](./LICENSE)
[![Node.js](https://img.shields.io/badge/node-%3E%3D20-brightgreen)](https://nodejs.org/)
[![Experimental](https://img.shields.io/badge/status-experimental%20preview-orange)](https://github.com/akougkas/pancode)

Composable multi-agent runtime for software engineering.

PanCode orchestrates coding agents the way Kubernetes orchestrates containers. Any coding agent installed on your machine becomes a managed, observable, coordinated worker. You dispatch workers by capability, not by backend. PanCode handles discovery, configuration, safety, cost tracking, and coordination across heterogeneous agent fleets. It is not a chatbot, not a plugin, not a cloud service. It is the runtime.

> **Experimental Preview (v0.3.0-exp)**
>
> PanCode is in experimental preview. APIs, configuration formats, and features may change between releases. Production use is not recommended at this stage.

## Key Features

- **Zero-settings configuration.** All configuration happens through natural language conversation with Panos, the orchestrator. Keyboard shortcuts provide fast toggles for mode switching and reasoning levels.
- **4 orchestrator modes.** Admin (God Mode), Plan, Build, and Review control what the orchestrator does with user input. Each mode gates tool access, dispatch permissions, and mutation capabilities.
- **7-agent fleet.** Scout, Planner, Builder, Reviewer, Plan-Reviewer, Documenter, and Red-Team agents ship as defaults in `panagents.yaml`, each with dedicated system prompts, tool allowlists, speed ratings, autonomy levels, and tier classification.
- **7 runtime adapters.** Native runtime plus Claude Code, Codex, Gemini CLI, OpenCode, Cline, and Copilot CLI. Discovery at boot scans PATH for known binaries and registers them automatically.
- **Responsive TUI dashboard.** Terminal-native interface with responsive breakpoints (compact, standard, wide), mode badges, dynamic footer with context window visualization, and structured panel rendering.
- **PanPrompt constitutional system.** Typed prompt fragments compiled per role, tier, and mode. Behavioral rules enforced across all agents and runtimes through voice overlays, scope constraints, and output contracts.
- **Dispatch pipeline with receipts.** Admission gating, recursion guards, provider backoff, heartbeat monitoring, staggered batch launches, worktree isolation, and reproducibility receipts for audit-ready verification.
- **PanConfigure conversational config.** Two tools (`pan_read_config`, `pan_apply_config`) let the orchestrator read and modify runtime parameters through conversation. Admin-only parameters require God Mode.
- **PanModels registry.** Offline model metadata with capability matching, performance tiers, and provider-agnostic model selection.
- **10 composable domains.** Safety, Session, Agents, Prompts, Dispatch, Observability, Intelligence, Scheduling, PanConfigure, and UI. Manifest-driven registration with topological dependency loading.

## Quick Start

### Prerequisites

- Node.js 20 or newer
- npm
- `tmux`
- At least one provider: local (LM Studio, Ollama, llama.cpp) or cloud (a supported API key)

### Install

```bash
npm install -g pancode@exp
```

For local development:

```bash
git clone https://github.com/akougkas/pancode.git
cd pancode
npm install
npm run build
npm link
```

### Launch

```bash
pancode                    # Start a new tmux session
pancode --preset local     # Start with the local inference preset
pancode up                 # Reattach to existing session
pancode down               # Stop the current session
pancode sessions           # List running sessions
```

PanCode always starts inside tmux. The `pancode` command creates the session, `pancode up` reattaches, and `pancode down` tears it down cleanly.

### First Commands

Once inside a PanCode session:

| Action | How |
|--------|-----|
| Switch modes | `Shift+Tab` cycles Plan, Build, Review |
| Enter God Mode | `Alt+A` |
| Cycle safety levels | `Ctrl+Y` |
| View agent fleet | Type `/agents` |
| View current mode | Type `/modes` |
| View presets | Type `/preset` |
| Dispatch a scout | Ask Panos: "scout the src/ directory" |

### Core CLI Commands

| Command | Purpose |
|---------|---------|
| `pancode` | Start a new tmux session |
| `pancode up` | Reattach to the most recent session or a named session |
| `pancode down` | Stop the current session, a named session, or `--all` |
| `pancode sessions` | List running sessions |
| `pancode login` | Show in-shell login instructions |
| `pancode version` | Print the installed version |
| `pancode --preset <name>` | Boot with a named preset |
| `pancode --help` | Show full CLI help |

## Architecture Overview

```
+------------------------------------------------------------------+
|                         PanCode Runtime                          |
|                                                                  |
|  src/core/          Foundation: config, modes, bus, presets      |
|  +-----------+  +-----------+  +-----------+  +-----------+     |
|  | safety    |  | session   |  | agents    |  | prompts   |     |
|  +-----------+  +-----------+  +-----------+  +-----------+     |
|  +-----------+  +-----------+  +-----------+  +-----------+     |
|  | dispatch  |  | observ.   |  | scheduling|  | panconfig |     |
|  +-----------+  +-----------+  +-----------+  +-----------+     |
|  +-----------+  +-------------+                                  |
|  | intellig. |  | ui (TUI)    |                                  |
|  +-----------+  +-------------+                                  |
|                                                                  |
|  src/engine/    SOLE IMPORT BOUNDARY                             |
|  +--------------------------------------------------------------+|
|  | SDK wrappers | Session | Shadow | Tools | TUI | Types        ||
|  | runtimes/                                                    ||
|  |   native runtime        (full-control workers)               ||
|  |   adapters/              (6 CLI adapters)                    ||
|  +--------------------------------------------------------------+|
|                                                                  |
|  src/worker/    PHYSICALLY ISOLATED (no domain imports)          |
|  +--------------------------------------------------------------+|
|  | Worker subprocess entry point                                ||
|  +--------------------------------------------------------------+|
+------------------------------------------------------------------+
```

**Engine boundary.** Only `src/engine/` imports from the vendored SDK packages. No file outside `src/engine/` may reference these packages. This is enforced at build time by `check-boundaries`.

**Worker isolation.** `src/worker/` is physically isolated. It cannot import from `src/domains/`. Every worker runs as a separate subprocess.

**Domain independence.** Each domain registers its own slash commands in its own `extension.ts`. No domain mutates another domain's state. All cross-domain events flow through `SafeEventBus`.

## Modes

PanCode operates in one of four orchestrator modes. Modes control what the orchestrator does with user input. They are orthogonal to safety levels (suggest, auto-edit, full-auto) which control what is allowed.

| Mode | Dispatch | Shadow | Mutations | Reasoning | Description |
|------|----------|--------|-----------|-----------|-------------|
| **Admin** | Yes | Yes | No | xhigh | God Mode. Full system management, configuration, and diagnostic dispatch. |
| **Plan** | No | Yes | No | high | Analyze codebase and build execution plan. No dispatch yet. |
| **Build** | Yes | Yes | Yes | medium | Full dispatch. Workers implement, test, review. |
| **Review** | Yes | Yes | No | xhigh | Quality checks. Readonly reviewers analyze code. |

**Switching modes:** `Shift+Tab` cycles through Plan, Build, Review. `Alt+A` enters Admin (God Mode).

### Tool Access by Mode

| Tool | Admin | Plan | Build | Review |
|------|-------|------|-------|--------|
| read, bash, grep, find, ls | Yes | Yes | Yes | Yes |
| edit, write | No | No | Yes | No |
| shadow_explore | Yes | Yes | Yes | Yes |
| dispatch_agent, batch_dispatch, dispatch_chain | Yes | No | Yes | Yes |
| task_write, task_check, task_update, task_list | Yes | Yes | Yes | No |
| pan_read_config, pan_apply_config | Yes | Yes | Yes | Yes |

## Agent Fleet

PanCode ships 7 default agents in `~/.pancode/panagents.yaml`. Each agent specifies tools, sampling preset, readonly mode, tier classification, speed, autonomy level, and a dedicated system prompt.

| Agent | Role | Tools | Readonly | Tier | Speed | Autonomy |
|-------|------|-------|----------|------|-------|----------|
| **scout** | Fast codebase reconnaissance | read, grep, find, ls | Yes | any | fast | autonomous |
| **planner** | Architecture and implementation planning | read, grep, find, ls | Yes | frontier | thorough | supervised |
| **builder** | Implementation and code generation | read, write, edit, bash, grep, find, ls | No | mid | balanced | supervised |
| **reviewer** | Code review and quality analysis | read, bash, grep, find, ls | Yes | mid | thorough | autonomous |
| **plan-reviewer** | Plan critic and feasibility validator | read, grep, find, ls | Yes | mid | thorough | autonomous |
| **documenter** | Documentation generation and maintenance | read, write, edit, grep, find, ls | No | any | balanced | supervised |
| **red-team** | Security and adversarial testing | read, bash, grep, find, ls | Yes | mid | thorough | autonomous |

Agents are defined in YAML with `${ENV_VAR}` expansion for model references. Add custom agents by editing `panagents.yaml`. CLI runtime agents (Claude Code, Codex, etc.) can be assigned by setting `runtime: cli:claude-code` on an agent entry.

## Runtime Adapters

Every agent, regardless of backend, produces a PanCode worker with the same dispatch, safety, and observability guarantees.

| Runtime | Tier | Binary | Integration |
|---------|------|--------|-------------|
| Native | Native | built-in | Full control (tools, model, prompt, safety, events) |
| Claude Code | CLI | `claude` | JSON structured output |
| Codex CLI | CLI | `codex` | JSON lines |
| Gemini CLI | CLI | `gemini` | JSON output |
| OpenCode | CLI | `opencode` | NDJSON |
| Cline CLI | CLI | `cline` | NDJSON |
| Copilot CLI | CLI | `copilot` | Text |

Runtime discovery runs at boot, scanning PATH for known binaries. Detected runtimes are registered automatically and available for agent assignment. Adding a new adapter requires implementing one TypeScript file in `src/engine/runtimes/adapters/`.

## Configuration

PanCode follows a zero-settings philosophy. Slash commands are read-only views. All configuration changes happen through natural language conversation with Panos, the orchestrator, which uses `pan_read_config` and `pan_apply_config` internally. Keyboard shortcuts serve as fast toggles for frequently changed settings.

### Configuration Flow

1. **Ask Panos.** Say "switch to full-auto safety" or "set budget ceiling to 5 dollars" in the chat.
2. **Keyboard shortcuts.** `Shift+Tab` cycles modes. `Alt+A` enters Admin. `Ctrl+Y` cycles safety levels.
3. **Slash commands.** `/modes`, `/safety`, `/preferences` display current state without modifying it.

### Config Domains

| Domain | Parameters |
|--------|-----------|
| `runtime` | safety level, reasoning preference, thinking level |
| `models` | orchestrator model, worker model, scout model |
| `budget` | session cost ceiling |
| `dispatch` | timeout, max recursion depth, concurrency limit |
| `preset` | active boot preset |

For the full configuration reference, see the [documentation site](https://pancode.dev).

### Configuration Files

All user configuration lives under `~/.pancode/`:

| File | Purpose |
|------|---------|
| `pancode.yaml` | Runtime configuration |
| `panagents.yaml` | Agent fleet definitions |
| `panmodels.yaml` | Model metadata catalog |
| `panpresets.yaml` | Named boot presets |
| `settings.json` | User preferences persistence |

## Presets

Boot presets configure the orchestrator model, worker model, reasoning level, and safety mode in a single named profile. Stored in `~/.pancode/panpresets.yaml`.

| Preset | Description | Reasoning | Safety |
|--------|-------------|-----------|--------|
| `local` | Local inference via homelab engines | medium | auto-edit |
| `openai` | OpenAI (edit model IDs to match your subscription) | medium | auto-edit |
| `openai-max` | OpenAI high reasoning | high | full-auto |
| `hybrid` | Local orchestrator with remote workers | medium | auto-edit |
| `local-dynamo` | All agents on dynamo (Nemotron Cascade orchestrator+workers, qwen3.5-2b scouts) | medium | auto-edit |
| `local-mini` | Single-node mini (Qwen35-Distilled + 0.8B scouts at 380 tok/s) | medium | auto-edit |

```bash
pancode --preset local       # Boot with a preset
```

Inside a session, use `/preset` to view available presets or ask Panos to switch.

## Environment Variables

### Core Variables

| Variable | Purpose | Default |
|----------|---------|---------|
| `PANCODE_MODEL` | Orchestrator model | (from .env or preset) |
| `PANCODE_WORKER_MODEL` | Default worker model | (from .env or preset) |
| `PANCODE_SCOUT_MODEL` | Shadow scout model | (from .env or preset) |
| `PANCODE_SAFETY` | Autonomy mode: suggest, auto-edit, full-auto | `auto-edit` |
| `PANCODE_REASONING` | Reasoning preference: off, minimal, low, medium, high, xhigh | `medium` |
| `PANCODE_BUDGET_CEILING` | Session budget ceiling (dollars) | `10.0` |
| `PANCODE_THEME` | UI theme | `dark` |
| `PANCODE_DEFAULT_AGENT` | Default dispatch agent | `dev` |
| `PANCODE_WORKER_TIMEOUT_MS` | Hard worker timeout in milliseconds | `300000` |
| `PANCODE_DISPATCH_MAX_DEPTH` | Dispatch recursion limit | `2` |
| `PANCODE_NODE_CONCURRENCY` | Max workers per node | `4` |
| `PANCODE_INTELLIGENCE` | Intelligence gate | `enabled` |
| `PANCODE_LOCAL_MACHINES` | Extra local discovery targets | (unset) |

### Internal Variables

| Variable | Purpose |
|----------|---------|
| `PANCODE_HOME` | User config directory (~/.pancode) |
| `PANCODE_PACKAGE_ROOT` | Package installation root |
| `PANCODE_PROJECT` | Current project directory |
| `PANCODE_PROFILE` | Active profile name |
| `PANCODE_PROVIDER` | Active provider override |
| `PANCODE_PRESET` | Active boot preset name |
| `PANCODE_INSIDE_TMUX` | Set when running inside tmux session |
| `PANCODE_PARENT_PID` | Parent process ID for subprocess tracking |
| `PANCODE_AGENT_NAME` | Current agent name (set in worker subprocesses) |
| `PANCODE_MAX_RUNS` | Dispatch run history ring buffer size (default 500) |
| `PANCODE_MAX_METRICS` | Metric history ring buffer size (default 1000) |

For the full environment variable reference, see the [documentation site](https://pancode.dev).

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

## Coming Soon

The following capabilities are on the roadmap. No dates or timelines are promised.

- **Multi-node fleet dispatch.** Distribute workers across multiple machines in a local network for parallel execution at scale.
- **SDK agent adapters.** First-class integration with Claude Agent SDK, OpenAI Agents SDK, and Mastra for deep programmatic control beyond CLI wrappers.
- **Dynamic model routing.** Cost-aware model selection that routes tasks to the most capable and cost-effective model based on task complexity.
- **Agent marketplace.** Community-contributed agent definitions and skill packs that can be installed and composed into custom fleets.
- **Team-based workflows.** Multi-user coordination with shared dispatch queues, role-based access, and collaborative agent orchestration.
- **Web dashboard.** Browser-based companion UI for fleet monitoring, cost visualization, and dispatch history review.
- **Plugin system.** Third-party domain extensions that plug into the manifest-driven architecture for custom capabilities.

## Documentation

Full documentation, tutorials, and reference guides are available at [pancode.dev](https://pancode.dev).

## Development

### Build Commands

```bash
npm run build              # Production build (SDK packages + tsup)
npm run dev                # Dev mode (tsx, skips tmux)
npm run typecheck          # TypeScript strict check + boundary audit
npm run check-boundaries   # Engine and worker isolation enforcement
npm run lint               # Biome linter
npm run smoke-test         # 7-phase baseline smoke test
npm run verify-tui         # TUI width-safety regression harness
```

### Code Style

- TypeScript 5.7 strict mode
- Biome: 120-character lines, 2-space indent, double quotes, semicolons always
- Conventional Commits: `feat(scope):`, `fix(scope):`, `docs:`, `chore:`
- Atomic file writes (temp + rename) for all state persistence

### Boundary Enforcement

The `check-boundaries` script enforces two architectural invariants at build time:

1. **Engine boundary.** No file outside `src/engine/` may import from vendored SDK packages.
2. **Worker isolation.** `src/worker/` may not import from `src/domains/`.

Violations fail the build.

## Contributing

Contributions are welcome. See [CONTRIBUTING.md](./CONTRIBUTING.md) for guidelines.

## License

[Apache 2.0](./LICENSE)
