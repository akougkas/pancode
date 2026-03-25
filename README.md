# PanCode

[![Version](https://img.shields.io/badge/version-0.3.0--exp-blue)](https://github.com/akougkas/pancode)
[![License](https://img.shields.io/badge/license-Apache%202.0-green)](./LICENSE)
[![Node.js](https://img.shields.io/badge/node-%3E%3D20-brightgreen)](https://nodejs.org/)
[![Experimental](https://img.shields.io/badge/status-experimental%20preview-orange)](https://github.com/akougkas/pancode)

**One Runtime. Every Agent.**

PanCode is a composable multi-agent runtime for software engineering. It orchestrates coding agents the way Kubernetes orchestrates containers. Every coding agent on your machine becomes a managed, observable, coordinated worker dispatched by capability, not by backend.

PanCode is not a chatbot. It is not a plugin or a cloud service. It is the orchestration layer above Claude Code, Codex CLI, Gemini CLI, and local inference workers.

> **Experimental Preview (v0.3.0-exp)**
>
> PanCode ships the runtime early and on purpose. The APIs may shift. The architecture and control-plane thesis will not. Built in the open under Apache 2.0.

---

## Table of Contents

- [Why PanCode](#why-pancode)
- [How It Works](#how-it-works)
- [Quick Start](#quick-start)
- [The Pan Taxonomy](#the-pan-taxonomy)
- [Architecture](#architecture)
- [Orchestrator Modes](#orchestrator-modes)
- [Agent Fleet](#agent-fleet)
- [Runtime Adapters](#runtime-adapters)
- [Configuration](#configuration)
- [Local AI Setup](#local-ai-setup)
- [Roadmap](#roadmap)
- [Development](#development)
- [Contributing](#contributing)
- [License](#license)

---

## Why PanCode

The coding agent landscape is fragmented. Claude Code, Codex, Gemini CLI, OpenCode, Copilot CLI, and dozens of local models all speak different protocols, report different metrics, and enforce different safety boundaries. Running them together means writing glue code, losing observability, and accepting inconsistent safety guarantees.

PanCode solves this by providing one runtime that discovers, composes, and coordinates any coding agent through a unified safety model, dispatch system, and observability layer. You get:

- **One dispatch pipeline** across all agents. Same admission gates, same receipts, same cost tracking.
- **One safety model** enforced structurally. Mode gating controls visibility. Policy gating controls permissions. No agent bypasses the boundary.
- **One observability surface.** Cost, tokens, turns, wall time, and reproducibility receipts from one terminal session.
- **Fleet-scale thinking.** Worker pools, heartbeat monitoring, batch dispatch, chain dispatch, and staggered launches. Engineered for 10+ concurrent agents today with a path to 1000+.

PanCode is engineered with HPC DNA and proper platform design principles. Subprocess isolation is absolute. Every worker runs as a separate OS process. Architectural boundaries are enforced at build time. State persistence uses atomic writes. The system is designed like infrastructure, not like a chat window.

---

## How It Works

PanCode follows a deliberate four-step operational loop:

```
Discover ──▸ Configure ──▸ Dispatch ──▸ Observe
```

**Discover.** On boot, PanCode scans your machine for installed coding agents and local inference endpoints. Claude Code, Codex, Gemini CLI, OpenCode, Copilot CLI, LM Studio, Ollama, and llama.cpp are detected automatically.

**Configure.** Speak to Panos, the orchestrator, in natural language. "Switch to full-auto safety." "Set the budget ceiling to 5 dollars." "Use the local preset." Configuration is conversational, keyboard-accelerated, and persisted to disk.

**Dispatch.** Ask for work. Panos decomposes tasks, selects agents by capability and tier, and dispatches workers as isolated subprocesses. Single tasks, parallel batches, and sequential chains are all first-class dispatch primitives.

**Observe.** Every dispatch produces a reproducibility receipt. Cost, tokens, turns, wall time, and action classifications are tracked per run. The TUI dashboard shows live worker status, context window consumption by category, and session economics.

---

## Quick Start

### Prerequisites

- Node.js 20 or newer
- npm
- `tmux` (PanCode runs inside tmux for session persistence)
- At least one provider: local (LM Studio, Ollama, llama.cpp) or cloud (Anthropic, OpenAI)

### Install

```bash
npm install -g pancode@exp
```

Or build from source:

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
pancode --preset local     # Start with local inference
pancode up                 # Reattach to existing session
pancode down               # Stop the current session
pancode sessions           # List all running sessions
```

### First Interaction

Once inside a PanCode session:

```
Shift+Tab       Cycle modes: Plan → Build → Review
Alt+A           Enter Admin (God Mode)
Ctrl+Y          Cycle safety levels

/agents         View the agent fleet
/runtimes       View discovered runtime adapters
/workers        View the worker pool with scores
/modes          View current mode and tool access
/help           Full command reference
```

Ask Panos to dispatch work:

```
"Scout the src/ directory for architecture violations"
"Review the last 3 commits for security issues"
"Build a REST endpoint for user authentication"
```

---

## The Pan Taxonomy

PanCode is universal across six dimensions. Each "Pan-" prefix represents a dimension of composability that no single agent provides alone.

| Dimension | What It Means |
|-----------|---------------|
| **Pan-provider** | Route local engines, frontier APIs, or hybrid fleets without standardizing on a single vendor. |
| **Pan-model** | Match model capability, latency, and cost to the task. Tier classification prevents mismatched assignments. |
| **Pan-runtime** | Run native workers, SDK-backed agents, or headless CLIs under one dispatch contract. |
| **Pan-agent** | Discover installed coding agents automatically. Operate them as a coordinated fleet. |
| **Pan-safety** | Apply a shared safety model across all runtimes. Mode gates visibility. Policy gates permissions. |
| **Pan-observe** | Track cost, tokens, turns, receipts, and runtime status from one terminal session. |

---

## Architecture

```
┌──────────────────────────────────────────────────────────────┐
│                       PanCode Runtime                        │
│                                                              │
│  src/core/          Config, modes, bus, presets, validation  │
│                                                              │
│  src/domains/       10 composable domains                    │
│  ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌──────────┐          │
│  │ safety  │ │ session │ │ agents  │ │ prompts  │          │
│  └─────────┘ └─────────┘ └─────────┘ └──────────┘          │
│  ┌─────────┐ ┌─────────┐ ┌──────────┐ ┌──────────┐         │
│  │dispatch │ │ observ. │ │schedule │ │panconfig │         │
│  └─────────┘ └─────────┘ └──────────┘ └──────────┘         │
│  ┌─────────┐ ┌─────────┐                                    │
│  │intellig.│ │   ui    │                                    │
│  └─────────┘ └─────────┘                                    │
│                                                              │
│  src/engine/       SOLE SDK IMPORT BOUNDARY                  │
│  ┌──────────────────────────────────────────────────────┐    │
│  │ SDK wrappers │ Session │ Tools │ TUI engine │ Types  │    │
│  │ runtimes/                                            │    │
│  │   pi-runtime.ts          Native runtime (full ctrl)  │    │
│  │   claude-sdk.ts          Claude Agent SDK adapter    │    │
│  │   adapters/              5 CLI adapters              │    │
│  └──────────────────────────────────────────────────────┘    │
│                                                              │
│  src/worker/       ISOLATED SUBPROCESS (no domain imports)   │
│  ┌──────────────────────────────────────────────────────┐    │
│  │ Subprocess entry │ Safety extension │ Heartbeat      │    │
│  └──────────────────────────────────────────────────────┘    │
└──────────────────────────────────────────────────────────────┘
```

**Three hard boundaries enforced at build time:**

1. **Engine boundary.** Only `src/engine/` imports from vendored SDK packages. No file outside this directory may reference them. Enforced by `check-boundaries`.
2. **Worker isolation.** `src/worker/` cannot import from `src/domains/`. Every worker runs as a separate OS process with no shared memory, event loop, or file descriptors.
3. **Domain independence.** Each domain owns its state. Cross-domain communication flows exclusively through `SafeEventBus`. No domain mutates another domain's state.

---

## Orchestrator Modes

PanCode operates in one of four orchestrator modes. Modes are structural gates that control what the orchestrator can see and do. They are orthogonal to safety levels (suggest, auto-edit, full-auto) which control what is permitted.

| Mode | Dispatch | Mutations | Use Case |
|------|----------|-----------|----------|
| **Admin** | Yes | Config only | System management, diagnostics, fleet configuration |
| **Plan** | No | No | Analyze codebase, design approach, build execution plan |
| **Build** | Yes | Yes | Full dispatch. Workers implement, test, and review code. |
| **Review** | Yes | No | Quality checks. Readonly reviewers analyze code without mutation. |

`Shift+Tab` cycles Plan, Build, Review. `Alt+A` enters Admin (God Mode).

### Tool Gating by Mode

| Tool Category | Admin | Plan | Build | Review |
|---------------|-------|------|-------|--------|
| Read, search, explore | Yes | Yes | Yes | Yes |
| File write, edit | No | No | Yes | No |
| Dispatch workers | Yes | No | Yes | Yes (readonly only) |
| Configuration mutation | Yes | No | No | No |

---

## Agent Fleet

PanCode ships 7 default agents. Each has a dedicated system prompt, tool allowlist, tier classification, and autonomy level. Agents are defined in `~/.pancode/panagents.yaml` and can be customized or extended.

| Agent | Role | Readonly | Tier | Speed |
|-------|------|----------|------|-------|
| **scout** | Fast codebase reconnaissance | Yes | any | fast |
| **planner** | Architecture and implementation planning | Yes | frontier | thorough |
| **builder** | Code generation and implementation | No | mid | balanced |
| **reviewer** | Code review and quality analysis | Yes | mid | thorough |
| **plan-reviewer** | Plan critic and feasibility validation | Yes | mid | thorough |
| **documenter** | Documentation generation | No | any | balanced |
| **red-team** | Security and adversarial testing | Yes | mid | thorough |

Add custom agents by editing `panagents.yaml`. Assign CLI runtime agents with `runtime: cli:claude-code` on any agent entry. Model references support `${PANCODE_WORKER_MODEL}` expansion.

---

## Runtime Adapters

PanCode supports three tiers of agent integration. Every agent, regardless of backend, produces a worker with the same dispatch, safety, and observability guarantees.

| Tier | Runtime | Integration Depth |
|------|---------|-------------------|
| **Native** | Pi SDK | Full: prompts, tools, model, safety, events |
| **SDK** | Claude Agent SDK | Deep: structured I/O, tool hooks, session pooling |
| **CLI** | Claude Code, Codex, Gemini CLI, OpenCode, Copilot CLI | Task + CWD + system prompt over subprocess |

Runtime discovery runs at boot, scanning PATH for known binaries. Detected runtimes register automatically. Use `/runtimes` to see what was discovered.

---

## Configuration

PanCode is configured conversationally. Speak to Panos in natural language or use keyboard shortcuts for fast toggles.

| Method | Example |
|--------|---------|
| **Natural language** | "Switch to full-auto safety" or "set budget to 5 dollars" |
| **Keyboard** | `Shift+Tab` (modes), `Ctrl+Y` (safety), `Alt+A` (admin) |
| **Slash commands** | `/modes`, `/safety`, `/settings`, `/theme` (view and apply) |
| **Presets** | `pancode --preset local` or `/preset` inside a session |

### Configuration Files

All user configuration lives under `~/.pancode/`:

| File | Purpose |
|------|---------|
| `panagents.yaml` | Agent fleet definitions |
| `panpresets.yaml` | Named boot presets |
| `pansafety.yaml` | Custom safety rules (path restrictions, bash pattern blocks) |
| `settings.json` | Persisted user preferences |

### Presets

Boot presets configure model, reasoning, and safety in a single named profile.

| Preset | Description |
|--------|-------------|
| `local` | Local inference via homelab engines |
| `openai` | OpenAI models (edit model IDs to match your subscription) |
| `openai-max` | OpenAI with high reasoning and full-auto safety |
| `hybrid` | Local orchestrator with remote workers |

```bash
pancode --preset local
```

### Key Environment Variables

| Variable | Purpose | Default |
|----------|---------|---------|
| `PANCODE_MODEL` | Orchestrator model | (from .env or preset) |
| `PANCODE_WORKER_MODEL` | Default worker model | (from .env or preset) |
| `PANCODE_SCOUT_MODEL` | Shadow scout model | (from .env or preset) |
| `PANCODE_SAFETY` | Autonomy: suggest, auto-edit, full-auto | `auto-edit` |
| `PANCODE_REASONING` | Reasoning: off, minimal, low, medium, high, xhigh | `medium` |
| `PANCODE_BUDGET_CEILING` | Session cost ceiling in dollars | `10.0` |
| `PANCODE_DISPATCH_MAX_DEPTH` | Dispatch recursion limit | `2` |
| `PANCODE_NODE_CONCURRENCY` | Max concurrent workers per node | `4` |

Full reference: [pancode.dev](https://pancode.dev)

---

## Local AI Setup

PanCode discovers local inference endpoints automatically. Start your preferred engine and PanCode will find it.

### LM Studio

```bash
# Start LM Studio, load a model, enable the server on port 1234
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

PanCode also discovers remote homelab nodes. Set `PANCODE_LOCAL_MACHINES=192.168.86.143:1234,192.168.86.141:8080` to add endpoints on other machines.

---

## Roadmap

PanCode is growing daily. The architecture is locked. The feature surface is expanding.

**Near-term:**
- Multi-node fleet dispatch over SSH
- Adaptive concurrency based on compute, inference, and budget constraints
- Headless execution mode for CI/CD pipelines (`pancode run --headless`)
- Post-dispatch verification gates with automated retry

**Medium-term:**
- SDK agent adapters (Claude Agent SDK, OpenAI Agents SDK, Mastra)
- SQLite persistence layer replacing JSON state files
- Dynamic per-capability model routing
- Provider resilience matrix with circuit breakers

**Long-term:**
- Agent marketplace with installable skill packs
- REST API daemon with SSE events
- Runtime tool forging in sandboxed V8 contexts
- Speculative dispatch with multi-replica racing

No dates or timelines are promised. Track progress on [GitHub Issues](https://github.com/akougkas/pancode/issues).

---

## Development

### Build

```bash
npm run build              # Production build (SDK packages + tsup)
npm run dev                # Dev mode (tsx, skips tmux)
npm run typecheck          # TypeScript strict + boundary audit + prompt validation
npm run check-boundaries   # Engine and worker isolation enforcement
npm run lint               # Biome linter
npm run smoke-test         # Baseline verification test
```

### Code Style

- TypeScript 5.7 strict mode. No `any` unless absolutely necessary.
- Biome: 120-character lines, 2-space indent, double quotes, semicolons always.
- Conventional Commits: `feat(scope):`, `fix(scope):`, `docs:`, `chore:`.
- Atomic file writes (temp + rename) for all state persistence.

---

## Contributing

Contributions are welcome. See [CONTRIBUTING.md](./CONTRIBUTING.md) for guidelines.

PanCode is pure open source under Apache 2.0. No CLA required.

---

## License

[Apache 2.0](./LICENSE)
