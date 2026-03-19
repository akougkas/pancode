# PanCode

Composable multi-agent runtime for software engineering.

PanCode orchestrates heterogeneous coding agents across local and cloud
infrastructure. It dispatches workers as isolated subprocesses, each configured
with its own model, provider, tools, and budget. Workers run on local inference
engines (LM Studio, Ollama, llama.cpp) or cloud APIs (Anthropic, OpenAI, Google,
Mistral) in the same session. Declarative dispatch rules select the right agent
for each task based on capability profiles, and a formal scope model prevents
workers from exceeding the orchestrator's permissions.

The runtime is built on 8 composable domains (safety, agents, dispatch, session,
observability, scheduling, intelligence, ui) that load in topological order, share
state through a safe event bus, and each own their commands. The engine boundary
at `src/engine/` is the sole import surface for the underlying Pi coding agent
SDK, enforced at build time. Worker isolation is physical: `src/worker/` cannot
import from `src/domains/`.

PanCode is not a chatbot wrapper. It is not a plugin for an existing IDE. It is
not a SaaS product. It is not vendor-locked to any single LLM provider. It is a
runtime that owns the process, enforces policy, tracks state, and reports what
happened.


## Architecture

The 8 domains load in dependency order. Foundation infrastructure in `core/`
loads first. Independent domains (safety, session) load next. Domains that
depend on others load after their dependencies are satisfied. The domain loader
performs a topological sort of manifest declarations at startup.

```
Level 0: core/
  Config loading, SafeEventBus, domain loader, termination coordinator,
  config validator, atomic config writer, package root discovery

Level 2: safety (independent)
  Formal scope model (4 levels, 9 action classes, 3 autonomy modes)
  Action classifier, scope enforcement, YAML rules engine, loop detector
  Audit trail with structured events

Level 2: session (independent)
  Context registry (file-backed cross-agent state)
  Shared board (in-memory IPC with namespaced keys)
  Three-tier memory (temporal, persistent, shared)

Level 3: agents (depends on nothing)
  Agent spec registry, YAML agent loading with env var expansion
  Team definitions, agent capability declarations

Level 4: dispatch (depends on safety, agents)
  Worker subprocess spawning via child_process.spawn
  NDJSON event stream parsing, result extraction
  Declarative routing rules, batch tracking
  Dispatch admission gating (pre-flight pipeline)
  Run ledger persistence, state machine lifecycle

Level 5: observability (depends on dispatch)
  Structured metrics (per-run token counts, durations, exit codes)
  Runtime health monitoring, event correlation

Level 5: scheduling (depends on dispatch, agents)
  Token-native budget accounting (input/output separate)
  Cost estimation, warning thresholds
  Cluster node awareness and capacity tracking

Level 6: intelligence (depends on dispatch, agents) [experimental]
  Intent detection, dispatch plan generation, adaptive learning
  Disabled by default, gated behind PANCODE_INTELLIGENCE env var

Level 6: ui (depends on dispatch, agents, session, scheduling, observability)
  PanCode branding, dark/light themes
  Dispatch board with worker cards and live telemetry
  Context tracker, widget utilities
  Shell override system (PanCode commands replace native engine commands)
```

### Dependency Graph

```
            ┌────────────────────────────────────┐
            │           core/ (Level 0)          │
            │  config, event-bus, domain-loader  │
            │  termination, init, package-root   │
            └──────────────┬─────────────────────┘
                           │
              ┌────────────┼────────────┐
              ▼            ▼            ▼
        ┌──────────┐ ┌──────────┐ ┌──────────┐
        │  safety  │ │ session  │ │  agents  │
        │ Level 2  │ │ Level 2  │ │ Level 3  │
        └─────┬────┘ └────┬─────┘ └─────┬────┘
              │            │             │
              └──────┬─────┘      ┌──────┘
                     ▼            ▼
              ┌──────────────────────────┐
              │       dispatch (L4)      │
              │  uses: safety, agents    │
              └────────────┬─────────────┘
                     ┌─────┴──────┐
                     ▼            ▼
              ┌─────────────┐ ┌──────────────┐
              │observability│ │  scheduling  │
              │   Level 5   │ │   Level 5    │
              └──────┬──────┘ └──────┬───────┘
                     │               │
                     └───────┬───────┘
                             ▼
              ┌──────────────────────────────┐
              │  intelligence (L6, disabled) │
              │  ui (L6, reads all above)    │
              └──────────────────────────────┘
```

