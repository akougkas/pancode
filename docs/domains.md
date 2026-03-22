# Domains

PanCode has 9 composable domains. Each domain owns its own commands and state.
Cross-domain coordination happens through `src/core/shared-bus.ts`.

## safety

Purpose: Enforce scope, autonomy mode, and YAML-based safety rules on tool
calls and dispatch admission.

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

Commands registered: none

Pi hooks:

- `session_start`
- `tool_call`

Bus events:

- Consumes `pancode:run-finished`
- Emits `pancode:warning`

Dependencies: none

## session

Purpose: Own the cross-agent context registry, shared board, and session memory
tiers. Also exposes session reset and checkpoint commands.

Files:

- `src/domains/session/context-registry.ts`
- `src/domains/session/extension.ts`
- `src/domains/session/index.ts`
- `src/domains/session/manifest.ts`
- `src/domains/session/memory.ts`
- `src/domains/session/shared-board.ts`

Commands registered:

- `/session` - Show session info with PanCode state summary
- `/checkpoint [label]` - Mark a session checkpoint
- `/checkpoint list` - List checkpoints
- `/checkpoint restore <id>` - Display checkpoint data
- `/context [key|source]` - Show the context registry
- `/reset [context|all]` - Reset board, registry, and memory state

Pi hooks:

- `session_start`
- `session_shutdown`

Bus events:

- Consumes `pancode:session-reset`
- Consumes `pancode:compaction-started`
- Consumes `pancode:run-finished`
- Emits `pancode:session-reset`

Dependencies: none

## agents

Purpose: Load and expose agent specs, discover runtimes, and register the
orchestrator-internal shadow scout tool.

Files:

- `src/domains/agents/extension.ts`
- `src/domains/agents/index.ts`
- `src/domains/agents/manifest.ts`
- `src/domains/agents/shadow-explore.ts`
- `src/domains/agents/skills.ts`
- `src/domains/agents/spec-registry.ts`
- `src/domains/agents/teams.ts`

Commands registered:

- `/agents` - List registered agent specs
- `/runtimes` - List runtimes and availability
- `/skills [list|show <name>|validate]` - Discover and inspect skills

Pi hooks:

- `session_start`

Bus events:

- Emits `pancode:runtimes-discovered`

Dependencies: none

## prompts

Purpose: Compile PanPrompt fragments for orchestrator, worker, and scout roles,
and persist prompt versions for debugging.

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

Commands registered:

- `/prompt-debug` - Show the last compiled orchestrator prompt
- `/prompt-version [latest|count]` - Show prompt compilation history
- `/prompt-workers` - Show recent worker prompt compilations

Pi hooks: none

Bus events: none

Dependencies: none

## dispatch

Purpose: Resolve routing, spawn workers, track runs and batches, enforce safety
gates, and collect results.

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

Commands registered:

- `/stoprun <run-id>` - Stop an active run
- `/cost` - Show per-run cost breakdown
- `/dispatch-insights` - Show dispatch analytics and rule evaluation
- `/runs [count]` - Show recent run history
- `/batches` - Show batch dispatch history

Tools registered:

- `dispatch_agent`
- `batch_dispatch`
- `dispatch_chain`
- `task_write`
- `task_check`
- `task_update`
- `task_list`

Pi hooks:

- `session_start`
- `session_shutdown`

Bus events:

- Consumes `pancode:session-reset`
- Emits `pancode:run-started`
- Emits `pancode:run-finished`
- Emits `pancode:shutdown-draining`

Dependencies:

- `safety`
- `agents`
- `prompts`

## observability

Purpose: Collect metrics, maintain the audit trail, and run health checks.

Files:

- `src/domains/observability/extension.ts`
- `src/domains/observability/health.ts`
- `src/domains/observability/index.ts`
- `src/domains/observability/manifest.ts`
- `src/domains/observability/metrics.ts`
- `src/domains/observability/telemetry.ts`

Commands registered:

- `/metrics [count]` - Show dispatch metrics
- `/audit [domain|info|warn|error]` - Show the structured audit trail
- `/doctor` - Run the diagnostic checklist

Pi hooks:

- `session_start`
- `session_shutdown`

Bus events:

- Consumes `pancode:run-finished`
- Consumes `pancode:warning`
- Consumes `pancode:session-reset`
- Consumes `pancode:compaction-started`
- Consumes `pancode:budget-updated`

Dependencies:

- `dispatch`

## scheduling

Purpose: Track budget spend and keep the hidden cluster visibility scaffold.

Files:

- `src/domains/scheduling/budget.ts`
- `src/domains/scheduling/cluster-transport.ts`
- `src/domains/scheduling/cluster.ts`
- `src/domains/scheduling/extension.ts`
- `src/domains/scheduling/index.ts`
- `src/domains/scheduling/manifest.ts`

Commands registered:

- `/budget [set <amount>]` - Show or set the budget ceiling

Pi hooks:

- `session_start`

Bus events:

- Consumes `pancode:run-finished`
- Emits `pancode:budget-updated`

Dependencies:

- `dispatch`
- `agents`

## intelligence

Purpose: Keep the experimental intent-routing and learning scaffold compiled but
disabled by default.

Files:

- `src/domains/intelligence/contracts.ts`
- `src/domains/intelligence/extension.ts`
- `src/domains/intelligence/index.ts`
- `src/domains/intelligence/intent-detector.ts`
- `src/domains/intelligence/learner.ts`
- `src/domains/intelligence/manifest.ts`
- `src/domains/intelligence/rules-upgrade.ts`
- `src/domains/intelligence/solver.ts`

Commands registered: none

Pi hooks:

- `session_start`
- `tool_execution_end`

Bus events: none

Dependencies:

- `dispatch`
- `agents`

## ui

Purpose: Own the TUI, shell commands, widgets, mode switching, and the visible
PanCode state model.

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

Commands registered:

- `/dashboard` - Open the dashboard
- `/status` - Show session summary
- `/theme` - Inspect or change the theme
- `/models` - List models or switch models
- `/preferences` - Show or change preferences
- `/settings` - Show or change configuration
- `/reasoning` - Inspect or change reasoning preference
- `/thinking` - Alias for `/reasoning`
- `/mode` - Switch orchestrator mode
- `/help` - Show the command catalog
- `/preset` - List or apply a boot preset
- `/exit` - Exit PanCode

Pi hooks:

- `session_start`
- `message_end`
- `model_select`
- `before_agent_start`
- `context`

Bus events:

- Consumes `pancode:warning`
- Consumes `pancode:run-started`
- Consumes `pancode:worker-progress`
- Consumes `pancode:run-finished`

Dependencies:

- `dispatch`
- `agents`
- `session`
- `scheduling`
- `observability`
