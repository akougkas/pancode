# Safety

PanCode enforces a 4-layer behavioral model that controls what the system does,
how much autonomy it has, how agents are configured, and how the infrastructure
is tuned. This document covers each layer in detail.

## 4-Layer Behavioral Model

```
┌─────────────────────────────────────────────────────────────┐
│ Layer 1: ACTIVITY MODE                                      │
│ "What is PanCode doing?"                                    │
│ admin | plan | build | review                               │
│ Controls tool VISIBILITY (structural gate)                  │
├─────────────────────────────────────────────────────────────┤
│ Layer 2: SAFETY LEVEL                                       │
│ "How much autonomy?"                                        │
│ suggest | auto-edit | full-auto                             │
│ Controls action PERMISSION (policy gate)                    │
├─────────────────────────────────────────────────────────────┤
│ Layer 3: FLEET CONFIG                                       │
│ "How are agents configured?"                                │
│ agents.yaml, models, reasoning, sampling                    │
│ Controls agent BEHAVIOR (configuration)                     │
├─────────────────────────────────────────────────────────────┤
│ Layer 4: INFRASTRUCTURE                                     │
│ "How is the system tuned?"                                  │
│ domains, budget, theme, discovery                           │
│ Controls system CAPACITY (infrastructure)                   │
└─────────────────────────────────────────────────────────────┘
```

Mode is the outer gate. Safety is the inner gate. They work together:

```
User input → Mode filter (is the tool visible?) → Tool call
           → Safety filter (is this action allowed?) → Execute or block
```

Mode cannot be overridden by safety. Safety can be changed at runtime.

## Layer 1: Activity Modes

Activity modes control what the orchestrator does with user input by physically
gating which tools the LLM sees. This is implemented via `pi.setActiveTools()`,
which changes the tool list that the LLM receives.

### Mode Definitions

Defined in `src/core/modes.ts`:

| Mode | Built-in Tools | Shadow | Tasks | Dispatch | Mutations | Config |
|------|---------------|--------|-------|----------|-----------|--------|
| admin | read, bash, grep, find, ls | yes | yes | yes | no | full |
| plan | read, bash, grep, find, ls | yes | yes | no | no | read |
| build | all (including edit, write) | yes | yes | yes | yes | read |
| review | read, bash, grep, find, ls | yes | no | yes | no | read |

### Mode Properties

Each mode is defined with explicit properties:

```typescript
{
  id: "build",
  name: "Build",
  color: "#16c858",
  description: "Full dispatch. Workers implement, test, review.",
  dispatchEnabled: true,
  shadowEnabled: true,
  mutationsAllowed: true,
  reasoningLevel: "medium",
}
```

- **dispatchEnabled**: whether `dispatch_agent` and `batch_dispatch` tools are
  visible
- **shadowEnabled**: whether the `shadow_explore` tool is visible
- **mutationsAllowed**: whether `edit` and `write` tools are visible
- **reasoningLevel**: the preferred reasoning depth for this mode. `admin` and
  `review` use `xhigh` for deep analysis. `build` uses `medium` for efficient
  execution.

### Mode Switching

- **Shift+Tab**: cycles through plan, build, review (Admin excluded)
- **Alt+A**: toggles Admin mode directly

Admin mode provides full system management, configuration, and diagnostic
dispatch. It is excluded from the Shift+Tab cycle to prevent accidental
activation.

### Tool Gating Implementation

The function `getToolsetForMode()` in `src/core/modes.ts` returns the tool
names active for each mode:

```typescript
export function getToolsetForMode(mode: OrchestratorMode): string[] {
  const readonly = [ToolName.READ, ToolName.BASH, ToolName.GREP, ToolName.FIND, ToolName.LS];
  const mutable = [...readonly, ToolName.EDIT, ToolName.WRITE];
  const shadow = [ToolName.SHADOW_EXPLORE];
  const tasks = [ToolName.TASK_WRITE, ToolName.TASK_CHECK, ToolName.TASK_UPDATE, ToolName.TASK_LIST];
  const dispatch = [ToolName.DISPATCH_AGENT, ToolName.BATCH_DISPATCH, ToolName.DISPATCH_CHAIN];
  const config = [ToolName.PAN_READ_CONFIG, ToolName.PAN_APPLY_CONFIG];

  switch (mode) {
    case "admin":  return [...readonly, ...shadow, ...tasks, ...dispatch, ...config];
    case "plan":   return [...readonly, ...shadow, ...tasks, ...config];
    case "build":  return [...mutable, ...shadow, ...tasks, ...dispatch, ...config];
    case "review": return [...readonly, ...shadow, ...dispatch, ...configReadOnly];
  }
}
```

Note that Admin mode has dispatch but no mutations (edit/write). Build mode has
both. Plan mode has neither dispatch nor mutations. Review mode has dispatch
but no mutations or tasks.

## Layer 2: Safety Levels

Safety levels control how much autonomy the system has at the action level.
They are evaluated after mode determines tool visibility. The safety domain
(`src/domains/safety/`) implements this layer.

### Action Classification

Every tool call is classified into an action class by `action-classifier.ts`:

```typescript
const TOOL_TO_ACTION: Record<string, ActionClass> = {
  read: "file_read",
  grep: "file_read",
  find: "file_read",
  ls: "file_read",
  write: "file_write",
  edit: "file_write",
  bash: "bash_exec",
  shell: "bash_exec",
  web_fetch: "network",
  web_search: "network",
  dispatch_agent: "agent_dispatch",
  batch_dispatch: "agent_dispatch",
  dispatch_chain: "agent_dispatch",
  // ...
};
```

Bash commands receive additional classification. Destructive patterns are
detected and elevated:

