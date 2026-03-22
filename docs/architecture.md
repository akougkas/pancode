# Architecture

PanCode is split into five physical layers plus one shared support area:

- CLI layer: process entry, tmux bootstrap, session helpers
- Engine layer: the only import boundary for the vendored Pi SDK packages
- Core layer: config, event bus, defaults, and shutdown plumbing
- Domain layer: the 9 composable domains plus shared provider discovery support
- Worker layer: isolated subprocess entry points and worker-side safety code

The actual boot path is:

1. `src/loader.ts` resolves the package root, loads `.env`, and decides whether
   this process is starting tmux, attaching to tmux, running the orchestrator,
   or launching a worker.
2. `src/entry/orchestrator.ts` resolves config, presets, models, and domains.
3. `src/core/domain-loader.ts` orders enabled domains with a topological sort.
4. The orchestrator builds the Pi session and mounts the shell from `src/engine/`.
5. Dispatch spawns workers through `src/worker/` as separate subprocesses.

## Diagram

```text
+--------------------------------------------------+
| CLI Layer                                        |
| loader.ts -> tmux -> cli/*                       |
+--------------------------------------------------+
| Engine Layer                                     |
| Pi SDK boundary, runtimes, shell, tui, session   |
+--------------------------------------------------+
| Core Layer                                       |
| Config, defaults, event bus, shutdown, modes     |
+--------------------------------------------------+
| Domain Layer                                     |
| safety, session, agents, prompts, dispatch,      |
| observability, scheduling, intelligence, ui      |
+--------------------------------------------------+
| Worker Layer                                     |
| entry.ts, cli-entry.ts, provider-bridge.ts,      |
| safety-ext.ts                                    |
+--------------------------------------------------+
```

## CLI Layer

Files:

- `src/loader.ts`
- `src/cli/index.ts`
- `src/cli/shared.ts`
- `src/cli/start.ts`
- `src/cli/up.ts`
- `src/cli/down.ts`
- `src/cli/sessions.ts`
- `src/cli/login.ts`
- `src/cli/version.ts`

Responsibilities:

- Parse top-level CLI arguments
- Start and reattach tmux sessions
- Print version and session information
- Delegate all interactive behavior to the orchestrator entry point

## Engine Layer

Files:

- `src/engine/index.ts`
- `src/engine/events.ts`
- `src/engine/extensions.ts`
- `src/engine/resources.ts`
- `src/engine/session.ts`
- `src/engine/shadow.ts`
- `src/engine/shell.ts`
- `src/engine/shell-overrides.ts`
- `src/engine/tools.ts`
- `src/engine/tui.ts`
- `src/engine/types.ts`
- `src/engine/runtimes/index.ts`
- `src/engine/runtimes/types.ts`
- `src/engine/runtimes/registry.ts`
- `src/engine/runtimes/discovery.ts`
- `src/engine/runtimes/cli-base.ts`
- `src/engine/runtimes/pi-runtime.ts`
- `src/engine/runtimes/adapters/claude-code.ts`
- `src/engine/runtimes/adapters/codex.ts`
- `src/engine/runtimes/adapters/gemini.ts`
- `src/engine/runtimes/adapters/opencode.ts`
- `src/engine/runtimes/adapters/cline.ts`
- `src/engine/runtimes/adapters/copilot-cli.ts`

Responsibilities:

- Re-export the Pi SDK types and wrappers PanCode actually uses
- Keep all direct `@pancode/pi-*` imports inside `src/engine/`
- Provide runtime adapters for Pi and six CLI agents
- Wrap shell and TUI integration behind stable PanCode-facing files

## Core Layer

Files:

- `src/core/agent-profiles.ts`
- `src/core/bus-events.ts`
- `src/core/concurrency.ts`
- `src/core/config.ts`
- `src/core/config-validator.ts`
- `src/core/config-writer.ts`
- `src/core/defaults.ts`
- `src/core/domain-loader.ts`
- `src/core/event-bus.ts`
- `src/core/init.ts`
- `src/core/ledger-types.ts`
- `src/core/modes.ts`
- `src/core/package-root.ts`
- `src/core/presets.ts`
- `src/core/settings-state.ts`
- `src/core/shared-bus.ts`
- `src/core/shell-metadata.ts`
- `src/core/termination.ts`
- `src/core/thinking.ts`
- `src/core/tool-names.ts`

Responsibilities:

- Resolve config, defaults, presets, and user settings
- Own the safe event bus and the canonical bus channel names
- Define orchestrator modes and tool gating
- Provide shutdown coordination and shared ledger types

