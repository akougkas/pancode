# Architecture Overview

PanCode is a terminal-native orchestration runtime for coding agents. It discovers
agents installed on the user's machine, composes them into workflows, dispatches
them as isolated subprocesses, and observes everything from one TUI.

This document describes the five physical layers of the system, the data flow
from user input to worker result, and the boot sequence that assembles the stack.

## Five Physical Layers

```
┌──────────────────────────────────────────────────────────────┐
│  CLI Layer (src/cli/)                                        │
│  pancode, pancode up, pancode down, pancode sessions         │
│  Thin command router. Creates/attaches tmux sessions.        │
├──────────────────────────────────────────────────────────────┤
│  Entry Layer (src/loader.ts, src/entry/orchestrator.ts)      │
│  Routing: loader.ts → orchestrator | worker | CLI command    │
│  Bootstrap: 8-phase init, domain loading, session creation   │
├──────────────────────────────────────────────────────────────┤
│  Core Layer (src/core/)                                      │
│  Config resolution, domain loader, event bus, modes, presets │
│  Host-environment infrastructure only. No domain logic.      │
├──────────────────────────────────────────────────────────────┤
│  Domain Layer (src/domains/)                                 │
│  10 composable domains with manifest.ts + extension.ts       │
│  Each domain registers its own commands and tools.           │
├──────────────────────────────────────────────────────────────┤
│  Engine Layer (src/engine/)                                  │
│  Sole Pi SDK import boundary. Re-exports types, wraps APIs.  │
│  Runtime adapters for CLI agents (Claude Code, Codex, etc.)  │
├──────────────────────────────────────────────────────────────┤
│  Worker Layer (src/worker/)                                  │
│  Physically isolated subprocess entry point.                 │
│  Cannot import from src/domains/. Loads only safety ext.     │
└──────────────────────────────────────────────────────────────┘
```

### CLI Layer

The CLI layer (`src/cli/`) provides the user-facing commands. `pancode` (or
`pancode start`) creates a new tmux session and launches the orchestrator inside
it. `pancode up` reattaches to an existing session. `pancode down` kills a
session. `pancode sessions` lists active sessions. `pancode login` handles
provider authentication. `pancode version` prints the version.

The command router in `src/cli/index.ts` maps command strings to handler
functions and returns exit codes. Each handler is a separate file (`start.ts`,
`up.ts`, `down.ts`, etc.) that does exactly one thing.

### Entry Layer

`src/loader.ts` is the absolute entry point for all execution paths. It
initializes the environment (resolves package root, loads `.env`, sets
`PANCODE_HOME` and `PANCODE_AGENT_DIR`), then routes to one of four targets:

- **orchestrator**: the interactive TUI session (default when inside tmux)
- **worker**: subprocess mode (activated by the `--worker` flag)
- **cli**: subcommands like `up`, `down`, `reset`, `sessions`
- **tmux-start**: creates a new tmux session if not already inside one

`src/entry/orchestrator.ts` is the main bootstrap file. It runs an 8-phase
initialization sequence:

1. **Domain collection**: gather enabled domains from config
2. **Authentication**: initialize auth storage
3. **Model loading**: warm from cache or cold via provider discovery
4. **Agent loading**: parse `panagents.yaml` and materialize agent specs
5. **Model resolution**: resolve orchestrator, worker, and scout models
6. **Resource loader**: initialize Pi SDK resource management
7. **Session creation**: create the Pi SDK agent session with all extensions
8. **Shell startup**: launch the interactive TUI

Each phase is instrumented with timing metrics. If total boot time exceeds
the configurable budget (default 3 seconds), a warning identifies the slowest
phase.

### Core Layer

`src/core/` contains host-environment infrastructure that every layer depends
on. It has no domain-specific logic. Key modules:

| Module | Purpose |
|--------|---------|
| `config.ts` | 5-tier config resolution (overrides > env > project > global > defaults) |
| `domain-loader.ts` | Kahn's algorithm for topological sorting of domain manifests |
| `event-bus.ts` | SafeEventBus with error-isolated listener execution |
| `shared-bus.ts` | Module-level singleton bus for cross-domain events |
| `bus-events.ts` | Canonical channel names and typed payload interfaces |
| `modes.ts` | 4 activity modes (admin, plan, build, review) with tool gating |
| `presets.ts` | Named boot presets from `~/.pancode/panpresets.yaml` |
| `defaults.ts` | Default values for all configurable parameters |
| `termination.ts` | Multi-phase shutdown coordinator |
| `thinking.ts` | Reasoning level preference management |

### Domain Layer

`src/domains/` contains 10 composable domains. Each domain has a `manifest.ts`
declaring its name and dependencies, and an `extension.ts` that registers hooks,
tools, and commands with the Pi SDK extension API.

The domain loader resolves loading order automatically from manifest
dependencies. Adding a new domain requires writing `manifest.ts` and
`extension.ts`. The loader determines where it slots in. See
[Domains](./domains.md) for the complete domain reference.

### Engine Layer

`src/engine/` is the sole import boundary for all Pi SDK packages. No file
outside `src/engine/` may import from `@pancode/pi-coding-agent`,
`@pancode/pi-ai`, or `@pancode/pi-tui`. This boundary exists to contain Pi SDK
breaking changes to a single directory. See
[Engine Boundary](./engine-boundary.md) for details.

The engine layer also contains the runtime adapter system
(`src/engine/runtimes/`) which abstracts the differences between Pi SDK native
agents, CLI headless agents (Claude Code, Codex, Gemini CLI, OpenCode,
Copilot CLI), and SDK programmatic agents.

### Worker Layer

`src/worker/` is physically isolated from `src/domains/`. Worker subprocesses
cannot import orchestrator domain logic because they live in a separate directory
tree. A worker loads only the provider bridge (for model resolution) and the
safety extension (for tool call policy enforcement).

See [Worker Isolation](./worker-isolation.md) for the subprocess model and IPC
mechanism.

## Data Flow: User Input to Worker Result

```
User types a task
    │
    ▼
Orchestrator LLM processes input
    │
    ▼
LLM calls dispatch_agent tool
    │
    ├─── Admission gate (safety pre-flight, budget check, scope enforcement)
    │
    ▼
Worker spawn (src/domains/dispatch/worker-spawn.ts)
    │
    ├─── Resolve agent spec (model, tools, system prompt)
    ├─── Resolve runtime adapter (Pi native, CLI agent, SDK agent)
    ├─── Build worker environment (provider bridge, safety mode)
    │
    ▼
Subprocess execution
    │
    ├─── Worker entry point (src/worker/entry.ts or src/worker/cli-entry.ts)
    ├─── Pi SDK or CLI agent processes the task
    ├─── Safety extension gates every tool call
    ├─── Heartbeat events emitted to stdout (NDJSON)
    ├─── Progress events forwarded to orchestrator via SharedBus
    │
    ▼
Result collection
    │
    ├─── Worker writes result JSON to .pancode/runtime/results/
    ├─── Orchestrator reads result file
    ├─── Run ledger updated (dispatch/state.ts)
    ├─── Metrics recorded (observability/metrics.ts)
    ├─── Budget adjusted (scheduling/budget.ts)
    │
    ▼
Result returned to orchestrator LLM
    │
    ▼
LLM presents result to user
```

### Dispatch Tool Invocation

The orchestrator LLM calls `dispatch_agent` with a task description and
optional agent name. The dispatch extension (`src/domains/dispatch/extension.ts`)
processes the call through several stages:

1. **Admission**: pre-flight checks run in sequence. Budget gate, safety gate,
   and any registered custom gates must all pass.
2. **Agent resolution**: the agent spec registry provides the agent's model,
   tools, system prompt, and runtime type.
3. **Runtime selection**: the runtime registry selects the appropriate adapter
   (Pi native or CLI agent).
4. **Worker spawn**: a subprocess is created with the resolved configuration.
5. **Monitoring**: heartbeat events from the worker update the live progress
   display. Health monitoring detects stale or dead workers.
6. **Result collection**: on exit, the worker's result file is read and the
   run ledger is updated.

### Batch and Chain Dispatch