### Three Structural Decisions

**Engine boundary.** `src/engine/` wraps every Pi SDK type and function that
PanCode uses. The 8 files in this directory re-export session creation, tool
registration, extension types, TUI components, and resource loaders. No file
outside `src/engine/` imports from `@pancode/pi-coding-agent`, `@pancode/pi-ai`,
`@pancode/pi-tui`, or `@pancode/pi-agent-core`. A build-time check
(`npm run check-boundaries`) enforces this invariant by scanning all import
statements outside the engine directory. A Pi SDK minor version upgrade changes
only `src/engine/` files. Domain code is never exposed to SDK internals.

**Worker isolation.** `src/worker/` lives outside `src/domains/`. The worker
entry point (`src/worker/entry.ts`) and provider bridge
(`src/worker/provider-bridge.ts`) cannot accidentally import orchestrator domain
logic because they exist in a separate directory tree. Workers are Node.js
subprocesses spawned via `child_process.spawn` in `src/domains/dispatch/worker-spawn.ts`.
Each worker receives its task, agent spec, model configuration, and safety
constraints via environment variables and command-line arguments. Communication
is one-directional: workers emit NDJSON events on stdout, and the orchestrator
parses them into structured results containing response text, token usage,
model identity, and exit codes.

**Domain-owned commands.** Each domain's `extension.ts` registers its own slash
commands via the Pi SDK extension API. The dispatch domain registers `/runs` and
`/batches`. The scheduling domain registers `/budget`. The agents domain
registers `/agents`. The observability domain registers `/metrics`. The UI domain
registers display commands (`/dashboard`, `/status`, `/theme`, `/help`, `/exit`).
No god-object command registry exists. Domains import pure rendering functions
from `ui/renderers.ts` for output formatting, keeping the dependency
unidirectional: domains depend on UI for rendering, UI never depends on domains
for state.


## What Works Today (v0.1.0)

Everything listed here is implemented, compiled, and verified against real
local inference endpoints on a homelab cluster.

### TUI and Branding

PanCode boots its own branded terminal interface with dark and light themes
(`src/domains/ui/extension.ts`). The theme files live in
`packages/pi-coding-agent/src/modes/interactive/theme/pancode-dark.json` and
`pancode-light.json`. PanCode overrides the underlying engine's native shell
commands (`src/engine/shell-overrides.ts`) so the user sees a unified command
surface. The override system replaces native `/model`, `/settings`, and `/quit`
with PanCode equivalents (`/models`, `/preferences`, `/exit`).

### Local Engine Discovery

PanCode connects to local inference engines via their native SDKs:

| Engine | SDK | Default Port | File |
|--------|-----|-------------|------|
| LM Studio | `@lmstudio/sdk` | 1234 | `src/domains/providers/engines/lmstudio.ts` |
| Ollama | `ollama` (npm) | 11434 | `src/domains/providers/engines/ollama.ts` |
| llama.cpp | HTTP API | 8080 | `src/domains/providers/engines/llamacpp.ts` |

Discovery (`src/domains/providers/discovery.ts`) probes configurable addresses,
queries loaded models from each engine, and registers them in the model registry
(`src/domains/providers/registry.ts`) with capability profiles: context window
size, tool calling support, vision capability, and reasoning mode. The profiles
feed into dispatch routing so PanCode sends tasks to models that can handle them.

Cloud API providers (Anthropic, OpenAI, Google, Mistral, and any OpenAI-compatible
endpoint) are also supported via `src/domains/providers/api-providers.ts`.

### Dispatch

Two tools handle all dispatch operations, registered in
`src/domains/dispatch/extension.ts`:

**`dispatch_agent`** sends a single task to a subprocess worker. The caller
specifies the task description and optionally an agent type, model override, and
timeout. The dispatch domain resolves the agent spec from the registry, applies
routing rules (`src/domains/dispatch/routing.ts`), runs admission checks
(`src/domains/dispatch/admission.ts`) including scope enforcement and budget
verification, spawns the worker subprocess (`src/domains/dispatch/worker-spawn.ts`),
and collects the result. The run is tracked in the run ledger
(`src/domains/dispatch/state.ts`) with full lifecycle state transitions:
queued, running, completed, failed, timeout.

