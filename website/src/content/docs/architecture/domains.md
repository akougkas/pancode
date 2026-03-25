---
title: "Domains"
description: "Composable domain system architecture"
---

:::caution[Experimental Preview]
This is an experimental preview release. APIs, commands, and features may change without notice.
:::


PanCode is composed of 10 domains, each responsible for a specific concern.
Every domain declares its dependencies in a `manifest.ts` file. At boot, the
domain loader performs a topological sort to determine loading order
automatically. This document covers all 10 domains, their manifests, their
responsibilities, and the dependency graph.

## Domain Structure

Each domain follows a consistent pattern:

```
src/domains/<name>/
  manifest.ts      # Name + dependency declaration
  extension.ts     # Pi SDK ExtensionFactory (hooks, tools, commands)
  index.ts         # Public API barrel export
  *.ts             # Domain-specific implementation files
```

The `manifest.ts` declares the domain name and its dependencies:

```typescript
import type { DomainManifest } from "../../core/domain-loader";

export const manifest = {
  name: "dispatch",
  dependsOn: ["safety", "agents", "prompts"],
} as const satisfies DomainManifest;
```

The `extension.ts` exports an `ExtensionFactory` that the Pi SDK calls during
session initialization. Extensions register event hooks, tools, and slash
commands.

The `index.ts` barrel export controls what other domains can import. Domain
internals are not accessible outside the barrel.

## Domain Registry

All 10 domains are registered in `src/domains/index.ts`:

```typescript
export const DOMAIN_REGISTRY = {
  safety:        { manifest: safetyManifest,        extension: safetyExtension },
  session:       { manifest: sessionManifest,       extension: sessionExtension },
  agents:        { manifest: agentsManifest,        extension: agentsExtension },
  prompts:       { manifest: promptsManifest,       extension: promptsExtension },
  dispatch:      { manifest: dispatchManifest,      extension: dispatchExtension },
  observability: { manifest: observabilityManifest, extension: observabilityExtension },
  scheduling:    { manifest: schedulingManifest,     extension: schedulingExtension },
  intelligence:  { manifest: intelligenceManifest,  extension: intelligenceExtension },
  panconfigure:  { manifest: panconfigureManifest,  extension: panconfigureExtension },
  ui:            { manifest: uiManifest,            extension: uiExtension },
} satisfies DomainRegistry;
```

The default enabled domains are defined in `src/core/defaults.ts`:

```typescript
export const DEFAULT_ENABLED_DOMAINS = [
  "safety", "session", "agents", "prompts",
  "dispatch", "observability", "scheduling",
  "panconfigure", "ui",
] as const;
```

Note that `intelligence` is not enabled by default. It activates only when
`PANCODE_INTELLIGENCE=enabled` is set.

## Topological Loading Order

The domain loader in `src/core/domain-loader.ts` implements Kahn's algorithm
to resolve loading order from manifest dependencies. The algorithm:

1. Collects all enabled domain manifests
2. Builds a directed acyclic graph from `dependsOn` declarations
3. Produces a topological ordering where every domain loads after its dependencies
4. Throws a hard error on cycles or missing dependencies

With the default enabled domains, the resolved loading order is:

```
Level 0 (no dependencies):
  safety, session, prompts

Level 1 (depends on Level 0):
  agents (depends on: none, but ordered after session by registry order)

Level 2 (depends on Level 0 + Level 1):
  dispatch (depends on: safety, agents, prompts)

Level 3 (depends on Level 2):
  observability (depends on: dispatch)
  scheduling (depends on: dispatch, agents)

Level 4 (depends on Level 3):
  panconfigure (depends on: scheduling)
  ui (depends on: dispatch, agents, session, scheduling, observability)
```

## Domain Reference

### safety

**Manifest**: `{ name: "safety", dependsOn: [] }`

The safety domain enforces the behavioral policy for tool calls. It classifies
every tool invocation into an action class (file_read, file_write, bash_exec,
git_push, etc.) and checks it against the current autonomy mode (suggest,
auto-edit, full-auto).

**Event hooks:**
- `session_start`: loads autonomy mode from config, loads YAML safety rules
- `tool_call`: classifies the action, enforces the policy matrix, blocks
  disallowed actions with an explanation message

**Key files:**
- `action-classifier.ts`: maps tool names to action classes, detects destructive
  bash patterns
- `scope.ts`: defines `AutonomyMode`, `ActionClass`, and the policy matrix
- `scope-enforcement.ts`: validates that worker permissions do not exceed
  orchestrator permissions (privilege non-escalation)
