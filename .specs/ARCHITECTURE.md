# PanCode Extension Architecture Specification

## 1. Approach

This is a clean-room rebuild. The current codebase is about 148 TypeScript
files and ~17,200 LOC across 9 composable domains plus 6 CLI runtime adapters.
The new codebase starts from an empty `src/` directory. No migration, no
backwards compatibility, no import path preservation.

The old codebase proved the concepts but accumulated two god objects (session.ts
at 1,893 lines and tools.ts at 1,612 lines) that defeated three incremental
refactor attempts. A clean start eliminates this failure mode.

Build philosophy: source code focus. No test theater, no docs theater. Minimal
E2E verification where it adds real value. Architectural integrity and design
correctness over coverage metrics.


## 2. Reference Audit

The old codebase's 148 files classified by domain. These are reference lookups
for the rebuild, not migration targets.

### Foundation (always loaded, no ExtensionFactory)

Config loading, provider auth, package infrastructure.

| Reference File | Purpose |
|----------------|---------|
| core/config.ts (1,017 lines) | 6-layer config resolution, profile loading, YAML |
| core/config-validator.ts (198) | TypeBox schema validation with remediation |
| core/config-writer.ts (153) | Crash-safe atomic writes (fsync + rename) |
| core/defaults.ts (436) | Built-in agents, profiles, config, safety rules |
| core/init.ts | Global runtime initialization, dir scaffolding |
| core/install-state.ts | Installation state tracking |
| core/package-root.ts | Package/project root discovery |
| core/settings-state.ts | User preferences persistence |
| core/concurrency.ts (94) | Auto-detect concurrency from CPU/memory |
| core/frontmatter.ts | YAML frontmatter parsing |
| core/startup-timer.ts | Startup phase timing |

### Providers

| Reference File | Purpose |
|----------------|---------|
| core/providers/shared.ts (238) | Auth storage, model registry, PANCODE constants |
| core/providers/api-providers.ts (453) | API provider CRUD, key verification |
| core/providers/local.ts | Local endpoint discovery (LM Studio, Ollama) |
| core/model-profile.ts | Model profiles, routing policy |
| core/models-state.ts | Recent model tracking, favorites |
| extensions/worker-providers.ts (80) | Worker subprocess provider bridge |

### Safety

| Reference File | Purpose |
|----------------|---------|
| extensions/safety.ts (815) | ExtensionFactory: bash audit, path access control |
| core/action-classifier.ts (128) | Tool name to ActionClass mapping |
| core/audit.ts (328) | Structured audit events, secret redaction |
| core/scope.ts (222) | ScopeLevel, AutonomyMode, ActionClass type defs |
| core/safety-decision.ts | Safety tier enforcement |
| core/scope-enforcement.ts | Scope contract validation |
| core/rejection-feedback.ts | Feedback to agent on rejection |
| extensions/loop-detector.ts (105) | Loop detection extension |
| core/doom-loop-detector.ts | Doom loop primitives |

### Agents

| Reference File | Purpose |
|----------------|---------|
| core/agent-recipe.ts (237) | Recipe compilation to immutable AgentSpec |
| core/agent-spec-registry.ts (97) | In-memory registry, hash collision detection |
| core/agent-poml.ts (100) | POML overlay builder from agent definitions |
| core/teams.ts | Team definitions, YAML loading |
| core/chains.ts (60) | Multi-step agent chain definitions |
| core/meta-agent.ts | Meta-level agent reasoning |
| core/jita.ts | JIT agent provisioning |
| core/fleet-parser.ts | Fleet file parsing |
| core/skills.ts | Agent skill definitions |
| core/forge-*.ts (3 files) | Agent registry, history |

### Dispatch

| Reference File | Purpose |
|----------------|---------|
| ext/pancode-core/dispatch-simple.ts (207) | Subprocess spawning via pi CLI |
| ext/pancode-core/dispatch-state.ts (480) | Run envelope, ledger, active runs |
| ext/pancode-core/dispatch-routing.ts (168) | Model/tool resolution for workers |
| ext/pancode-core/dispatch-primitives-init.ts (291) | Lazy init of infrastructure |
| core/dispatch-primitives.ts (447) | Composable operations (parallel, chain, merge) |
| core/dispatch-validation.ts (261) | Output contracts, post-dispatch validation |
| core/backoff.ts (269) | Token buckets, exponential backoff |
| core/batch-tracker.ts (338) | Batch observability, grid cards |
| core/provider-resilience.ts | Circuit breaker for provider health |
| core/termination.ts | Session cleanup, graceful shutdown |
| core/pid-reconciler.ts | Process ID reconciliation |
| core/path-lock.ts | File lock management |
| core/team-dispatch.ts | Multi-agent team dispatch coordination |

### Intelligence (experimental, scaffolded for roadmap)

| Reference File | Purpose |
|----------------|---------|
| core/dispatch/contracts.ts (448) | Intent, DispatchPlan, DispatchStep types |
| core/dispatch/intent-detector.ts (526) | Task type and complexity classification |
| core/dispatch/solver.ts (537) | Dispatch plan generation |
| core/dispatch/speculative.ts (384) | Pre-work before solver (context prep, warming) |
| core/dispatch/reconciler.ts (344) | Merge speculative with authoritative plan |
| core/dispatch/learner.ts (316) | Adaptive learning from dispatch outcomes |
| core/dispatch/adapter.ts (374) | Observer mode for dispatch pipeline |
| core/dispatch/functiongemma.ts (257) | LLM dispatch routing via local model |

### Session