**`batch_dispatch`** takes an array of tasks and runs them in parallel with
configurable concurrency (default 4, max 8). The batch tracker
(`src/domains/dispatch/batch-tracker.ts`) monitors all workers and returns
aggregated results with per-task summaries truncated to 500 characters.
Failed tasks include stderr output and exit codes for debugging.

Workers communicate via NDJSON event streams on stdout. The worker entry point
(`src/worker/entry.ts`) bootstraps a Pi SDK subprocess with a safety extension
(`src/worker/safety-ext.ts`) that enforces the orchestrator's scope constraints
within the worker process. The provider bridge
(`src/worker/provider-bridge.ts`) configures the worker's model connection.

### Built-in Agent Types

Three agents ship by default, defined in `~/.pancode/agents.yaml` and loaded
at boot by `src/domains/agents/spec-registry.ts`:

| Agent | Tools | Mode | Purpose |
|-------|-------|------|---------|
| `dev` | read, write, bash, grep, find, ls, edit | read-write | General coding, file modification, build tasks |
| `reviewer` | read, grep, find, ls | read-only | Code review, bug analysis, security audit |
| `scout` | read, grep, find, ls | read-only | Codebase exploration, information gathering |

Agent definitions support `${ENV_VAR}` expansion in the model field, per-agent
sampling presets (matched against the model knowledge base), custom system
prompts, and readonly mode enforcement. Users can add new agents by editing
`~/.pancode/agents.yaml`. The YAML schema supports any combination of tools,
models, and instructions.

### Model Knowledge Base

YAML files in `models/` describe model architectures and capabilities:

```yaml
# models/qwen35-a3b.yaml
name: Qwen3.5-35B-A3B
architecture: hybrid-moe
parameters: 35B total, 3B active
context_window: 262144
sampling:
  coding:
    temperature: 0.0
    top_p: 0.95
    frequency_penalty: 0.05
```

The model matcher (`src/domains/providers/model-matcher.ts`) uses fuzzy matching
to identify discovered models against the knowledge base and apply appropriate
sampling parameters. When a known model is detected on a local engine, PanCode
automatically configures temperature, top_p, and penalty values for coding tasks.

### Live Dispatch Board

The UI domain renders a dispatch board (`src/domains/ui/dispatch-board.ts`)
during active sessions. Each dispatched worker gets a card showing:

- Task description and agent type
- Target model and provider
- Current status (queued, running, completed, failed)
- Duration and token usage (input/output)
- Error details on failure

Worker widgets (`src/domains/ui/worker-widgets.ts`) provide real-time telemetry.
The context tracker (`src/domains/ui/context-tracker.ts`) monitors context usage
across the session.

### Two-Layer Safety

**Layer 1: Formal Scope Model** (`src/domains/safety/scope.ts`)

Four scope levels form a strict hierarchy:
```
read < suggest < write < admin
```

Nine action classes categorize every tool operation:
```
file_write, file_delete, bash_exec, bash_destructive,
git_push, git_destructive, network, agent_dispatch, system_modify
```

Three autonomy modes control approval behavior:
```
suggest     User approves everything
auto-edit   Writes auto-approved, destructive actions require approval
full-auto   All actions auto-approved within scope
```

The action classifier (`src/domains/safety/action-classifier.ts`) maps tool
names to action classes. Scope enforcement
(`src/domains/safety/scope-enforcement.ts`) validates that each action is
permitted under the current scope level and autonomy mode. Dispatch admission
gating (`src/domains/dispatch/admission.ts`) enforces the invariant that worker
scope can never exceed orchestrator scope. This check happens before dispatch,
not after failure.

**Layer 2: YAML Rules Engine** (`src/domains/safety/yaml-rules.ts`)

Project-level safety rules in `.pancode/safety-rules.yaml` define:
- Glob-based path restrictions (which files agents can read/write)
- Regex-based command patterns (which bash commands are allowed/blocked)
- Per-agent rule overrides

A loop detector (`src/domains/safety/loop-detector.ts`) monitors consecutive
failures and repeated tool calls to catch agents stuck in unproductive loops.

### Session Coordination

The session domain provides three coordination mechanisms:

**Context registry** (`src/domains/session/context-registry.ts`): file-backed
key-value store where agents report structured findings. The orchestrator and
subsequent workers can read accumulated context from prior dispatches. Atomic
writes ensure crash safety.