## Shared Provider Support

PanCode keeps provider discovery under `src/domains/providers/`, even though it
is not one of the 9 composable domains. Several domains depend on it, so it
belongs in the architecture map.

Files:

- `src/domains/providers/api-providers.ts`
- `src/domains/providers/discovery.ts`
- `src/domains/providers/index.ts`
- `src/domains/providers/model-matcher.ts`
- `src/domains/providers/registry.ts`
- `src/domains/providers/shared.ts`
- `src/domains/providers/engines/lmstudio.ts`
- `src/domains/providers/engines/ollama.ts`
- `src/domains/providers/engines/llamacpp.ts`
- `src/domains/providers/engines/parse-params.ts`
- `src/domains/providers/engines/types.ts`

Responsibilities:

- Discover local providers on the LAN or localhost
- Match discovered models against the knowledge base under `models/`
- Register the discovered models into the Pi model registry
- Seed the agent-engine storage directory used by the Pi SDK

## Domain Layer

The 9 composable domains are loaded from `src/domains/index.ts` and ordered by
`src/core/domain-loader.ts`.

### safety

Files:

- `src/domains/safety/action-classifier.ts`
- `src/domains/safety/audit.ts`
- `src/domains/safety/extension.ts`
- `src/domains/safety/index.ts`
- `src/domains/safety/loop-detector.ts`
- `src/domains/safety/manifest.ts`
- `src/domains/safety/scope-enforcement.ts`
- `src/domains/safety/scope.ts`
- `src/domains/safety/yaml-rules.ts`

Purpose:

- Enforce autonomy mode and path safety on tool calls
- Block dispatch admission when scope or loop conditions are violated
- Load custom YAML safety rules from `.pancode/safety-rules.yaml`

### session

Files:

- `src/domains/session/context-registry.ts`
- `src/domains/session/extension.ts`
- `src/domains/session/index.ts`
- `src/domains/session/manifest.ts`
- `src/domains/session/memory.ts`
- `src/domains/session/shared-board.ts`

Purpose:

- Own the cross-agent context registry, shared board, and session memory tiers
- Expose `/session`, `/checkpoint`, `/context`, and `/reset`
- Persist and reload session-scoped coordination state

### agents

Files:

- `src/domains/agents/extension.ts`
- `src/domains/agents/index.ts`
- `src/domains/agents/manifest.ts`
- `src/domains/agents/shadow-explore.ts`
- `src/domains/agents/skills.ts`
- `src/domains/agents/spec-registry.ts`
- `src/domains/agents/teams.ts`

Purpose:

- Load `~/.pancode/agents.yaml`
- Register the agent spec registry
- Discover runtimes and expose `/agents`, `/runtimes`, and `/skills`
- Register the orchestrator-internal `shadow_explore` tool

### prompts

Files:

- `src/domains/prompts/compiler.ts`
- `src/domains/prompts/extension.ts`
- `src/domains/prompts/fragments.ts`
- `src/domains/prompts/index.ts`
- `src/domains/prompts/manifest.ts`
- `src/domains/prompts/orchestrator-compiler.ts`
- `src/domains/prompts/pi-compat.ts`
- `src/domains/prompts/tiering.ts`
- `src/domains/prompts/types.ts`
- `src/domains/prompts/versioning.ts`
- `src/domains/prompts/worker-compiler.ts`

Purpose:

- Compile PanPrompt fragments for orchestrator, worker, and scout roles
- Track prompt versions and debug output
- Keep prompt density tiered by model capability

### dispatch

Files:

- `src/domains/dispatch/admission.ts`
- `src/domains/dispatch/backoff.ts`
- `src/domains/dispatch/batch-tracker.ts`
- `src/domains/dispatch/extension.ts`
- `src/domains/dispatch/index.ts`
- `src/domains/dispatch/isolation.ts`
- `src/domains/dispatch/manifest.ts`
- `src/domains/dispatch/primitives.ts`
- `src/domains/dispatch/resilience.ts`
- `src/domains/dispatch/routing.ts`
- `src/domains/dispatch/rules.ts`
- `src/domains/dispatch/state.ts`
- `src/domains/dispatch/task-tools.ts`
- `src/domains/dispatch/validation.ts`
- `src/domains/dispatch/worker-spawn.ts`

Purpose:

- Own dispatch admission, routing, spawn, and result collection
- Track runs, batches, task state, and worktree isolation
- Provide the `dispatch_agent`, `batch_dispatch`, and `dispatch_chain` tools