`batch_dispatch` spawns multiple workers in parallel with staggered launches
(configurable delay between spawns). Each worker in the batch runs independently
and results are collected individually.

`dispatch_chain` executes a sequence of tasks where each step's output feeds
into the next step's input via `$INPUT` and `$ORIGINAL` substitution variables.
The chain stops at the first failure.

## Boot Sequence Detail

The orchestrator boot sequence in `src/entry/orchestrator.ts`:

```
1. Parse CLI arguments (--preset, --model, --safety, --cwd, --fresh)
2. Load and merge preset from ~/.pancode/panpresets.yaml
3. Load configuration (5-tier resolution)
4. Ensure runtime directories exist
5. Reap orphaned runs from previous session
6. Phase 1: Collect domain extensions (topological sort)
7. Phase 2: Initialize auth storage
8. Phase 3: Load models (warm cache or cold discovery)
9. Phase 4: Load agents from panagents.yaml
10. Phase 5: Resolve orchestrator/worker/scout models
11. Phase 6: Create resource loader
12. Phase 7: Create Pi SDK agent session with all extensions
13. Phase 8: Start interactive shell
14. Background: run full provider discovery (warm boot only)
15. Register shutdown handlers (SIGINT, SIGTERM)
```

On warm boot, models are loaded from `~/.pancode/model-cache.yaml` in
milliseconds. Full provider discovery (probing Ollama, LM Studio, llama.cpp
endpoints) runs in the background after the shell is interactive, so the user
sees a responsive prompt immediately.

## Shutdown Sequence

`src/core/termination.ts` coordinates a 4-phase shutdown:

1. **Drain**: stop accepting new dispatch tasks, emit `pancode:shutdown-draining`
2. **Terminate**: send SIGTERM to all worker subprocesses, await exit with
   timeout, force SIGKILL if needed, mark active runs as "interrupted"
3. **Persist**: each domain serializes its state to disk
4. **Exit**: tear down TUI and exit

This sequence prevents checkpoint corruption from ghost processes. On the next
session start, the orchestrator detects interrupted runs in the ledger and
can offer recovery options.

## Configuration Resolution

PanCode resolves configuration from five sources, highest priority first:

1. **Runtime overrides**: `/settings` command during a session
2. **Environment variables**: `PANCODE_*` prefix
3. **Project config**: `<project>/.pancode/settings.json`
4. **Global config**: `~/.pancode/settings.json`
5. **Defaults**: `src/core/defaults.ts`

Presets (`~/.pancode/panpresets.yaml`) provide named configurations that set
model, worker model, scout model, reasoning level, and safety mode in one flag.

## Persistence Model

```
~/.pancode/                     # User configuration (survives reinstall)
  panpresets.yaml               # Boot presets
  panagents.yaml                # Agent definitions
  panproviders.yaml             # Provider configurations
  settings.json                 # Global user preferences
  model-cache.yaml              # Cached model discovery results
  agent-engine/                 # Pi SDK session data
    auth.json
    sessions/[cwd-hash]/

<project>/.pancode/             # Per-project runtime state
  settings.json                 # Project-level overrides
  runs.json                     # Dispatch run ledger
  metrics.json                  # Observability metrics
  budget.json                   # Cost tracking
  tasks.json                    # Task board state
  runtime/                      # Active session state
    board.json                  # Shared coordination board
    results/                    # Worker result files
```

Each domain manages its own persistence file. There is no centralized checkpoint
coordinator. Domains read their state on construction and write on mutation,
using atomic file writes (temp file + rename) for crash safety.

## Cross-References

- [Domains](./domains.md): complete reference for all 10 domains
- [Engine Boundary](./engine-boundary.md): Pi SDK isolation and runtime adapters
- [Worker Isolation](./worker-isolation.md): subprocess model and IPC
- [Event System](./event-system.md): SafeEventBus and cross-domain communication
- [Core Concepts](../getting-started/core-concepts.md): Pan taxonomy and mental models
- [Safety](../guides/safety.md): 4-layer behavioral model
- [Dispatch](../guides/dispatch.md): full dispatch pipeline