- `audit.ts`: structured audit trail with timestamps and reason codes
- `loop-detector.ts`: detects consecutive errors and repeated tool calls
- `yaml-rules.ts`: loads project-specific safety rules from YAML config

**Commands:** none (enforcement only)

**Tools:** none

---

### session

**Manifest**: `{ name: "session", dependsOn: [] }`

The session domain manages lifecycle coordination, context sharing between
agents, and session persistence.

**Event hooks:**
- `session_start`: initializes context registry, shared board, session memory
- `session_shutdown`: cleanup and state persistence

**Key files:**
- `context-registry.ts`: file-backed key-value store for cross-agent state.
  Agents write findings via `report_context(key, value)` and read via
  `read_context()`.
- `shared-board.ts`: namespaced coordination board for fast orchestrator-worker
  IPC. Last-write-wins merge with TTL support.
- `memory.ts`: three-tier memory system (temporal, persistent, shared)

**Commands:** `/session`, `/checkpoint`, `/context`, `/reset`

**Tools:** none (worker-side coordination tools are loaded via the safety extension)

---

### agents

**Manifest**: `{ name: "agents", dependsOn: [] }`

The agents domain discovers runtimes, loads agent definitions from
`~/.pancode/panagents.yaml`, and maintains the worker pool registry.

**Event hooks:**
- `session_start`: discovers available runtimes via PATH scanning, loads agent
  YAML, materializes agent specs, builds the worker pool

**Key files:**
- `spec-registry.ts`: in-memory registry of compiled `AgentSpec` objects with
  hash collision detection
- `teams.ts`: team definitions for multi-agent coordination
- `skills.ts`: agent skill definitions and validation
- `worker-pool.ts`: tracks active and available workers
- `shadow-explore.ts`: implements the `shadow_explore` internal tool for
  lightweight codebase exploration

**Commands:** `/agents` (list and manage agents), `/runtimes` (list discovered
runtimes), `/workers` (show worker pool state), `/skills` (list, show, validate
agent skills)

**Tools:** `shadow_explore` (internal, dispatches scout agents for exploration)

---

### prompts

**Manifest**: `{ name: "prompts", dependsOn: [] }`

The prompts domain compiles system prompts for the orchestrator, workers, and
scouts. It uses a fragment-based architecture where prompt pieces are included
or excluded based on the current mode, tier, and context.

**Key files:**
- `compiler.ts`: core prompt compilation engine
- `orchestrator-compiler.ts`: builds the orchestrator's system prompt
- `worker-compiler.ts`: builds worker system prompts
- `fragments.ts`: prompt fragment definitions
- `tiering.ts`: model capability tiers that control prompt density
- `types.ts`: prompt compilation types
- `versioning.ts`: tracks prompt compilation history for debugging
- `pi-compat.ts`: Pi SDK compatibility layer for prompt format

**Commands:** `/prompt-debug` (show last compiled prompt breakdown),
`/prompt-version` (show compilation history), `/prompt-workers` (show recent
worker compilations)

**Tools:** none

---

### dispatch

**Manifest**: `{ name: "dispatch", dependsOn: ["safety", "agents", "prompts"] }`

The dispatch domain is the core of PanCode's orchestration capability. It
provides the tools that the orchestrator LLM calls to spawn worker agents,
manages the run lifecycle, and tracks results.

**Event hooks:**
- `session_start`: initializes run state, registers cleanup, loads run history
- `tool_execution_end`: updates the run ledger after tool completions

**Key files:**
- `worker-spawn.ts`: subprocess lifecycle management via `child_process.spawn`.
  Handles Pi native and CLI agent runtimes.
- `state.ts`: run envelope and run ledger. Tracks active, completed, and
  interrupted runs.
- `routing.ts`: resolves model, tools, and sampling config for workers
- `primitives.ts`: composable dispatch operations (single, batch, chain)
- `batch-tracker.ts`: tracks batch dispatch progress and results
- `admission.ts`: pre-flight check registry. Budget, safety, and custom gates
  run in sequence before dispatch.
- `validation.ts`: output contract validation (expected files, patterns,
  validation commands)
- `isolation.ts`: worktree isolation for concurrent worker filesystem access
- `backoff.ts`: token bucket rate limiting and exponential backoff
- `resilience.ts`: circuit breaker for provider health
- `rules.ts`: dispatch rules and constraints
- `health.ts`: worker health monitoring (heartbeat-based)
- `task-tools.ts`: task board tools (task_write, task_check, task_update, task_list)

