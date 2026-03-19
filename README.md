# PanCode

Universal agent control plane for software engineering.

PanCode orchestrates any coding agent installed on your machine through one
composable runtime. Claude Code, Codex, Gemini CLI, OpenCode, Cline, and
GitHub Copilot CLI all become dispatchable workers alongside PanCode's native
agents. Every agent runs under the same formal safety model, uses the same
dispatch system, and reports through the same observability surface. No other
tool dispatches to heterogeneous CLI agents through a unified runtime
abstraction with scope enforcement.

## What It Looks Like

### Agent configuration with mixed runtimes

```yaml
# ~/.pancode/agents.yaml
agents:
  dev:
    description: "General-purpose coding agent"
    model: ${PANCODE_WORKER_MODEL}
    tools: [read, bash, grep, find, ls, write, edit]
    sampling: coding
    readonly: false

  claude-reviewer:
    runtime: cli:claude-code
    description: "Claude Code for deep code review"
    runtime_args: ["--allowedTools", "Read,Grep,Glob"]
    readonly: true

  codex-fixer:
    runtime: cli:codex
    description: "Codex for quick targeted edits"
    runtime_args: ["--full-auto"]
    readonly: false

  opencode-scout:
    runtime: cli:opencode
    description: "opencode explore agent for codebase research"
    readonly: true
```

### Runtime discovery at boot

```
/runtimes

  NATIVE
  pi                Available   built-in

  CLI
  cli:claude-code   Available   claude
  cli:codex         Available   codex
  cli:gemini        Available   gemini
  cli:opencode      Available   opencode
  cli:cline         Available   cline
  cli:copilot-cli   Available   copilot
```

### Dispatch

```
> Review the dispatch admission logic for edge cases

dispatch_agent(agent: "claude-reviewer", task: "Review admission.ts for edge cases")
  runtime: cli:claude-code
  tools: Read, Grep, Glob (readonly)
  scope: read (cannot exceed orchestrator)

Result: 3 findings, 0 critical, 47s, 12,400 tokens
```

## Key Features

- **Universal Agent Dispatch.** 6 CLI runtime adapters plus native Pi agents. Dispatch to Claude Code, Codex, Gemini CLI, OpenCode, Cline, or Copilot CLI as subprocess workers.
- **Runtime Abstraction.** `AgentRuntime` interface with `buildSpawnConfig` and `parseResult`. Auto-discovery scans PATH at boot and registers available runtimes.
- **Formal Safety Model.** 4 scope levels (`read < suggest < write < admin`), 9 action classes, 3 autonomy modes. Workers cannot exceed the orchestrator's scope. Enforced before dispatch and inside the worker process.
- **8 Composable Domains.** Topological loading, independent persistence, safe event bus. Each domain owns its commands and state.
- **Provider Agnostic.** 16+ LLM providers. Local-first with LM Studio, Ollama, llama.cpp, vLLM, SGLang. Cloud APIs (Anthropic, OpenAI, Google, Mistral) supported in the same session.
- **Chain and Batch Dispatch.** Sequential pipelines with `$INPUT`/`$ORIGINAL` token substitution. Parallel batch execution with configurable concurrency.
- **Live Dispatch Board.** Worker cards with runtime badges, token tracking, duration, and error details. Updated in real time via event bus.
- **37 Slash Commands** across 7 categories (session, dispatch, agents, observe, schedule, display, utility).
- **Cost Tracking.** Per-run, per-agent, per-model token and cost breakdown. Budget ceiling with admission gating.
- **5 Orchestrator Modes.** Capture (blue), plan (purple), build (green), ask (orange), review (red). Mode gating controls which dispatches are allowed.

## Supported Runtimes

| Runtime | Tier | Binary | Output Parsing | Status |
|---------|------|--------|----------------|--------|
| Pi (native) | Native | built-in | NDJSON streaming | Shipped |
| Claude Code | CLI | `claude` | JSON structured | Shipped |
| Codex CLI | CLI | `codex` | JSON | Shipped |
| Gemini CLI | CLI | `gemini` | Text | Shipped |
| OpenCode | CLI | `opencode` | NDJSON (gold-tier) | Shipped |
| Cline CLI 2.0 | CLI | `cline` | Text/JSON | Shipped |
| Copilot CLI | CLI | `copilot` | Text | Shipped |

Adapter quality tiers: Gold (full NDJSON/JSON parsing with token/cost tracking), Silver (basic JSON), Bronze (text-only). OpenCode is the gold standard reference adapter.

## Architecture

### Domain Stack