**Shared board** (`src/domains/session/shared-board.ts`): in-memory IPC for
fast orchestrator-to-worker coordination. Supports namespaced keys, TTL for
ephemeral entries, and subscription callbacks. Suitable for exploration tasks
and lightweight data passing.

**Three-tier memory** (`src/domains/session/memory.ts`):
- Temporal: session-scoped, lost on exit
- Persistent: survives across sessions (file-backed)
- Shared: visible to all agents in the current session

### Observability and Scheduling

Structured metrics collection (`src/domains/observability/metrics.ts`) records
per-run data: token counts, durations, exit codes, model identity, and agent
type. The health monitor (`src/domains/observability/health.ts`) tracks runtime
state.

Budget tracking (`src/domains/scheduling/budget.ts`) provides token-native cost
accounting. Input and output tokens are tracked separately. Cost estimation uses
per-provider rate tables. Warning thresholds trigger at configurable percentages
of the session budget ceiling. Budgets reset per session while the ceiling
persists across sessions.

The cluster module (`src/domains/scheduling/cluster.ts`) provides node awareness
and capacity tracking for multi-machine setups.

### Multi-Phase Shutdown

The termination coordinator (`src/core/termination.ts`) runs a 4-phase shutdown:

1. **Drain**: stop all active workers, wait for graceful exit
2. **Shutdown**: emit `session_shutdown` event to all domains
3. **Persist**: domains write their state to disk
4. **Exit**: clean process termination

Workers always drain before the orchestrator tears down. This prevents orphaned
subprocesses and ensures run ledger consistency.

### Commands

**14 slash commands** registered across domains:

| Command | Domain | Purpose |
|---------|--------|---------|
| `/help` | ui | Show all available commands, categorized by domain |
| `/models` | ui | List active and available models across providers |
| `/agents` | agents | Show registered agent types and their configurations |
| `/dashboard` | ui | Full session overview (dispatch board, metrics, budget) |
| `/status` | ui | Current session state summary |
| `/budget` | scheduling | Token usage and cost breakdown |
| `/metrics` | observability | Per-run metrics and aggregated statistics |
| `/runs` | dispatch | Active and completed dispatch runs |
| `/batches` | dispatch | Batch dispatch history and results |
| `/reasoning` | ui | Toggle or display reasoning/thinking mode |
| `/thinking` | ui | Set thinking level for the current session |
| `/theme` | ui | Switch between pancode-dark and pancode-light |
| `/preferences` | ui | View and edit session preferences |
| `/exit` | ui | Graceful shutdown with full drain sequence |

**CLI subcommands:**

| Command | Purpose |
|---------|---------|
| `pancode` | Start interactive TUI session |
| `pancode up` | Start or reattach a tmux-managed session |
| `pancode down` | Stop the tmux session |
| `pancode login` | Authenticate with cloud providers |
| `pancode --help` | Show usage (fast path, no SDK loaded) |
| `pancode --version` | Print version (fast path, no SDK loaded) |


## What's Planned

Features designed in the architecture spec but not yet shipped. The distinction
between scaffolded, designed, and vision is noted for each.

### Scaffolded (code exists, disabled by default)

**Intelligence subsystem** (`src/domains/intelligence/`): 7 files implementing
intent detection (`intent-detector.ts`), dispatch plan generation (`solver.ts`),
and adaptive learning from outcomes (`learner.ts`). The intelligence domain
subscribes to dispatch lifecycle events and can learn optimal routing decisions
over time. Currently disabled; activates when `PANCODE_INTELLIGENCE=enabled`.
This subsystem provides the upgrade path from declarative rules to learned
dispatch behavior.

### Designed (in the architecture spec, not yet coded)

**Dispatch chains.** Sequential pipeline execution where each step's output
feeds the next via `$INPUT` and `$ORIGINAL` substitution tokens. A plan-build-review
chain would dispatch a planner, pass its output to a builder, then pass both
to a reviewer. Stops at first failure.

**Output contracts.** Post-dispatch validation gates: expected files must exist,
expected patterns must appear in output, optional validation commands must exit
with code 0. Contracts make dispatch results machine-verifiable.

**Resilience primitives.** Per-provider circuit breakers that detect sustained
failures and temporarily remove unhealthy providers. Per-agent retry policies
with configurable max retries, backoff intervals, and retry conditions.
Error classification (auth_missing, quota_exceeded, provider_outage,
network_error, timeout, context_overflow) determines retry eligibility.

