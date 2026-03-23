# Configuration

PanCode reads configuration from environment variables, user files under
`~/.pancode/`, and the current session state. The shell also writes some of
those values back into `process.env` so child processes stay consistent.

## Sample `.env`

The checked-in sample `.env` defines the current homelab defaults:

```bash
PANCODE_MODEL=mini-llamacpp/Qwen35-Distilled-i1-Q4_K_M
PANCODE_WORKER_MODEL=dynamo-lmstudio/qwen3.5-35b-a3b-claude-4.6-opus-reasoning-distilled-i1
PANCODE_SCOUT_MODEL=dynamo-lmstudio/qwen3.5-2b
PANCODE_LOCAL_MACHINES=mini=192.168.86.141,dynamo=192.168.86.143
```

Those are examples, not required values. Real environment variables override
the sample file.

## On-Disk Files

- `~/.pancode/panpresets.yaml` - named boot presets
- `~/.pancode/panagents.yaml` - agent specs and examples
- `~/.pancode/settings.json` - user preferences
- `~/.pancode/pansafety.yaml` - custom safety overrides
- `~/.pancode/panproviders.yaml` - provider discovery cache
- `~/.pancode/model-cache.yaml` - model profile cache
- `~/.pancode/runs.json` - run ledger
- `~/.pancode/metrics.json` - observability metrics
- `~/.pancode/budget.json` - budget tracker
- `~/.pancode/tasks.json` - task store
- `~/.pancode/runtime/` - runtime scratch files, worker results, and prompt versions
- `~/.pancode/agent-engine/` - Pi SDK auth, model registry, and agent storage

## Environment Variables

### Model Selection

- `PANCODE_MODEL` - orchestrator model. Read by `src/core/config.ts`,
  `src/core/presets.ts`, and `src/engine/runtimes/pi-runtime.ts`. No hardcoded
  source default. The repo sample seeds it.
- `PANCODE_DEFAULT_MODEL` - alias for `PANCODE_MODEL`. Same behavior.
- `PANCODE_WORKER_MODEL` - default dispatched worker model. Read by
  `src/core/config.ts`, `src/core/presets.ts`, `src/domains/dispatch/routing.ts`,
  and `src/domains/ui/extension.ts`. Sample default comes from `.env`.
- `PANCODE_SCOUT_MODEL` - shadow scout model. Read by `src/core/presets.ts`,
  `src/domains/agents/shadow-explore.ts`, and `src/domains/ui/extension.ts`.
- `PANCODE_SHADOW_MODEL` - highest-priority scout override. Read by
  `src/domains/agents/shadow-explore.ts`.

### Provider Discovery

- `PANCODE_LOCAL_MACHINES` - comma-separated `name=address` pairs. Read by
  `src/domains/providers/discovery.ts` and `src/domains/scheduling/cluster.ts`.
  The repo sample sets `mini=...` and `dynamo=...`.
- `PANCODE_PROBE_TIMEOUT_MS` - override probe timeout for provider discovery.
  Read by `src/domains/providers/discovery.ts`. If unset, cached providers use
  500ms and new providers use 1000ms.
- `PANCODE_CACHE_TTL_HOURS` - override the model cache TTL. Read by
  `src/domains/providers/model-matcher.ts`. Default is 4 hours.
- `PANCODE_MAX_OUTPUT_TOKENS` - cap for model max token settings. Read by
  `src/domains/providers/registry.ts`. Default cap is 131072, with a floor of
  4096 and a context-window half-limit.

### Dispatch

- `PANCODE_DEFAULT_AGENT` - default agent for `dispatch_agent` and batch/chain
  fallbacks. Read by `src/domains/dispatch/extension.ts`. Default `dev`.
- `PANCODE_WORKER_TIMEOUT_MS` - hard worker timeout in milliseconds. Read by
  `src/domains/dispatch/worker-spawn.ts`. Default 300000.
- `PANCODE_DISPATCH_DEPTH` - internal recursion depth counter. Set by spawn
  paths in `src/engine/runtimes/cli-base.ts`,
  `src/engine/runtimes/pi-runtime.ts`, and dispatch itself. Starts at 0.
- `PANCODE_DISPATCH_MAX_DEPTH` - recursion limit. Read by the same files.
  Default 2.