```typescript
const DESTRUCTIVE_BASH_PATTERNS = [
  /rm\s+(-rf|-fr|--force)/,
  /git\s+reset\s+--hard/,
  /git\s+push\s+--force/,
  /git\s+clean/,
  // ...
];
```

A bash command matching a destructive pattern is reclassified from `bash_exec`
to `bash_destructive`.

### Policy Matrix

The policy matrix in `src/domains/safety/scope.ts` defines what each safety
level allows:

| Action Class | suggest | auto-edit | full-auto |
|--------------|---------|-----------|-----------|
| file_read | allow | allow | allow |
| file_write | block | allow | allow |
| file_delete | block | block | allow |
| bash_exec | block | allow | allow |
| bash_destructive | block | block | ask |
| git_push | block | block | allow |
| git_destructive | block | block | block |
| network | allow | allow | allow |
| agent_dispatch | block | allow | allow |
| system_modify | block | block | block |

Key observations:
- `git_destructive` is always blocked. No safety level permits destructive git
  operations.
- `system_modify` is always blocked. PanCode cannot modify system-level
  configuration.
- `bash_destructive` requires user confirmation even in full-auto mode.
- `agent_dispatch` requires at least auto-edit. You cannot dispatch workers in
  suggest mode.

### Safety Level Switching

Safety levels are changed with **Ctrl+Y** (cycles through suggest, auto-edit,
full-auto) or configured via presets and environment variables.

### YAML Safety Rules

Project-specific safety rules can be defined in YAML configuration. The
`yaml-rules.ts` module loads these rules and applies them during tool call
evaluation:

- **bashPatterns**: additional bash patterns to block or flag
- **zeroAccessPaths**: paths that no tool may access
- **readOnlyPaths**: paths that may be read but not written
- **noDeletePaths**: paths that may not be deleted

## Layer 3: Fleet Configuration

Fleet configuration controls how individual agents behave. This is set in
`~/.pancode/panagents.yaml` and through environment variables:

- **Per-agent model assignment**: each agent can specify its model
- **Worker model override**: `PANCODE_WORKER_MODEL` sets the default model for
  all workers
- **Scout model**: `PANCODE_SCOUT_MODEL` sets the model for shadow exploration
- **Reasoning preference**: configurable per-mode reasoning depth
- **Sampling presets**: per-agent sampling parameters (temperature, top-p)

## Layer 4: Infrastructure

Infrastructure configuration controls system capacity and behavior:

- **Enabled domains**: which of the 10 domains are active
- **Budget ceiling**: maximum cost per session (`/budget` command)
- **Intelligence flag**: `PANCODE_INTELLIGENCE=enabled` activates the
  experimental intelligence domain
- **Theme**: visual presentation (`/theme` command)
- **Discovery endpoints**: which local provider endpoints to probe

## Scope Enforcement

The safety domain enforces a privilege non-escalation invariant: worker
permissions cannot exceed orchestrator permissions.

`src/domains/safety/scope-enforcement.ts` validates at dispatch admission that
the requested safety level for a worker does not exceed the orchestrator's
current level. If the orchestrator runs in auto-edit mode, it cannot dispatch
a worker with full-auto permissions.

This is checked as a pre-flight admission gate in the dispatch domain. If
scope enforcement fails, the dispatch is rejected with an explanation.

## Loop Detection

`src/domains/safety/loop-detector.ts` monitors for degenerate behavior
patterns:

- **Consecutive errors**: if a worker produces repeated errors, the loop
  detector flags the pattern
- **Repeated tool calls**: if the same tool is called with the same arguments
  repeatedly, the detector flags a potential loop

Loop detection runs as a post-dispatch check and can trigger warnings or
automatic cancellation.

## Audit Trail

Every safety decision is recorded by `src/domains/safety/audit.ts`:

```typescript
interface AuditEntry {
  timestamp: string;
  toolName: string;
  actionClass: ActionClass;
  allowed: boolean;
  reasonCode: SafetyReasonCode;
  detail: string;
}
```

The audit trail is accessible via the `/audit` command in the observability
domain. It provides a complete record of every tool call evaluation, including
which calls were allowed and which were blocked.

## Interaction Examples

### Build mode + auto-edit safety

The most common development configuration. The LLM sees all tools including
edit, write, and dispatch. Safety allows file writes, bash execution, and
agent dispatch. Destructive operations are blocked.

### Plan mode + any safety level

The LLM sees read-only tools and shadow explore. Dispatch tools are not visible,
so the LLM cannot attempt dispatch. Safety level is irrelevant for dispatch
because mode prevents the attempt structurally.

### Admin mode + full-auto safety

Full system management. The LLM sees dispatch and config tools but not
edit/write (Admin mode does not allow mutations). Dispatch is enabled for
diagnostic runs. All admin-only config parameters are accessible.

### Review mode + suggest safety

Maximum safety. The LLM sees read-only tools and dispatch. Safety blocks
dispatch calls because suggest mode does not allow agent_dispatch. The result
is effectively a read-only review session.

## Worker-Side Safety

Workers run their own safety extension (`src/worker/safety-ext.ts`) that
mirrors the orchestrator's policy matrix. The worker receives its safety level
via the `PANCODE_SAFETY` environment variable and enforces it locally.

This means safety is enforced at both layers:
1. **Orchestrator**: admission gate checks before dispatch
2. **Worker**: tool call gate checks during execution

Even if a worker could somehow bypass the orchestrator's admission check, the
worker-side safety extension would still block disallowed actions.

## Cross-References

- [Core Concepts](../getting-started/core-concepts.md): activity modes and safety overview
- [Worker Isolation](../architecture/worker-isolation.md): worker-side safety enforcement
- [Dispatch](./dispatch.md): admission gates and scope enforcement
- [Modes and Presets](./modes-and-presets.md): configuring safety levels via presets