**Review-gated chains.** A chain variant where a reviewer agent evaluates each
step's output. Verdicts of pass, fail, or revise control the loop. On revise,
the previous step re-runs with structured feedback. Cycle limits prevent
infinite loops.

**Worktree isolation.** Each worker operates in its own git worktree. A merge
gate sequences worktree merges back to the main branch: one at a time, ordered,
with pre-merge snapshot tags for rollback and conflict detection.

### Vision (roadmap ideas, not in current spec)

**SSH dispatch.** Spawn workers on remote machines via SSH tunnels. The
orchestrator on a lightweight node sends tasks to GPU-equipped servers.

**Slurm adapter.** Submit PanCode dispatch operations as Slurm jobs for
integration with HPC clusters. Job submission, status polling, artifact
collection.

**A2A/ACP integration.** Cross-runtime agent coordination using the Agent2Agent
protocol or Agent Communication Protocol. PanCode workers could interact with
agents running in other frameworks.

**Skills discovery.** Dynamic loading of agent skill packages from a registry.
Agents declare required skills, PanCode resolves and installs them at dispatch
time.


## Quick Start

```bash
npx pancode
```

On first run, PanCode:

1. Creates `~/.pancode/` with default `agents.yaml` (dev, reviewer, scout)
2. Probes `localhost:1234` (LM Studio), `localhost:11434` (Ollama), and
   `localhost:8080` (llama.cpp) for running engines
3. Registers discovered models with capability profiles
4. Boots the TUI with the first available model

If no engines are found and no cloud API keys are set, PanCode starts in
degraded mode and prints guidance:

```
No models are available. Start a local engine (LM Studio :1234,
Ollama :11434, llama-server :8080) or set ANTHROPIC_API_KEY /
OPENAI_API_KEY and restart PanCode.
```

### Usage Examples

```bash
# Start with a specific model
npx pancode --model ollama/qwen3:8b

# Override the worker model (workers use a different model than orchestrator)
PANCODE_WORKER_MODEL=lmstudio/gpt-oss-20b npx pancode

# Set safety to full-auto (all actions auto-approved within scope)
npx pancode --safety full-auto

# Start in tmux (persistent session, reattach on next run)
npx pancode up

# Stop the tmux session
npx pancode down

# Authenticate with a cloud provider
npx pancode login
```

### Inside the Session

Once the TUI is running, the orchestrator LLM can dispatch tasks to workers:

```
> Review the dispatch admission logic for edge cases

The orchestrator can use dispatch_agent to send this to a reviewer:
  agent: reviewer
  model: (resolved from PANCODE_WORKER_MODEL)
  tools: read, grep, find, ls (read-only)

Or batch_dispatch for parallel work:
  tasks: ["Review admission.ts", "Review routing.ts", "Review rules.ts"]
  agent: reviewer
  concurrency: 3
```

Slash commands provide runtime introspection:

```
/runs          Show active and completed dispatches
/budget        Token usage and cost so far
/agents        List available agent types
/dashboard     Full session overview
```


## Configuration

### User-Level (`~/.pancode/`)

| File | Purpose |
|------|---------|
| `agents.yaml` | Agent definitions with name, tools, model, sampling preset, system prompt, and readonly flag |
| `providers.yaml` | Auto-discovered engines, their addresses, and loaded models (regenerated on boot) |
| `settings.json` | User preferences: theme, safety level, reasoning mode, thinking level |

### Project-Level (`.pancode/` in working directory)

| File | Purpose |
|------|---------|
| `safety-rules.yaml` | Glob path restrictions, regex command rules, per-agent overrides |
| `runtime/runs.json` | Dispatch run ledger (task, agent, model, status, tokens, duration) |
| `runtime/board.json` | Shared board state (namespaced key-value pairs) |
| `runtime/context.json` | Context registry (cross-agent accumulated findings) |
| `runtime/metrics.json` | Session metrics (per-run telemetry data) |

### Environment Variables