- `PANCODE_NODE_CONCURRENCY` - max concurrent workers per node. Read by
  `src/domains/scheduling/cluster.ts`. Default 4.

### Safety

- `PANCODE_SAFETY` - autonomy mode. Read by `src/core/config.ts`,
  `src/domains/safety/extension.ts`, `src/domains/ui/extension.ts`,
  `src/engine/runtimes/pi-runtime.ts`, and `src/worker/safety-ext.ts`.
  Valid values: `suggest`, `auto-edit`, `full-auto`. Default `auto-edit`.

### Budget

- `PANCODE_BUDGET_CEILING` - session budget ceiling in dollars. Read by
  `src/core/config.ts`, `src/domains/scheduling/extension.ts`,
  `src/domains/observability/extension.ts`, and `src/domains/ui/extension.ts`.
  Default `10.0`.
- `PANCODE_BUDGET_SPENT` - internal running total written by scheduling and
  read by session and ui code. It is state, not a user knob.

### UI

- `PANCODE_THEME` - active theme name. Read by `src/core/config.ts`,
  `src/core/settings-state.ts`, and `src/domains/ui/extension.ts`.
  Default `dark`.
- `PANCODE_REASONING` - reasoning preference. Read by `src/core/config.ts`,
  `src/core/settings-state.ts`, and `src/domains/ui/extension.ts`.
  Valid values: `off`, `minimal`, `low`, `medium`, `high`, `xhigh`.
  Default `medium`.
- `PANCODE_THINKING` - legacy alias for `PANCODE_REASONING`. Read by
  `src/core/config.ts` through the compatibility shim.
- `PANCODE_EFFECTIVE_THINKING` - internal resolved engine value written by the
  UI and orchestrator. It is not user-configured directly.
- `PANCODE_INTELLIGENCE` - opt-in intelligence gate. The domain only activates
  when the value is exactly `enabled`. Read by
  `src/domains/intelligence/extension.ts` and displayed by
  `src/domains/ui/extension.ts`.

### Boot And Project

- `PANCODE_HOME` - PanCode home directory. Read by `src/loader.ts`,
  `src/core/settings-state.ts`, `src/core/presets.ts`,
  `src/domains/providers/shared.ts`, `src/domains/agents/spec-registry.ts`,
  `src/worker/provider-bridge.ts`, and others. Default `~/.pancode`.
- `PANCODE_PACKAGE_ROOT` - repository root. Resolved by `src/core/package-root.ts`
  and set by `src/loader.ts`. Default is discovered from `package.json`.
- `PANCODE_BIN_PATH` - path to the loader entry file. Set by `src/loader.ts`.
- `PANCODE_ENTRYPOINT` - internal label for the selected entry path. Set by
  `src/loader.ts`.
- `PANCODE_INSIDE_TMUX` - internal flag that prevents double tmux wrapping.
  Set by `src/cli/start.ts` and `src/loader.ts`.
- `PANCODE_PROJECT` - override for the project cwd. Read by `src/core/config.ts`.
  Default `.` relative to the package root.
- `PANCODE_PROFILE` - config profile name. Read and set by
  `src/core/config.ts` and `src/entry/orchestrator.ts`. Default `standard`.
- `PANCODE_PROVIDER` - preferred provider override. Read by `src/core/config.ts`
  and `src/entry/orchestrator.ts`. Default unset.
- `PANCODE_PRESET` - active preset name. Written by `src/entry/orchestrator.ts`
  and `src/domains/ui/extension.ts`.

### Prompt And Runtime Plumbing

- `PANCODE_PROMPT` - boot prompt text. Read by `src/core/config.ts`.
- `PANCODE_PHASE0_PROMPT` - legacy alias for `PANCODE_PROMPT`.
- `PANCODE_TOOLS` - boot tool allowlist. Read by `src/core/config.ts`.
- `PANCODE_PHASE0_TOOLS` - legacy alias for `PANCODE_TOOLS`.
- `PANCODE_TIMEOUT_MS` - boot timeout override. Read by `src/core/config.ts`.
- `PANCODE_PHASE0_TIMEOUT_MS` - removed legacy alias. Use `PANCODE_TIMEOUT_MS`.
- `PANCODE_RUNTIME_ROOT` - runtime state directory. Written by
  `src/core/config.ts` and `src/entry/orchestrator.ts`.