**Commands:** `/cost` (show session cost), `/runs` (list runs), `/batches`
(list batch dispatches), `/stoprun` (cancel a running dispatch)

**Tools:** `dispatch_agent` (single dispatch), `batch_dispatch` (parallel
dispatch), `dispatch_chain` (sequential pipeline), `stoprun` (cancel a running
worker), `task_write`, `task_check`, `task_update`, `task_list`

**Emits:** `pancode:run-started`, `pancode:run-finished` via SharedBus

---

### observability

**Manifest**: `{ name: "observability", dependsOn: ["dispatch"] }`

The observability domain collects metrics, maintains the dispatch ledger,
records audit events, and generates receipts for completed runs.

**Event hooks:**
- `session_start`: initializes MetricsLedger, DispatchLedger, AuditTrail,
  ReceiptWriter. Subscribes to SharedBus events.

**Key files:**
- `dispatch-ledger.ts`: persistent ledger of all dispatch runs with filtering
  and aggregation
- `metrics.ts`: session metrics (total cost, tokens, runs, tool calls)
- `telemetry.ts`: session lifecycle telemetry and performance tracking
- `receipts.ts`: generates human-readable receipts for completed runs
- `health.ts`: runtime health monitoring and diagnostics

**Bus subscriptions:**
- `pancode:run-finished`: records metrics, updates ledger
- `pancode:worker-progress`: tracks live progress
- `pancode:warning`: records warnings
- `pancode:session-reset`: clears session-scoped metrics
- `pancode:compaction-started`: notes context compaction
- `pancode:budget-updated`: tracks budget state

**Commands:** `/metrics` (show session metrics), `/audit` (show audit trail),
`/doctor` (run system diagnostics), `/receipt` (show run receipts)

**Tools:** none

---

### scheduling

**Manifest**: `{ name: "scheduling", dependsOn: ["dispatch", "agents"] }`

The scheduling domain manages cost budgets, tracks per-session spending, and
provides cluster coordination for multi-node deployments.

**Event hooks:**
- `session_start`: initializes BudgetTracker, registers budget admission gate
  with dispatch, subscribes to `pancode:run-finished` for cost tracking

**Key files:**
- `budget.ts`: token-native cost accounting with per-session and cumulative
  tracking. Supports configurable ceiling with alerts.
- `cluster.ts`: node registration, heartbeat, and capacity tracking for
  multi-node deployments
- `cluster-transport.ts`: HTTP transport for cluster operations

**Commands:** `/budget` (show budget state and adjust ceiling)

**Tools:** none

---

### intelligence

**Manifest**: `{ name: "intelligence", dependsOn: ["dispatch", "agents"] }`

The intelligence domain is an experimental subsystem for adaptive dispatch
planning. It is disabled by default and activates only when
`PANCODE_INTELLIGENCE=enabled` is set.

**Event hooks (when enabled):**
- `session_start`: enables the rules upgrade system
- `tool_execution_end`: observes dispatch tool completions for learning

**Key files:**
- `contracts.ts`: Intent, DispatchPlan, DispatchStep type definitions
- `intent-detector.ts`: task type and complexity classification
- `solver.ts`: dispatch plan generation from task analysis
- `learner.ts`: adaptive learning from dispatch outcomes
- `rules-upgrade.ts`: runtime rules improvement system

When disabled, the extension registers no listeners and has zero runtime cost.

**Commands:** none

**Tools:** none

---

### panconfigure

**Manifest**: `{ name: "panconfigure", dependsOn: ["scheduling"] }`

The panconfigure domain provides runtime configuration management through
tools that the orchestrator LLM can call.

**Key files:**
- `config-schema.ts`: parameter schema definitions with types, defaults,
  descriptions, and domain grouping
- `config-service.ts`: parameter registry, read/apply logic, validation

**Commands:** none (configuration is done through tools)

**Tools:** `pan_read_config` (read configuration parameters, filterable by
domain), `pan_apply_config` (apply a configuration change with validation,
admin-only params require Admin mode)

---

### ui

**Manifest**: `{ name: "ui", dependsOn: ["dispatch", "agents", "session", "scheduling", "observability"] }`

The ui domain is the TUI presentation layer. It has the most dependencies
because it reads state from multiple domains to present a unified interface.
The ui domain does NOT register commands for other domains. Each domain
registers its own commands.