### observability

Files:

- `src/domains/observability/extension.ts`
- `src/domains/observability/health.ts`
- `src/domains/observability/index.ts`
- `src/domains/observability/manifest.ts`
- `src/domains/observability/metrics.ts`
- `src/domains/observability/telemetry.ts`

Purpose:

- Collect run metrics and structured audit data
- Expose `/metrics`, `/audit`, and `/doctor`
- Run the 8-probe health checklist

### scheduling

Files:

- `src/domains/scheduling/budget.ts`
- `src/domains/scheduling/cluster-transport.ts`
- `src/domains/scheduling/cluster.ts`
- `src/domains/scheduling/extension.ts`
- `src/domains/scheduling/index.ts`
- `src/domains/scheduling/manifest.ts`

Purpose:

- Track budget admission and session spend
- Keep the cluster visibility scaffold that is hidden pending the SSH redesign
- Expose `/budget`

### intelligence

Files:

- `src/domains/intelligence/contracts.ts`
- `src/domains/intelligence/extension.ts`
- `src/domains/intelligence/index.ts`
- `src/domains/intelligence/intent-detector.ts`
- `src/domains/intelligence/learner.ts`
- `src/domains/intelligence/manifest.ts`
- `src/domains/intelligence/rules-upgrade.ts`
- `src/domains/intelligence/solver.ts`

Purpose:

- Provide the experimental intent and routing scaffold
- Stay inert unless `PANCODE_INTELLIGENCE=enabled`
- Keep the adaptive routing upgrade path compiled even when disabled

### ui

Files:

- `src/domains/ui/context-tracker.ts`
- `src/domains/ui/dispatch-board.ts`
- `src/domains/ui/extension.ts`
- `src/domains/ui/index.ts`
- `src/domains/ui/manifest.ts`
- `src/domains/ui/pancode-editor.ts`
- `src/domains/ui/renderers.ts`
- `src/domains/ui/tasks.ts`
- `src/domains/ui/widget-utils.ts`
- `src/domains/ui/worker-widgets.ts`

Purpose:

- Own the TUI, shell commands, and status widgets
- Render the dispatch board, model selector, settings, and help output
- Keep the visible shell state in sync with the domain data model

## Worker Layer

Files:

- `src/worker/entry.ts`
- `src/worker/cli-entry.ts`
- `src/worker/provider-bridge.ts`
- `src/worker/safety-ext.ts`

Responsibilities:

- Spawn isolated Pi subprocesses
- Wrap CLI runtimes with a parent-process watchdog
- Load worker-side safety rules and coordination tools
- Keep worker code physically separate from the domain graph

## Key Rules

- `src/engine/` is the only allowed import boundary for `@pancode/pi-*`
- `src/worker/` never imports from `src/domains/`
- Cross-domain communication happens through `src/core/shared-bus.ts`
- Domain state is owned by the domain that writes it
- The CLI is tmux-first, so `pancode` starts a tmux session and `pancode up`
  reattaches later

## Command Ownership

The shell command surface has three different truth layers:

1. Domain extension files such as `src/domains/session/extension.ts`
   and `src/domains/ui/extension.ts`
   Most PanCode-specific slash commands are implemented there.
2. `src/engine/shell-overrides.ts`
   Pi builtins are hidden, passed through, or rerouted here by patching
   `InteractiveMode.prototype`.
3. `src/core/shell-metadata.ts`
   This powers categorized `/help`, but it is not authoritative about runtime
   behavior.

Examples:

- `/session` is implemented by the session domain, but the visible command name
  also shadows a Pi builtin and is routed through `shell-overrides.ts`
- `/settings` and `/models` are implemented by the ui domain and also shadow
  Pi builtins
- `/new`, `/compact`, `/fork`, `/tree`, `/resume`, `/copy`, `/export`,
  `/login`, `/logout`, `/reload`, and `/hotkeys` remain Pi builtin execution
  paths

## Dispatch Hardening Notes

The current dispatch stack includes several protections that should be kept in
sync with the code:

- Recursion depth guard with `PANCODE_DISPATCH_DEPTH` and
  `PANCODE_DISPATCH_MAX_DEPTH`
- Provider backoff and resilience tracking
- Hard worker timeout enforcement
- Temp-file protocol for long tasks and long system prompts
- 150ms stagger between parallel worker launches
- NDJSON progress events for tool-level tracking
- Session artifact cleanup on shutdown
- Worktree isolation for optional filesystem separation