- `PANCODE_AGENT_DIR` - PanCode-managed agent storage directory. Set by
  `src/loader.ts` and used by provider discovery and worker boot.
- `PANCODE_SESSION_ID` - session marker written by dispatch and observability.
- `PANCODE_PARENT_PID` - parent watchdog PID for worker subprocesses.
- `PANCODE_AGENT_NAME` - worker identity used by the worker safety extension.
- `PANCODE_BOARD_FILE` - shared board JSON path for workers.
- `PANCODE_CONTEXT_FILE` - shared context JSON path for workers.
- `PANCODE_SAMPLING_TEMPERATURE`
- `PANCODE_SAMPLING_TOP_P`
- `PANCODE_SAMPLING_TOP_K`
- `PANCODE_SAMPLING_PRESENCE_PENALTY`
  - These are written by `src/engine/runtimes/pi-runtime.ts` when a runtime
    config includes sampling overrides.

### Diagnostics And Internal State

- `PANCODE_VERBOSE` - verbose logging flag used by several domains.
- `PANCODE_ENABLED_DOMAINS` - comma-separated list of enabled domains after
  boot. It is written by the orchestrator after domain resolution and is mainly
  informational.
- `PANCODE_DEFAULT_MODEL` - alias for `PANCODE_MODEL`.
- `PI_CODING_AGENT_DIR` - Pi SDK storage directory. PanCode derives and sets it
  from `PANCODE_HOME`, but it is not the primary user-facing knob.
- `PI_SKIP_VERSION_CHECK` - set by the orchestrator and worker spawn paths to
  suppress SDK version warnings.

## Presets

`~/.pancode/panpresets.yaml` stores named boot presets. The file is seeded once
and never overwritten automatically.

Current built-in presets:

- `local` - uses `PANCODE_MODEL`, `PANCODE_WORKER_MODEL`, and `PANCODE_SCOUT_MODEL`
  from the environment, with `medium` reasoning and `auto-edit` safety
- `openai` - stub preset with empty model IDs for user editing
- `openai-max` - same as `openai`, but with `high` reasoning and `full-auto`
  safety
- `hybrid` - local orchestrator with remote worker and scout models

Read and write helpers live in `src/core/presets.ts`.

## Agent Specs

`~/.pancode/panagents.yaml` defines dispatchable agents.

Fields:

- `name`
- `description`
- `tools`
- `system_prompt`
- `model`
- `sampling`
- `readonly`
- `runtime`
- `runtime_args`

Behavior:

- `tools` may be written as an array in YAML, but the loader normalizes it to a
  comma-separated string
- `system_prompt` is preserved for custom agents
- `runtime` defaults to `pi`
- `readonly` defaults to `false`
- `runtime_args` defaults to an empty array

Default agents seeded by the file template:

- `dev` - mutable general-purpose worker
- `reviewer` - readonly reviewer

The template also includes commented CLI examples for Claude Code, Codex,
OpenCode, Cline, and Copilot CLI. The `scout` role is not dispatchable. It is
an orchestrator-internal shadow tool.

The schema and loader live in `src/domains/agents/spec-registry.ts`.

## Settings

`~/.pancode/settings.json` stores user preferences.

Fields and defaults:

- `preferredProvider` - `null`
- `preferredModel` - `null`
- `theme` - `dark`
- `reasoningPreference` - `medium`
- `safetyMode` - `null`
- `workerModel` - `null`
- `budgetCeiling` - `null`
- `intelligence` - `null`

The normalizer in `src/core/settings-state.ts` rejects malformed values and
falls back to safe defaults.

## Safety Rules

`~/.pancode/pansafety.yaml` lets you extend the safety layer without editing
source code.

Supported keys:

- `bashToolPatterns`
  - Each entry is `{ pattern, reason }`
  - The pattern is interpreted as a regular expression
- `zeroAccessPaths`
  - Glob paths blocked for read, write, and delete
- `readOnlyPaths`
  - Glob paths that can be read but not written or deleted
- `noDeletePaths`
  - Glob paths that can be read and written but never deleted

Notes:

- `~` expands to `$HOME`
- `*` matches a path segment
- `**` matches any depth
- Missing or invalid files are non-fatal

The loader lives in `src/domains/safety/yaml-rules.ts`.