| Reference File | Purpose |
|----------------|---------|
| core/checkpoint.ts (181) | Checkpoint save/load/list |
| core/memory.ts (154) | Three-tier memory (temporal, persistent, shared) |
| core/context-registry.ts (68) | File-backed key-value store for cross-agent state |
| core/compaction.ts (526) | Context compaction for LLM memory survival |
| core/session-replay.ts | Session history replay |
| core/shared-board.ts | Shared team state board |
| ext/pancode-core/worker-context.ts (313) | Worker-scoped context/board/memory tools |

### Observability

| Reference File | Purpose |
|----------------|---------|
| extensions/telemetry.ts (419) | Session lifecycle metrics extension |
| extensions/tool-counter.ts (22) | Per-tool call count tracking |
| core/health-watchdog.ts | Runtime health monitoring |

### Scheduling

| Reference File | Purpose |
|----------------|---------|
| core/budget.ts (242) | Token-native cost accounting |
| core/scheduler.ts | Task queue, drain control |
| core/horizontal-scheduler.ts | Distributed scheduler |
| core/advance-mode.ts (185) | Hybrid drain modes (eager, timed, event) |
| core/cluster.ts (271) | Node registration, heartbeat, capacity |
| core/cluster-transport.ts (103) | HTTP transport for cluster ops |
| core/chronicle.ts (355) | Linear state machine for orchestration |

### UI

| Reference File | Purpose |
|----------------|---------|
| ext/pancode-core/ui.ts (804) | Identity, header/footer, theme, branding |
| ext/pancode-core/renderers.ts (288) | Custom TUI renderers |
| extensions/widget-utils.ts (161) | Widget utilities, WidgetRegistry |
| extensions/tasks.ts (973) | Multi-step task tracking widget |
| ext/pancode-core/commands/ops.ts (313) | Ops commands (agents, skills, approve, etc.) |
| ext/pancode-core/commands/ui.ts (804) | Display commands (status, theme, help, etc.) |
| ext/pancode-core/commands/infra.ts (313) | Infra commands (cluster, forge, scheduler, etc.) |
| ext/pancode-core/commands/runs.ts (313) | Run commands (runs, batches, stoprun, etc.) |

### Other (post-v1.0 domains)