| Variable | Purpose | Example |
|----------|---------|---------|
| `PANCODE_MODEL` | Orchestrator model override | `ollama/qwen3:8b` |
| `PANCODE_WORKER_MODEL` | Default model for dispatched workers | `lmstudio/gpt-oss-20b` |
| `PANCODE_SCOUT_MODEL` | Model for scout agents (fast, small) | `ollama/granite-4-h-micro` |
| `PANCODE_SAFETY` | Safety level | `suggest`, `auto-edit`, `full-auto` |
| `PANCODE_THEME` | UI theme | `pancode-dark`, `pancode-light` |
| `PANCODE_REASONING` | Enable model reasoning | `on`, `off` |
| `PANCODE_INTELLIGENCE` | Enable experimental intelligence subsystem | `enabled` |
| `PANCODE_LOCAL_MACHINES` | Additional machines for engine discovery | `gpu1=10.0.0.5,gpu2=10.0.0.6` |
| `PANCODE_BUDGET_CEILING` | Session budget cap in dollars | `10.0` |
| `PANCODE_NODE_CONCURRENCY` | Max concurrent workers per node | `4` |


## For Researchers and Lab Engineers

PanCode targets operators who need predictable, inspectable, multi-agent
execution on their own infrastructure. The design priorities reflect this
audience.

**Local inference.** Your data stays on your machines. PanCode connects to
LM Studio, Ollama, and llama.cpp via their native SDKs. No data leaves your
network unless you explicitly configure cloud providers. Agent definitions and
safety rules are local YAML files under version control.

**Reproducible dispatch.** Declarative rules (`src/domains/dispatch/rules.ts`)
produce deterministic agent selection. The same task description, agent pool, and
rule set yield the same routing decision. Agent definitions, safety rules, and
model configurations are all YAML files that live in your repository. The
dispatch run ledger records every decision for post-hoc inspection.

**Budget tracking.** Token and estimated cost accounting per dispatch and per
session. Input and output tokens tracked separately. Warning thresholds at
configurable percentages. Admission gating can reject dispatches that would
exceed the session budget. Cost data is available via `/budget` and persisted
in `runtime/metrics.json`.

**Provider agnostic.** Switch between local models and cloud APIs without
changing agent definitions or dispatch rules. The model field in `agents.yaml`
accepts any `provider/model-id` string. PanCode resolves it against discovered
providers at dispatch time. A task dispatched to `ollama/qwen3:8b` today can
target `anthropic/sonnet-4` tomorrow with a single environment
variable change.

**Cluster-aware topology.** The orchestrator and workers can target different
machines. An orchestrator running on a CPU node can dispatch workers to a
GPU-equipped inference server running LM Studio on the local network. Configure
additional discovery targets via `PANCODE_LOCAL_MACHINES` with `name=address`
pairs. The scheduling domain tracks node capacity for dispatch decisions.

**Scope contracts.** The formal scope model ensures workers never exceed the
orchestrator's permissions. A reviewer agent configured as read-only cannot
accidentally invoke write tools, even if the underlying model hallucinates tool
calls. This property is enforced before dispatch (admission gating) and within
the worker process (safety extension). The safety decision is auditable.


## Architecture Reference

The full architecture specification lives in `extension-architecture-spec.md`
and covers domain interfaces, state ownership, the dependency graph, multi-phase
shutdown, and the build plan.

### Principles

- **Domain independence.** Each domain can be loaded independently. No circular
  dependencies. The domain loader (`src/core/domain-loader.ts`) topologically
  sorts manifests and rejects cycles.

- **State ownership.** No domain mutates another domain's state. Cross-domain
  communication goes through the SafeEventBus (`src/core/event-bus.ts`), which
  wraps each listener in a try-catch so a crashing handler does not propagate
  to the emitting domain or other listeners.

- **Domain extensibility.** Adding a new domain requires a folder with
  `manifest.ts` (declaring name and dependency list) and `extension.ts`
  (implementing the Pi SDK ExtensionFactory interface). Register the domain
  in `src/domains/index.ts`. The loader handles initialization order.

- **SDK isolation.** Pi SDK version upgrades change only `src/engine/` files.
  Domain code never imports SDK packages directly. The engine directory re-exports
  precisely the types and functions PanCode needs: session creation, tool
  registration, extension hooks, TUI components, resource loaders.

- **Atomic persistence.** Config writes use temp file + fsync + rename via
  `src/core/config-writer.ts`. A crash during write never produces a corrupt
  file. The previous version remains intact until the rename succeeds.