```
Level 0: core/
  Config loading, SafeEventBus, domain loader, termination coordinator,
  config validator, atomic config writer, package root discovery

Level 2: safety (independent)
  Formal scope model (4 levels, 9 action classes, 3 autonomy modes)
  Action classifier, scope enforcement, YAML rules engine, loop detector

Level 2: session (independent)
  Context registry (file-backed cross-agent state)
  Shared board (in-memory IPC with namespaced keys)
  Three-tier memory (temporal, persistent, shared)

Level 3: agents (depends on nothing)
  Agent spec registry, YAML agent loading with env var expansion
  Runtime field support for CLI agent dispatch

Level 4: dispatch (depends on safety, agents)
  Worker subprocess spawning, NDJSON event stream parsing
  Declarative routing rules, batch tracking, chain dispatch
  Dispatch admission gating, run ledger persistence

Level 5: observability (depends on dispatch)
  Structured audit trail, 8-probe health diagnostics
  Per-run metrics (token counts, durations, exit codes)

Level 5: scheduling (depends on dispatch, agents)
  Token-native budget accounting, cost estimation
  Cluster node awareness, provider resilience tracking

Level 6: intelligence (disabled, experimental)
  Intent detection, dispatch plan generation, adaptive learning

Level 6: ui (depends on all above)
  Dispatch board, worker cards, PanCode themes
  Shell overrides, categorized help, mode cycling
```

### Dependency Graph

```
            +------------------------------------+
            |           core/ (Level 0)          |
            |  config, event-bus, domain-loader  |
            |  termination, init, package-root   |
            +------------------+-----------------+
                               |
                 +-------------+-------------+
                 v             v             v
           +----------+  +----------+  +----------+
           |  safety  |  | session  |  |  agents  |
           | Level 2  |  | Level 2  |  | Level 3  |
           +-----+----+  +----+-----+  +-----+----+
                 |             |              |
                 +------+------+       +------+
                        v              v
                 +--------------------------+
                 |       dispatch (L4)      |
                 |  uses: safety, agents    |
                 +-------------+------------+
                        +------+-------+
                        v              v
                 +-------------+  +--------------+
                 |observability|  |  scheduling  |
                 |   Level 5   |  |   Level 5    |
                 +------+------+  +------+-------+
                        |                |
                        +--------+-------+
                                 v
                 +------------------------------+
                 |  intelligence (L6, disabled) |
                 |  ui (L6, reads all above)    |
                 +------------------------------+
```

### Engine Boundary

`src/engine/` is the sole import surface for the underlying Pi coding agent
SDK. No file outside `src/engine/` imports from `@pancode/pi-coding-agent`,
`@pancode/pi-ai`, `@pancode/pi-tui`, or `@pancode/pi-agent-core`. A build-time
check (`npm run check-boundaries`) enforces this. An SDK version upgrade changes
only `src/engine/` files. The runtime abstraction layer lives in
`src/engine/runtimes/`, where each CLI adapter implements the `AgentRuntime`
interface to translate PanCode dispatch into subprocess invocations.

### Worker Isolation

`src/worker/` is physically separated from `src/domains/`. Workers are Node.js
subprocesses spawned via `child_process.spawn`. Each worker receives its task,
agent spec, model configuration, and safety constraints via environment variables
and CLI arguments. Communication is one-directional: workers emit events on
stdout, the orchestrator parses them into structured `RuntimeResult` objects.
For CLI runtimes, the adapter builds the spawn config and the dispatcher handles
process lifecycle.

## Getting Started

### Prerequisites