| Reference File | Purpose |
|----------------|---------|
| extensions/interop.ts (310) | Cross-agent command import from .claude/, .gemini/ |
| core/import-manager.ts | Dynamic import resolution |
| learning/*.ts (615 total) | Overlay learning, distillation |
| core/overlay.ts, core/poml*.ts | POML overlay system |
| core/worktree-lifecycle.ts | Git worktree create/cleanup |
| core/merge-gate.ts | Sequential merge ordering |


## 3. Domain Architecture

### Folder Structure

```
src/
  engine/                        # Pi SDK abstraction layer (sole Pi SDK importer)
    index.ts                    # Barrel export
    events.ts                   # Pi SDK event types and helpers
    extensions.ts               # Extension loading helpers
    resources.ts                # Resource loader wrappers
    runtimes/                   # Runtime abstraction layer
      index.ts
      types.ts
      registry.ts
      discovery.ts
      cli-base.ts
      pi-runtime.ts
      adapters/
        claude-code.ts
        codex.ts
        gemini.ts
        opencode.ts
        cline.ts
        copilot-cli.ts
    session.ts                  # Session wrapper
    shadow.ts                   # Shadow scout engine
    shell.ts                    # Shell utilities
    shell-overrides.ts          # Shell overrides
    tools.ts                    # Tool wrappers
    tui.ts                      # TUI components
    types.ts                    # Re-exported SDK types

  core/                         # Foundation: host-environment infrastructure only
    agent-profiles.ts           # Orchestrator/worker/scout class profiles
    bus-events.ts               # Canonical bus channel constants
    concurrency.ts              # Auto-detect concurrency
    config-validator.ts         # Schema validation
    config-writer.ts            # Atomic writes (fsync + rename)
    config.ts                   # Config loading, profile resolution
    defaults.ts                 # Built-in agents, profiles, config, safety rules
    domain-loader.ts            # Topological sort of domain manifests
    event-bus.ts                # SafeEventBus wrapper (error-isolating emitter)
    init.ts                     # Global runtime initialization
    ledger-types.ts             # Shared SessionBoundary type
    modes.ts                    # 5 orchestrator modes with tool gating
    package-root.ts             # Package/project root discovery
    presets.ts                  # Model preset management
    settings-state.ts           # User preferences persistence
    shared-bus.ts               # Cross-domain SafeEventBus singleton
    shell-metadata.ts           # Command registry for /help
    termination.ts              # Multi-phase shutdown coordinator
    thinking.ts                 # Reasoning mode control
    tool-names.ts               # Tool name constants

  domains/
    providers/
      index.ts                  # Public API barrel
      shared.ts                 # Auth storage, model registry, PANCODE constants
      api-providers.ts          # Cloud provider CRUD, key verification
      local.ts                  # Local endpoint discovery (Ollama, LM Studio)
      model-profile.ts          # Model profiles, routing policy

    safety/
      index.ts                  # Public API barrel
      manifest.ts               # { name: "safety", dependsOn: [] }
      extension.ts              # ExtensionFactory: bash audit, path gating, scope enforcement
      scope.ts                  # ScopeLevel, AutonomyMode, ActionClass types
      action-classifier.ts      # Tool name to ActionClass mapping
      audit.ts                  # Structured audit events, secret redaction
      scope-enforcement.ts      # Scope contract validation
      loop-detector.ts          # Loop detection (consecutive errors, repeated calls)

    agents/
      index.ts                  # Public API barrel
      manifest.ts               # { name: "agents", dependsOn: [] }
      extension.ts              # ExtensionFactory: load specs, inject POML overlays
      recipe.ts                 # Recipe compilation to immutable AgentSpec
      spec-registry.ts          # In-memory registry with hash collision detection
      teams.ts                  # Team definitions, YAML loading
      fleet-parser.ts           # Fleet file parsing
      skills.ts                 # Agent skill definitions

    dispatch/
      index.ts                  # Public API barrel
      manifest.ts               # { name: "dispatch", dependsOn: ["safety", "agents"] }
      extension.ts              # ExtensionFactory: dispatch_agent, batch_dispatch tools
      worker-spawn.ts           # Subprocess lifecycle via pi CLI
      state.ts                  # Run envelope, ledger, active runs
      routing.ts                # Model/tool resolution for workers
      primitives.ts             # Composable operations (parallel, chain, merge)
      validation.ts             # Output contracts, post-dispatch checks
      batch-tracker.ts          # Batch observability
      backoff.ts                # Token buckets, exponential backoff
      resilience.ts             # Circuit breaker for provider health

    intelligence/               # Top-level domain: experimental, event-driven
      index.ts                  # Public API barrel
      manifest.ts               # { name: "intelligence", dependsOn: ["dispatch", "agents"] }
      extension.ts              # ExtensionFactory: subscribes to dispatch lifecycle events
      contracts.ts              # Intent, DispatchPlan, DispatchStep types
      intent-detector.ts        # Task classification
      solver.ts                 # Plan generation
      speculative.ts            # Pre-work (context prep, agent warming)
      reconciler.ts             # Merge speculative with authoritative plan
      learner.ts                # Adaptive learning from outcomes
      functiongemma.ts          # LLM dispatch routing via local model

    session/
      index.ts                  # Public API barrel
      manifest.ts               # { name: "session", dependsOn: [] }
      extension.ts              # ExtensionFactory: lifecycle hooks
      context-registry.ts       # File-backed key-value store for cross-agent state (Phase B)
      shared-board.ts           # Shared team state board (Phase B)
      memory.ts                 # Three-tier memory: temporal, persistent, shared (Phase B)

    observability/
      index.ts                  # Public API barrel
      manifest.ts               # { name: "observability", dependsOn: ["dispatch"] }
      extension.ts              # ExtensionFactory: telemetry, tool counting
      telemetry.ts              # Session lifecycle metrics
      health.ts                 # Runtime health monitoring

    scheduling/
      index.ts                  # Public API barrel
      manifest.ts               # { name: "scheduling", dependsOn: ["dispatch", "agents"] }
      extension.ts              # ExtensionFactory: budget tracking, scheduler commands
      budget.ts                 # Token-native cost accounting
      cluster.ts                # Node registration, heartbeat, capacity
      cluster-transport.ts      # HTTP transport for cluster ops

    ui/
      index.ts                  # Public API barrel
      manifest.ts               # { name: "ui", dependsOn: ["dispatch", "agents", "session", "scheduling", "observability"] }
      extension.ts              # ExtensionFactory: branding, header, footer, theme
      renderers.ts              # Pure stateless rendering functions
      widget-utils.ts           # Widget utilities
      tasks.ts                  # Task tracking widget

  worker/                       # Physically isolated from domains/
    entry.ts                    # Worker subprocess entry point
    cli-entry.ts                # CLI worker wrapper
    provider-bridge.ts          # ExtensionAPI for worker model resolution
    safety-ext.ts               # Worker-side safety extension

  cli/                          # CLI commands (tmux-first launcher)
    index.ts                    # Command router
    shared.ts                   # Exit codes, tmux, session utilities
    start.ts                    # pancode tmux launcher
    up.ts                       # pancode up (reattach)
    down.ts                     # pancode down (session stop)
    sessions.ts                 # pancode sessions (list sessions)
    login.ts                    # pancode login (provider auth)
    version.ts                  # pancode version

  entry/
    orchestrator.ts             # Interactive TUI session (composes domain stack)
```

### Key Structural Decisions

**Worker isolation is physical.** `src/worker/` lives outside `src/domains/`.
The worker entry point and provider bridge cannot accidentally import
orchestrator domain logic because they are in a separate directory tree.
A Biome lint override or a simple import check script can enforce that
`src/worker/` never imports from `src/domains/`.

**Commands live in their owning domain.** Each domain's `extension.ts`
registers its own slash commands via `pi.registerCommand()`. The ui domain
does NOT register commands for other domains. This prevents the god-object
coupling where ui imports mutators from every domain.

- dispatch registers: `/runs`, `/batches`, `/stoprun`, `/cost`, `/dispatch-insights`
- scheduling registers: `/budget`, `/cluster`
- agents registers: `/agents`, `/skills`
- session registers: `/checkpoint`, `/context`, `/reset`
- observability registers: `/audit`, `/doctor`
- ui registers: `/status`, `/theme`, `/help`, `/dashboard`, `/exit`

Domain command handlers import pure rendering functions from `ui/renderers.ts`
to format output. This keeps the dependency unidirectional: domains import
from ui (rendering), ui never imports from domains (state).

**Domain logic lives in its domain.** `core/` contains only host-environment
infrastructure: config resolution, file I/O, init sequence, event bus,
domain loader, termination coordinator. Every piece of domain-specific
logic belongs in its domain folder, regardless of whether it uses the Pi SDK.
`scope.ts` lives in `safety/`. `compaction.ts` lives in `session/`.

### What is NOT in the v1.0 folder structure

These get built post-v1.0:

- `domains/worktree/` (lifecycle.ts, merge-gate.ts)
- `domains/interop/` (extension.ts, import-manager.ts)
- `domains/learning/` (overlay.ts, poml-engine.ts, distill.ts, etc.)
- Headless entry point

Advanced features within v1.0 domains that are scaffolded but not activated:
- `domains/intelligence/` (full subsystem, event-driven, disabled by default)
- `scheduling/horizontal.ts`, `scheduling/advance-mode.ts`
- `agents/chains.ts`, `agents/meta-agent.ts`, `agents/jita.ts`, `agents/forge/`


## 4. Dependency Graph

```
Level 0: Foundation (always loaded)
  core/ (config, init, event bus, domain loader, termination)

Level 1: Boot layer (loaded by entry points, not extensions)
  providers (auth storage, model registry)

Level 2: Independent domains (no cross-domain deps)
  ┌──────────┐  ┌──────────┐
  │  safety   │  │ session  │
  └──────────┘  └──────────┘

Level 3: Depends on foundation only
  ┌──────────────────────────────────────────┐
  │              agents                       │
  └──────────────────────────────────────────┘

Level 4: Depends on Level 2 + Level 3
  ┌──────────────────────────────────────────────┐
  │              dispatch                         │
  │  uses: agents (AgentSpec resolution)          │
  │  uses: safety (admission gating)              │
  └──────────────────────────────────────────────┘

Level 5: Depends on Level 4
  ┌──────────────────────────────────────────┐
  │           observability                   │
  │  uses: dispatch (run metrics correlation) │
  └──────────────────────────────────────────┘
  ┌──────────────────────────────────────────┐
  │             scheduling                    │
  │  uses: dispatch (run coordination)        │
  │  uses: agents (agent discovery)           │
  └──────────────────────────────────────────┘

Level 6: Depends on multiple Level 4-5 domains
  ┌──────────────────────────────────────────────┐
  │           intelligence (experimental)         │
  │  subscribes: dispatch lifecycle events        │
  │  reads: agents (fleet state for solver)       │
  └──────────────────────────────────────────────┘
  ┌──────────────────────────────────────────────┐
  │                 ui                            │
  │  reads: dispatch, scheduling, agents, session │
  │  exports: renderers (imported by all domains) │
  └──────────────────────────────────────────────┘
```

### Dependency Matrix

| Domain | Depends On | Depended On By |
|--------|-----------|----------------|
| providers | foundation | all (boot-time) |
| safety | foundation | dispatch |
| session | foundation | ui (read-only) |
| agents | foundation | dispatch, scheduling, intelligence, ui |
| dispatch | safety, agents | observability, scheduling, intelligence, ui |
| observability | dispatch | ui (read-only) |
| scheduling | dispatch, agents | ui (read-only) |
| intelligence | dispatch, agents | (none, event-driven observer) |
| ui | dispatch, agents, session, scheduling, observability | domains import renderers |

### Key Dependency: dispatch depends on agents

The dispatch_agent tool resolves which agent handles a task. This requires
AgentSpec lookup (model, tools, system prompt for the worker). Therefore
dispatch depends on agents. The agents domain must load before dispatch.

team-dispatch (coordinating multi-agent team execution) belongs in dispatch,
not agents. Agents defines team composition. Dispatch executes it. This keeps
the dependency unidirectional.

### Persistence Model: Independent Domain Persistence + Pi SDK Sessions

Each domain that needs state across restarts manages its own file in
`.pancode/`. No centralized checkpoint coordinator, no timing dependencies.

```
dispatch/state.ts    → .pancode/runs.json     (reads on construction, writes on mutation)
observability/metrics.ts → .pancode/metrics.json (reads on construction, writes on record())
scheduling/budget.ts → .pancode/budget.json    (reads on construction, writes on recordCost())
```

The Pi SDK handles conversation state automatically via append-only JSONL
at `~/.pancode/agent-engine/sessions/[cwd-hash]/current.jsonl`. PanCode
extensions can store custom state in the session JSONL via `appendEntry()`
and retrieve it on resume via `getEntries()`.

Worker context tools (`report_context`, `read_context`, `board_write`,
`board_read`, `memory`) will live in `session/` when implemented. The
worker subprocess does NOT load session. Instead, dispatch's
`worker-spawn.ts` passes context data to the worker via CLI args or
environment variables.


## 5. Domain Loading and Initialization

### Declarative Manifests

Every domain exports a manifest declaring its name and dependencies:

```typescript
// domains/dispatch/manifest.ts
export const manifest = {
  name: "dispatch",
  dependsOn: ["safety", "agents"],
} as const;
```

### Topological Sort at Boot

`core/domain-loader.ts` implements Kahn's algorithm (~30 lines) to resolve
extension loading order automatically:

1. Entry point collects all enabled domain manifests
2. Domain loader builds a DAG from the `dependsOn` declarations
3. Topological sort produces the loading order
4. If a cycle is detected, throw a hard error before Pi SDK initializes
5. If a required dependency is missing (disabled in config), throw a hard error

This replaces the hardcoded extension array. Adding a new domain requires
only writing its manifest. The loader resolves where it slots in.

### SafeEventBus

`core/event-bus.ts` wraps the Pi SDK's `createEventBus()` with error isolation.
`core/shared-bus.ts` exports a module-level singleton `sharedBus` that all
domains use for cross-domain events. Domains subscribe in their `session_start`
handler and emit when state changes. The shared bus replaces per-domain bus
instances with a single coordination point.

Standard Node.js EventEmitter executes listeners synchronously. A crashing
listener in one domain would bubble up into the emitting domain's call stack
and crash the orchestrator.

```typescript
export function emitSafe(bus: EventBus, event: string, payload: unknown): void {
  for (const listener of bus.listeners(event)) {
    queueMicrotask(() => {
      try {
        listener(payload);
      } catch (err) {
        console.error(`[pancode:event-bus] Listener crashed on ${event}:`, err);
      }
    });
  }
}
```

Using `queueMicrotask` instead of `setImmediate` keeps execution within the
same microtask queue (predictable ordering) while isolating error propagation.


## 6. Domain Interfaces

### providers (no ExtensionFactory; loaded by entry points at boot)

**Exports:**
- `createSharedAuth()` returns `{ authStorage, modelRegistry }`
- `resolveModel(registry, modelString?)` returns a Pi SDK `Model`
- `registerApiProvidersOnRegistry(registry, cwd)`
- `registerLocalProvidersOnRegistry(registry)`

### safety

**Manifest:** `{ name: "safety", dependsOn: [] }`
**Hooks:** `session_start` (load rules), `tool_call` (evaluate), `before_provider_request` (scope)
**Tools:** None (enforcement only)
**Commands:** None
**Exports:** `classifyAction()`, `AuditTrail`, scope enforcement utilities

### agents

**Manifest:** `{ name: "agents", dependsOn: [] }`
**Hooks:** `session_start` (load agent defs, compile specs), `before_agent_start` (inject POML)
**Tools:** None
**Commands:** `/agents`, `/skills`
**Exports:** `AgentSpecRegistry`, `compileRecipe()`, `loadTeams()`

### dispatch

**Manifest:** `{ name: "dispatch", dependsOn: ["safety", "agents"] }`
**Hooks:** `session_start` (init infrastructure, register checkpoint provider), `tool_execution_end` (update ledger)
**Tools:** `dispatch_agent` (single dispatch), `batch_dispatch` (parallel batch)
**Commands:** `/runs`, `/batches`, `/stoprun`, `/cost`, `/dispatch-insights`
**Exports:** `dispatchWorker()`, `RunEnvelope`, `RunStatus`, `BatchTracker`, run ledger accessors
**Emits:** `pancode:run-started`, `pancode:run-finished` (unified event with status field, via sharedBus)

### intelligence (experimental, event-driven)

**Manifest:** `{ name: "intelligence", dependsOn: ["dispatch", "agents"] }`
**Hooks:** `session_start` (subscribe to dispatch lifecycle events if enabled)
**Tools:** None (intelligence acts on dispatch events, not user commands)
**Commands:** None
**Subscribes to:** `pancode:run-finished` (unified event with status field, via sharedBus)

When disabled (default), the extension registers no listeners. Zero runtime cost.
Intelligence subscribes to sharedBus events when enabled. It does not import
from dispatch or read checkpoint state. All input arrives via event payloads.

Dispatch never imports from intelligence. Intelligence subscribes to dispatch
events and calls dispatch's public API. The dependency is strictly one-directional.

### session

**Manifest:** `{ name: "session", dependsOn: [] }`
**Hooks:** `session_start` (lifecycle logging), `session_shutdown` (cleanup)
**Tools:** `report_context`, `read_context`, `board_write`, `board_read`, `memory` (Phase B)
**Commands:** `/checkpoint` (Phase B), `/context` (Phase B), `/reset` (Phase B)
**Exports:** Session lifecycle utilities

Session is thin in v1.0. Conversation state persistence is handled by Pi SDK
(automatic JSONL). Domain operational state is handled by each domain independently.
Session tools and commands are Phase B additions for cross-agent coordination.

### observability

**Manifest:** `{ name: "observability", dependsOn: ["dispatch"] }`
**Hooks:** `session_start` (init), all tool/message events (capture metrics), `agent_end` (report)
**Tools:** None
**Commands:** `/audit`, `/doctor`
**Exports:** Telemetry summary accessors

### scheduling

**Manifest:** `{ name: "scheduling", dependsOn: ["dispatch", "agents"] }`
**Hooks:** `session_start` (init budget, register node), `agent_end` (drain, summarize)
**Tools:** None
**Commands:** `/budget`, `/cluster`
**Exports:** `BudgetTracker`, `ClusterRegistry`

### ui

**Manifest:** `{ name: "ui", dependsOn: ["dispatch", "agents", "session", "scheduling", "observability"] }`
**Hooks:** `session_start` (theme, header, widgets), `before_agent_start` (identity XML),
`tool_execution_end` (update board), `message_update` (context usage)
**Tools:** None
**Commands:** `/status`, `/theme`, `/help`, `/dashboard`, `/exit`
**Exports:** Pure rendering functions (`renderRunBoard()`, `renderAgentList()`, etc.)

UI does NOT register commands for other domains. Each domain registers its own
commands and imports rendering functions from `ui/renderers.ts`. This keeps
the dependency unidirectional: domains depend on ui for rendering, ui depends
on domains for state reads. No domain mutates another domain's state through
ui command handlers.


## 7. State Ownership Model

Each piece of shared state has exactly one owner. Other domains get read-only
access through the owner's public API. No domain mutates another domain's state.

| State | Owner | Readers |
|-------|-------|---------|
| Run ledger (active + historical) | dispatch | ui, observability, scheduling (via sharedBus events) |
| Pre-flight check registry | dispatch | scheduling registers checks, dispatch runs them |
| Agent spec registry | agents | dispatch, ui (via barrel imports) |
| Budget counters | scheduling | ui (via barrel import) |
| Telemetry metrics | observability | ui (via barrel import) |
| Session lifecycle | session | ui |
| Theme/branding state | ui | (internal only) |
| Cluster node registry | scheduling | (internal only, no UI reader yet) |

**Event-driven notifications:** When state changes and multiple readers need
updates, the owner emits via SafeEventBus. Example: dispatch emits
`pancode:run-finished` when a run finishes. Observability updates metrics,
scheduling adjusts budgets, ui refreshes the run board. Each listener
is error-isolated by SafeEventBus.

**Independent persistence:** Each domain that needs state across restarts
manages its own file in `.pancode/`. Domains read on construction and write
on mutation. No centralized checkpoint coordinator. The Pi SDK handles
conversation state persistence automatically via append-only session JSONL.


## 8. Multi-Phase Shutdown Sequence

The Pi SDK's `session_shutdown` hook is insufficient for safe shutdown because
hook firing order does not guarantee that dispatch terminates workers before
session writes the checkpoint.

`core/termination.ts` intercepts SIGTERM and coordinates a strict sequence:

```
Phase 1: DRAIN
  Stop accepting new dispatch tasks. Mark orchestrator as draining.
  Emit pancode:shutdown-draining via SafeEventBus.

Phase 2: TERMINATE
  dispatch sends SIGTERM to all active child processes.
  Await their exit with a 3-second timeout per process.
  Force SIGKILL any process that does not exit within timeout.
  Update run ledger: all active runs marked "interrupted".
  Emit pancode:shutdown-workers-terminated.

Phase 3: PERSIST
  session iterates all registered checkpoint providers.
  Each provider serializes its current state (dispatch ledger is now clean).
  session writes the checkpoint to disk via atomic write.
  Emit pancode:shutdown-persisted.

Phase 4: EXIT
  ui tears down TUI.
  process.exit(0).
```

This prevents checkpoint corruption from ghost processes. On resume,
session restores the checkpoint. Dispatch sees interrupted runs in the
ledger and can offer recovery options.


## 9. Engine Abstraction Layer

### Problem

PanCode depends on `@pancode/pi-coding-agent` and `@pancode/pi-tui`.
The Pi SDK is pre-1.0. In semver for 0.x releases, minor version bumps (0.58 to 0.59)
can contain breaking changes. If 10 domains import directly from the SDK and Pi ships
a breaking change, all 10 domains break simultaneously with no containment.

### Solution: src/engine/

`src/engine/` is the sole import boundary for all Pi SDK packages. No file outside
`src/engine/` may import from `@pancode/pi-coding-agent`, `@pancode/pi-ai`,
or `@pancode/pi-tui` directly. All domains import Pi types and functions through
`src/engine/` re-exports.

```
src/engine/
  types.ts        # Re-exports: ExtensionFactory, ExtensionContext, AgentSession,
                  #   AgentToolResult, AgentToolUpdateCallback, SessionStartEvent,
                  #   ToolCallEvent, Model, Api, TextContent, etc.
  session.ts      # Wraps: createAgentSession(), InteractiveMode
  tools.ts        # Wraps: registerTool() helper, tool parameter schemas
  extensions.ts   # Wraps: ExtensionFactory creation, hook registration patterns
  resources.ts    # Wraps: DefaultResourceLoader, SessionManager, SettingsManager
  tui.ts          # Wraps: Theme, ThemeColor, Box, Text, Container, DynamicBorder,
                  #   truncateToWidth, visibleWidth, OverlayHandle, etc.
```

### What the engine layer does

**Re-export stable types.** For types that PanCode uses as-is (ExtensionFactory,
Theme, Model), `engine/types.ts` re-exports them. If Pi renames a type in 0.59.0,
the fix is one line in `engine/types.ts`, not ten files across ten domains.

**Wrap unstable APIs.** For SDK functions whose signatures might change
(createAgentSession, registerTool), `engine/` wraps them in PanCode-stable
functions. If Pi changes the parameter shape, the wrapper adapts.

**Isolate TUI imports.** Pi-tui components (Box, Text, Container) change
more frequently than the core SDK. Isolating them in `engine/tui.ts` means
UI rendering changes stay contained.

### What the engine layer does NOT do

It is not an abstraction over the Pi SDK's concepts. PanCode uses Pi's extension
model directly (ExtensionFactory, hooks, tools, commands). The engine layer is a
thin re-export and adaptation boundary, not a new abstraction.

It does not wrap every Pi SDK function. Only the functions and types that PanCode
actually imports get re-exported. If PanCode uses 30 of Pi's 200 exports, the
engine layer has 30 re-exports.

### Gated Upgrade Strategy

Pi SDK packages are workspace dependencies in package.json:

```json
"@pancode/pi-coding-agent": "*"
```

Workspace changes are picked up by the build. Any external SDK version bump
still requires an explicit upgrade decision and validation pass.

**Upgrade protocol for minor releases:**

1. Read the Pi SDK changelog for breaking changes
2. Create a branch: `upgrade/pi-0.59`
3. Update the workspace dependency or package mapping as needed
4. Fix all breakage in `src/engine/` only (adapt wrappers, update re-exports)
5. Verify no domain file changed (if a domain file must change, the engine
   layer missed an abstraction point; fix the layer, not the domain)
6. Run typecheck + lint
7. Merge when green

If a Pi minor release changes something fundamental (new extension model,
different hook lifecycle), the engine layer absorbs the adaptation cost.
Domain code stays stable.

### Import enforcement

A lint rule or build-time check enforces that no file outside `src/engine/`
imports from `@pancode/*`:

```typescript
// build-time check in scripts/build.mjs or a Biome rule:
// Files matching src/domains/**, src/core/**, src/cli/**, src/worker/**
// must NOT contain: from "@pancode/pi-coding-agent"
// must NOT contain: from "@pancode/pi-ai"
// must NOT contain: from "@pancode/pi-tui"
// Only src/engine/** may import from these packages.
```

This is enforced at build time, not by convention.


## 10. Worker Subprocess Safety

### Isolation Invariant

Workers cannot spawn children. This is enforced structurally:
- `src/worker/` lives outside `src/domains/` (physical separation)
- Worker entry point loads only the provider bridge and safety extension
- Worker entry point does NOT load dispatch, agents, or any orchestrator domain
- Provider bridge (`src/worker/provider-bridge.ts`) reads providers.yaml to
  register PanCode-managed models. It has zero imports from `src/domains/`

### Stdout JSON Parsing

Workers communicate via `pi --mode json` on stdout. Pi SDK outputs one JSON
event per line. If a provider or tool dumps non-JSON text to stdout (warnings,
debug output), the parser must handle it gracefully:

```typescript
for (const line of chunk.toString().split("\n")) {
  const trimmed = line.trim();
  if (!trimmed || !trimmed.startsWith("{")) continue; // skip non-JSON lines
  try {
    const event = JSON.parse(trimmed);
    handleEvent(event);
  } catch {
    // Non-JSON line from subprocess, skip silently
  }
}
```

### Orphan Prevention

If the orchestrator is killed with SIGKILL (unrecoverable), child processes
detach and run indefinitely. Workers must monitor parent liveness:

```typescript
// In worker entry, after boot:
const parentPid = parseInt(process.env.PANCODE_PARENT_PID ?? "", 10);
if (parentPid) {
  const heartbeat = setInterval(() => {
    try { process.kill(parentPid, 0); } // signal 0 checks existence
    catch { clearInterval(heartbeat); process.exit(1); }
  }, 5000);
  heartbeat.unref(); // don't block process exit
}
```

The orchestrator passes its PID via `PANCODE_PARENT_PID` environment variable
when spawning workers.


## 11. Composition Stacks

### Orchestrator (interactive TUI session, v1.0)

```
Foundation + Providers (boot)
  + safety       (Level 2)
  + session      (Level 2)
  + agents       (Level 3)
  + dispatch     (Level 4)
  + observability (Level 5)
  + scheduling   (Level 5)
  + intelligence (Level 6, disabled by default)
  + ui           (Level 6)
```

Loading order is resolved automatically by the domain loader's topological
sort of domain manifests. The entry point provides the list of enabled
domains; the loader determines the order.

### Worker (subprocess leaf executor, v1.0)

```
Foundation + Providers (via worker/provider-bridge.ts)
  + safety
```

No dispatch tools. No agents. No UI. Structurally cannot spawn children.

### Headless (post-v1.0)

```
Foundation + Providers (boot)
  + safety
  + agents
  + dispatch
  + observability
```


## 12. Clean-Room Build Plan

### Phase A: Foundation (COMPLETE)

Subprocess IPC, engine boundary, domain infrastructure, Pi SDK vendoring.

- core/ (config, defaults, init, domain-loader, event-bus, shared-bus, termination,
  concurrency, package-root, shell-metadata, thinking, settings-state)
- engine/ (types, session, tools, extensions, resources, tui, shell, shell-overrides)
- domains/providers/ (engines/, discovery, model-matcher, registry, shared, api-providers)
- domains/safety/ (extension, scope, action-classifier, audit)
- domains/agents/ (extension, spec-registry, teams)
- domains/dispatch/ (extension, worker-spawn, state, routing, primitives, batch-tracker, isolation, rules)
- domains/session/ (extension, manifest)
- domains/observability/ (extension, metrics, health)
- domains/scheduling/ (extension, budget, cluster)
- domains/intelligence/ (extension, contracts, intent-detector, solver, learner, rules-upgrade)
- domains/ui/ (extension, renderers, tasks, widget-utils)
- worker/ (entry, provider-bridge)
- entry/orchestrator.ts (6-phase bootstrap)
- cli/ (index, shared, up, down, login, version)
- models/ (qwen35-a3b.yaml knowledge base)

**Phase A is complete.** TUI boots, local models respond, dispatch works,
batch dispatch works, all 9 domains load, provider discovery via native
SDKs, YAML-driven agents, model knowledge base matching.

### Phase B: Session Coordination and Dispatch Depth

Goal: cross-agent coordination, dispatch primitives, worker safety hardening.

- session/ additions: context-registry, shared-board, memory tiers
- session/ tools: report_context, read_context, board_write, board_read
- session/ commands: /checkpoint, /context, /reset
- dispatch/ additions: validation.ts (output contracts), backoff.ts, resilience.ts
- dispatch/ primitives: chains with $INPUT/$ORIGINAL substitution
- dispatch/ commands: /stoprun, /cost, /dispatch-insights
- safety/ additions: scope-enforcement.ts, loop-detector.ts
- worker/ safety: load safety extension in worker subprocess
- agents/ additions: skills.ts, /skills command
- scheduling/ additions: cluster-transport.ts, /cluster command
- observability/ additions: telemetry.ts, /audit, /doctor commands

**Phase B is complete when:** Workers coordinate via shared context,
dispatch chains execute multi-step workflows, output contracts validate
worker results, and worker-side safety enforcement is active.

### Phase C: Intelligence and Advanced Features

- intelligence/ full: speculative.ts, reconciler.ts, functiongemma.ts
- intelligence/ wiring: subscribe to dispatch events, solver integration
- agents/ advanced: recipe.ts (full compilation), fleet-parser.ts
- cli/ surface: start.ts, up.ts, down.ts, sessions.ts, login.ts, version.ts
- core/ additions: none

**Phase C is complete when:** Intelligence subsystem compiles and can be
enabled via config. Full CLI surface available.

### Phase D: Post-v1.0

- domains/worktree/ (full lifecycle management, merge-gate)
- domains/interop/ (cross-agent command import)
- domains/learning/ (overlay learning, distillation)
- entry/headless.ts
- scheduling/ horizontal scheduler, advance-mode
- agents/ chains, meta-agent, jita, forge
- A2A / ACP integration


## 13. Locked Decisions

These are architectural decisions confirmed by the founder. They are not
open for debate or re-evaluation during the rebuild.

1. **Subprocess dispatch is final.** Workers are isolated pi subprocesses via
   child_process.spawn. No in-process dispatch via createAgentSession().
   Locked for all versions.

2. **Clean-room rebuild.** No migration. Old files are reference in __NUKED/.

3. **Intelligence subsystem is the roadmap.** Must be scaffolded, typed, and
   architecturally wired from day one. Ships as experimental in v1.0.

4. **Source code focus.** No test theater. No docs theater. Minimal E2E only.

5. **Session continuity is v1.0.** Checkpoint, resume, and context persistence
   across sessions must work before v1.0 ships.

6. **Headless mode is post-v1.0.**

7. **Worktree isolation scaffolded in v1.0, full lifecycle management post-v1.0.**

8. **v1.0 scope: subprocess + SSH.** Container and cloud transport are post-v1.0.

9. **Pure open source.** Apache 2.0. No monetization.

10. **Quality bar: 48h dogfood.** Zero crashes, zero hangs, zero orphaned
    processes, zero memory leaks, consistent behavior across sessions.


## 14. Correctness Criteria

The architecture is correct when:

1. Each domain can be imported independently (no circular imports between domains)
2. Worker entry point loads only providers + safety (no dispatch, no agents, no ui)
3. Domain loader's topological sort produces a valid extension loading order
4. Adding a new domain requires: create folder with manifest.ts, add to entry point's enabled list
5. Removing a domain requires: remove from enabled list, no other code changes
6. dispatch_agent tool spawns a worker, captures output, returns result
7. Session checkpoint persists on shutdown and restores on next session start
8. Multi-phase shutdown terminates all workers before checkpointing
9. Intelligence subsystem compiles and wires without runtime activation when disabled
10. No file outside `src/engine/` imports from `@pancode/*` (enforced at build time)
11. Pi SDK minor version upgrade changes only `src/engine/` files, no domain files
12. No domain mutates another domain's state (state ownership invariant)
13. A crashing event listener does not propagate to the emitting domain (SafeEventBus invariant)
14. Typecheck and lint gates pass (npm run typecheck, npm run lint)
15. `pancode up` boots, dispatches, displays result, and survives 48h without drift


## 15. Dispatch Architecture (IP Inventory and Coordination)

### Dispatch Primitives (Tiered by v1.0 Scope)

#### Tier 1: Foundation (v1.0)

**Context Injection.** Worker system prompts constructed in layers: agent identity,
capabilities, task context, constraints. Density adapts to model capability.

**Shared Board.** Namespaced key-value store for fast orchestrator-worker IPC.
Last-write-wins merge, TTL support, subscription callbacks.

**Context Registry.** File-based JSON registry. Agents report structured findings
via `report_context(key, value)`. Orchestrator reads via `read_context()`.
Per-source tracking, atomic writes, crash-safe.

**Output Contracts.** Optional post-dispatch validation: expectedFiles,
expectedPatterns, validationCommand. Per-check pass/fail summary.

**Dispatch Chains.** Sequential pipeline with `$INPUT`/`$ORIGINAL` substitution.
Stops at first failure. Duration tracking per step.

**Scope Enforcement.** Worker permissions cannot exceed orchestrator permissions.
Levels: read < suggest < write < admin. Hard subset rule at dispatch admission.

#### Tier 2: Operational Depth (post-v1.0)

Review-gated chains (reviewer → rework loop). Budget admission gating
(per-run token limits, alert thresholds). Error classification and retry
heuristics. Worktree merge gate (sequential deterministic merge).

#### Tier 3: Advanced (roadmap)

Horizontal scheduling (multi-node placement). Team topologies
(leader-workers, reviewer-gate). Capability routing (task type → model →
agent). Meta-agent pattern. Durability modes (ephemeral, standard, daemon).
A2A / ACP integration.

### Coordination Architecture

**Layer 1: In-Memory Shared Board (Fast IPC)**
For exploration tasks, quick edits, lightweight coordination. Process-scoped.

**Layer 2: File-Based Runtime State (Structured, Debuggable)**
`.pancode/runtime/` with structured JSON/YAML. Run ledger, context registry,
agent assignments. Crash-recoverable, inspectable.

**Layer 3: Context Injection (Worker Configuration)**
Mandatory for all dispatch types. System prompt from agent spec + accumulated
context + task. Density adapts to worker model capability.

### Data Models

```typescript
interface AgentSpec {
  name: string;
  description: string;
  model: string | null;
  tools: string;
  systemPrompt: string;
  sampling: string | null;
  readonly: boolean;
  runtime: string;         // "pi" | "cli:claude-code" | "cli:opencode" | ...
  runtimeArgs: string[];
}

interface ContextEntry {
  key: string;
  value: string;
  source: string;
  timestamp: string;
}

interface OutputContract {
  expectedFiles?: string[];
  expectedPatterns?: string[];
  validationCommand?: string;
  timeoutMs?: number;
}

interface ChainStep {
  task: string;
  agent?: string;
  outputContract?: OutputContract;
}
```