**Event hooks:**
- `session_start`: initializes theme, editor, keyboard shortcuts
- `before_agent_start`: compiles the orchestrator prompt
- `context`: filters panel messages from LLM context

**Key files:**
- `dashboard-layout.ts`, `dashboard-state.ts`, `dashboard-widgets.ts`:
  dashboard view with live worker status
- `footer-renderer.ts`: status bar with mode, safety, model, and metrics
- `view-router.ts`: routes between dashboard and conversation views
- `renderers.ts`: pure stateless rendering functions (imported by other domains)
- `tasks.ts`: task tracking widget
- `panel-renderer.ts`: renders panel messages
- `commands.ts`: UI-specific command implementations
- `context-tracker.ts`: tracks context window usage

**Bus subscriptions:**
- `pancode:warning`: displays warnings
- `pancode:config-changed`: reflects configuration changes
- `pancode:run-started`, `pancode:run-finished`: updates worker display
- `pancode:worker-progress`, `pancode:worker-heartbeat`: live progress
- `pancode:worker-health-changed`: health status updates
- `pancode:budget-updated`: budget display

**Keyboard shortcuts:**
- `Shift+Tab`: cycle through plan, build, review modes
- `Ctrl+Y`: cycle safety level (suggest, auto-edit, full-auto)
- `Alt+A`: toggle Admin (God) mode

**Commands:** `/dashboard`, `/theme`, `/models`, `/settings`, `/reasoning`,
`/modes`, `/help`, `/preset`, `/perf`, `/safety`, `/exit`, `/hotkeys`

**Tools:** none

## Dependency Graph

```
Level 0: No dependencies
  ┌──────────┐  ┌──────────┐  ┌──────────┐
  │  safety   │  │ session  │  │ prompts  │
  └─────┬────┘  └─────┬────┘  └────┬─────┘
        │              │            │
Level 1: No dependencies
  ┌─────┴────────────────────────────────────┐
  │               agents                      │
  └─────┬────────────────────────────────────┘
        │
Level 2: Depends on safety + agents + prompts
  ┌─────┴────────────────────────────────────┐
  │              dispatch                     │
  └──┬────────────────┬──────────────────┬───┘
     │                │                  │
Level 3: Depends on dispatch
  ┌──┴──────────┐  ┌──┴────────────┐     │
  │observability│  │  scheduling   │     │
  └──┬──────────┘  └──┬───────────┘     │
     │                │                  │
Level 4: Depends on scheduling
     │           ┌────┴──────────┐      │
     │           │ panconfigure  │      │
     │           └───────────────┘      │
     │                                  │
Level 5: Depends on all above
  ┌──┴──────────────────────────────────┴───┐
  │                   ui                     │
  └─────────────────────────────────────────┘

Experimental (disabled by default):
  intelligence (depends on: dispatch, agents)
```

### Dependency Matrix

| Domain | Depends On | Depended On By |
|--------|-----------|----------------|
| safety | (none) | dispatch |
| session | (none) | ui |
| prompts | (none) | dispatch |
| agents | (none) | dispatch, scheduling, intelligence, ui |
| dispatch | safety, agents, prompts | observability, scheduling, intelligence, ui |
| observability | dispatch | ui |
| scheduling | dispatch, agents | panconfigure, ui |
| intelligence | dispatch, agents | (none, event-driven observer) |
| panconfigure | scheduling | (none) |
| ui | dispatch, agents, session, scheduling, observability | (none, leaf node) |

## State Ownership

Each piece of shared state has exactly one owner. Other domains get read-only
access through the owner's public API. No domain mutates another domain's state.

| State | Owner | Readers |
|-------|-------|---------|
| Run ledger (active + historical) | dispatch | ui, observability, scheduling (via bus) |
| Pre-flight check registry | dispatch | scheduling registers checks |
| Agent spec registry | agents | dispatch, ui |
| Budget counters | scheduling | ui |
| Telemetry metrics | observability | ui |
| Session lifecycle | session | ui |
| Theme and branding | ui | (internal only) |
| Cluster node registry | scheduling | (internal only) |

## Adding a New Domain

See [Adding Domains](../development/adding-domains.md) for a step-by-step guide.

## Cross-References

- [Architecture Overview](./overview.md): 5-layer system architecture
- [Engine Boundary](./engine-boundary.md): Pi SDK isolation
- [Event System](./event-system.md): cross-domain communication
- [Adding Domains](../development/adding-domains.md): development guide