- **Two-file loader.** `src/loader.ts` sets environment variables and resolves
  the entry point before any SDK code is imported. `src/entry/orchestrator.ts`
  composes the domain stack and boots the interactive session. This separation
  ensures fast-path CLI commands (`--help`, `--version`) never load the SDK.

### Source Tree

```
src/
  loader.ts                           Bin entry: env vars, fast paths, entry routing
  entry/orchestrator.ts               Interactive TUI: domain composition, boot sequence

  engine/                             Sole Pi SDK import boundary
    types.ts                          Re-exported SDK types
    session.ts                        createAgentSession wrapper
    tools.ts                          registerTool, tool result types
    extensions.ts                     ExtensionFactory, ExtensionContext, hooks
    resources.ts                      ResourceLoader, SessionManager, SettingsManager
    tui.ts                            Pi TUI components (Box, Text, Container)
    shell.ts                          Shell utilities
    shell-overrides.ts                PanCode command overrides for native commands

  core/                               Host infrastructure only
    config.ts                         Config loading, profile resolution
    config-validator.ts               TypeBox schema validation
    config-writer.ts                  Atomic writes (temp + fsync + rename)
    defaults.ts                       Built-in defaults (theme, safety, tools, domains)
    init.ts                           Global runtime initialization
    domain-loader.ts                  Topological sort and domain loading
    event-bus.ts                      SafeEventBus (error-isolating emitter)
    shared-bus.ts                     Module singleton for cross-domain events
    termination.ts                    Multi-phase shutdown coordinator
    concurrency.ts                    Auto-detect concurrency from CPU/memory
    package-root.ts                   Package and project root discovery
    settings-state.ts                 Settings state management
    shell-metadata.ts                 Shell environment detection
    thinking.ts                       Reasoning level resolution

  domains/
    safety/          (9 files)        Scope, classifier, enforcement, rules, audit, loop
    session/         (6 files)        Context registry, shared board, memory
    agents/          (5 files)        Spec registry, teams, YAML loading
    dispatch/       (12 files)        Spawn, routing, admission, rules, state, batch
    providers/      (11 files)        LM Studio, Ollama, llama.cpp, cloud, matching
    observability/   (5 files)        Metrics, health
    scheduling/      (5 files)        Budget, cluster
    intelligence/    (7 files)        Intent, solver, learner (experimental)
    ui/              (9 files)        Board, widgets, themes, branding, renderers

  worker/                             Physically isolated from domains/
    entry.ts                          Worker subprocess bootstrap
    provider-bridge.ts                Worker model connection
    safety-ext.ts                     Worker-side scope enforcement

  cli/                                Thin launcher
    index.ts                          Subcommand router
    up.ts, down.ts                    tmux session lifecycle
    login.ts                          Provider authentication
    version.ts                        Version display
    shared.ts                         Exit codes, utilities
```

104 TypeScript files. Strict mode. Zero `any` except at the Pi SDK JSON event
boundary.


## Contributing

```bash
git clone https://github.com/akougkas/pancode.git
cd pancode
npm install
npm run typecheck       # TypeScript strict + boundary check
npm run build           # Compile to dist/
npm run dev             # Run from source with tsx
```

Requires Node.js >= 20. Uses npm workspaces for vendored Pi SDK packages
in `packages/`.

The codebase enforces two isolation boundaries at build time:
1. No file outside `src/engine/` imports from `@pancode/pi-*` packages
2. No file in `src/worker/` imports from `src/domains/`

Run `npm run check-boundaries` to verify both constraints. This check runs
as part of `npm run typecheck`.


## Project History

PanCode started as AWOC (Agentic Workflows Orchestration Cabinet) in September
2025. Six months of iteration produced a working multi-agent runtime through
seven milestone releases (v0.1.0 through v0.7.0), but two god objects
(session.ts at 1,893 lines, tools.ts at 1,612 lines) defeated three incremental
refactor attempts. The entanglement between UI rendering, tool registration,
dispatch coordination, and session management in these files made decomposition
impossible without breaking the call graph.

In March 2026, a clean-room rebuild started from an empty `src/` directory
using the architecture specification as the sole design authority. No code was
migrated from the old codebase. Domain boundaries, the engine abstraction layer,
and worker isolation were built from first principles.

This release is that rebuild: 104 files, 8 composable domains, zero legacy debt.


## License

Apache 2.0


## Author

[Anthony Kougkas](https://github.com/akougkas)