- Node.js >= 20
- npm (workspaces for vendored SDK packages)
- At least one of: a local inference engine (LM Studio, Ollama, llama.cpp) or a cloud API key (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`)
- Optional: any combination of `claude`, `codex`, `gemini`, `opencode`, `cline`, `copilot` on your PATH for CLI agent dispatch

### Installation

```bash
git clone https://github.com/akougkas/pancode.git
cd pancode
npm install
npm run build
```

### Configuration

On first boot, PanCode creates `~/.pancode/` with a default `agents.yaml`
containing three native agents (dev, reviewer, scout) and commented examples
for CLI agents. Edit this file to add your own agents with any runtime.

```bash
# Set the worker model (used by native agents)
export PANCODE_WORKER_MODEL=ollama/qwen3:8b

# Optional: set a different orchestrator model
export PANCODE_MODEL=lmstudio/qwen3.5-35b

# Optional: safety mode (suggest, auto-edit, full-auto)
export PANCODE_SAFETY=auto-edit
```

### First Boot

```bash
# Start interactive TUI
npm start

# Or run from built output
node dist/loader.js

# Fast paths (no SDK loaded)
npm start -- --help
npm start -- --version
```

PanCode probes `localhost:1234` (LM Studio), `localhost:11434` (Ollama), and
`localhost:8080` (llama.cpp) for running engines, registers discovered models
with capability profiles, and boots the TUI. If no engines or API keys are
found, PanCode starts in degraded mode with guidance.

### First Dispatch

Inside the TUI, the orchestrator LLM dispatches workers via tool calls:

```
> Review the routing module for security issues

The orchestrator uses dispatch_agent:
  agent: reviewer
  task: "Review routing.ts for security issues"
  mode: read-only, scope: read
```

## Commands

37 commands across 7 categories:

| Category | Commands |
|----------|----------|
| **SESSION** | `/new`, `/compact`, `/fork`, `/tree`, `/session`, `/resume`, `/checkpoint`, `/context`, `/reset` |
| **DISPATCH** | `/runs`, `/batches`, `/stoprun`, `/cost`, `/dispatch-insights` |
| **AGENTS** | `/agents`, `/runtimes`, `/skills` |
| **OBSERVE** | `/audit`, `/doctor`, `/metrics` |
| **SCHEDULE** | `/budget`, `/cluster` |
| **DISPLAY** | `/dashboard`, `/status`, `/models`, `/settings`, `/theme`, `/mode`, `/reasoning`, `/help`, `/exit` |
| **UTILITY** | `/export`, `/copy`, `/login`, `/logout`, `/reload`, `/hotkeys` |

CLI subcommands: `pancode`, `pancode up`, `pancode down`, `pancode login`, `pancode --help`, `pancode --version`.

## Configuration Reference

### agents.yaml

```yaml
agents:
  # Native agent (uses Pi SDK subprocess)
  dev:
    description: "General-purpose coding agent"
    model: ${PANCODE_WORKER_MODEL}
    tools: [read, bash, grep, find, ls, write, edit]
    sampling: coding
    readonly: false
    system_prompt: "You are a skilled software developer."

  # CLI agent (uses installed binary)
  claude-reviewer:
    runtime: cli:claude-code
    description: "Claude Code for deep code review"
    runtime_args: ["--allowedTools", "Read,Grep,Glob"]
    readonly: true
    system_prompt: "Review the code for bugs and security issues."

  # Supported runtime values:
  #   cli:claude-code, cli:codex, cli:gemini,
  #   cli:opencode, cli:cline, cli:copilot-cli
```

### Environment Variables

| Variable | Purpose | Example |
|----------|---------|---------|
| `PANCODE_MODEL` | Orchestrator model override | `ollama/qwen3:8b` |
| `PANCODE_WORKER_MODEL` | Default model for dispatched workers | `lmstudio/gpt-oss-20b` |
| `PANCODE_SCOUT_MODEL` | Model for scout agents | `ollama/granite-4-h-micro` |
| `PANCODE_SAFETY` | Safety level | `suggest`, `auto-edit`, `full-auto` |
| `PANCODE_THEME` | UI theme | `pancode-dark`, `pancode-light` |
| `PANCODE_REASONING` | Enable model reasoning | `on`, `off` |
| `PANCODE_INTELLIGENCE` | Enable intelligence subsystem | `enabled` |
| `PANCODE_LOCAL_MACHINES` | Additional engine discovery targets | `gpu1=10.0.0.5,gpu2=10.0.0.6` |
| `PANCODE_BUDGET_CEILING` | Session budget cap (dollars) | `10.0` |
| `PANCODE_NODE_CONCURRENCY` | Max concurrent workers per node | `4` |

### Safety Rules

Project-level rules in `.pancode/safety-rules.yaml`:

```yaml
rules:
  - type: path
    pattern: "packages/**"
    action: block
    reason: "Vendored SDK is read-only"

  - type: command
    pattern: "rm -rf /"
    action: block

  - type: path
    pattern: "*.env"
    action: block
    agents: ["*"]
```

## Local AI Setup

### LM Studio

```bash
# Start LM Studio on default port 1234
# Load a model (e.g., Qwen 3.5 35B)
# PanCode auto-discovers at localhost:1234

export PANCODE_WORKER_MODEL=lmstudio/qwen3.5-35b-a3b
npm start
```

### Ollama

```bash
# Start Ollama (default port 11434)
ollama serve
ollama pull qwen3:8b

export PANCODE_WORKER_MODEL=ollama/qwen3:8b
npm start
```

### llama.cpp

```bash
# Start llama-server on default port 8080
llama-server -m model.gguf --port 8080

export PANCODE_WORKER_MODEL=llamacpp/model
npm start
```

### Auto-Discovery

PanCode probes three default endpoints at boot:

| Engine | SDK | Default Port |
|--------|-----|-------------|
| LM Studio | `@lmstudio/sdk` | 1234 |
| Ollama | `ollama` (npm) | 11434 |
| llama.cpp | HTTP API | 8080 |

For additional machines, set `PANCODE_LOCAL_MACHINES`:

```bash
export PANCODE_LOCAL_MACHINES="gpu1=192.168.1.10,gpu2=192.168.1.11"
```

Cloud API providers (Anthropic, OpenAI, Google, Mistral, any OpenAI-compatible endpoint) work alongside local engines in the same session.

## Development

### Build Commands

```bash
npm install              # Install dependencies (workspaces)
npm run typecheck        # TypeScript strict check (tsc --noEmit)
npm run check-boundaries # Engine + worker isolation enforcement
npm run build            # Compile to dist/ via tsup
npm run lint             # Biome lint
npm run dev              # Run from source with tsx
```

### Project Structure

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
    runtimes/                         Runtime abstraction layer
      types.ts                        AgentRuntime interface, SpawnConfig, RuntimeResult
      registry.ts                     RuntimeRegistry singleton
      cli-base.ts                     CliRuntime abstract base class, PATH scanner
      pi-runtime.ts                   Native Pi runtime adapter
      discovery.ts                    Boot-time auto-discovery
      adapters/                       CLI runtime adapters
        claude-code.ts                Claude Code (JSON structured output)
        codex.ts                      Codex CLI (JSON output)
        gemini.ts                     Gemini CLI (text parsing)
        opencode.ts                   OpenCode (NDJSON gold-tier)
        cline.ts                      Cline CLI 2.0 (act/plan modes)
        copilot-cli.ts                Copilot CLI (timeout handling)

  core/                               Host infrastructure
    config.ts                         Config loading, profile resolution
    config-validator.ts               TypeBox schema validation
    config-writer.ts                  Atomic writes (temp + fsync + rename)
    domain-loader.ts                  Topological sort and domain loading
    event-bus.ts                      SafeEventBus (error-isolating emitter)
    termination.ts                    Multi-phase shutdown coordinator

  domains/
    safety/          (9 files)        Scope, classifier, enforcement, rules, loop
    session/         (6 files)        Context registry, shared board, memory
    agents/          (5 files)        Spec registry, teams, YAML loading, skills
    dispatch/       (12 files)        Spawn, routing, admission, rules, state, batch
    providers/      (11 files)        LM Studio, Ollama, llama.cpp, cloud, matching
    observability/   (5 files)        Metrics, health, audit trail
    scheduling/      (5 files)        Budget, cluster, resilience
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
```

128 TypeScript source files. Strict mode. ~11,400 LOC.

### Adding a New Runtime Adapter

1. Create `src/engine/runtimes/adapters/your-agent.ts`
2. Implement the `AgentRuntime` interface: `id`, `displayName`, `tier`, `isAvailable()`, `buildSpawnConfig()`, `parseResult()`
3. Extend `CliRuntime` base class for common PATH scanning and process lifecycle
4. Register in `src/engine/runtimes/discovery.ts`
5. Export from `src/engine/runtimes/index.ts`

### Adding a New Domain

1. Create `src/domains/your-domain/manifest.ts` declaring name and dependencies
2. Create `src/domains/your-domain/extension.ts` implementing the Pi SDK `ExtensionFactory` interface
3. Register commands, tools, and event listeners in the extension factory
4. Add to `src/domains/index.ts`
5. The domain loader handles initialization order via topological sort

## Changelog

### v0.2.0 (2026-03-19)

Universal agent control plane release. Runtime abstraction layer with 6 CLI
adapters. Any coding agent installed on the machine becomes a dispatchable worker.

Highlights:
- `AgentRuntime` interface with `buildSpawnConfig`/`parseResult` contract
- Auto-discovery scans PATH at boot for known agent binaries
- 6 CLI adapters: Claude Code, Codex, Gemini CLI, OpenCode, Cline, Copilot CLI
- OpenCode gold-tier adapter with NDJSON token/cost tracking
- Architectural review: 89-file boundary compliance fix
- 13/13 e2e smoke tests, 6/6 integration test scenarios
- `runtime` and `runtime_args` fields in agent YAML specs
- `/runtimes` command with availability status display
- Runtime badges on dispatch board worker cards

### v0.1.0 (2026-03-19)

Foundation release. 8 composable domains, subprocess dispatch, formal safety
model, provider-agnostic local engines.

Highlights:
- 8 domains: safety, agents, dispatch, session, observability, scheduling, intelligence, ui
- Engine boundary at `src/engine/` with build-time enforcement
- Worker isolation (`src/worker/` separate from `src/domains/`)
- Two-layer safety (formal scope model + YAML rules)
- Local inference: LM Studio, Ollama, llama.cpp via native SDKs
- Live dispatch board with worker cards and telemetry
- 5 orchestrator modes, 4 task tools, chain dispatch
- 37 slash commands across 7 categories
- Multi-phase shutdown coordinator
- CI + release GitHub workflows

Full build log: `.claude/prompts/PROGRESS.md`

## License

Apache 2.0

## Author

[Anthony Kougkas](https://github.com/akougkas)
