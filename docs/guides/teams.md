# Teams Guide

Teams define coordinated multi-agent workflows. A team specifies which agents participate and how they collaborate.

## Built-in Teams

PanCode ships with two built-in team definitions:

### code-review

Developer writes code, reviewer checks it. Sequential workflow.

```
dev -> reviewer
```

The dev agent implements the task, then the reviewer agent analyzes the output for bugs, security issues, and improvements.

### research-dev

Reviewer explores the codebase first, developer implements based on findings. Sequential workflow.

```
reviewer -> dev
```

The reviewer agent explores and analyzes relevant code, then the dev agent uses those findings to implement changes with better context.

## Team Definition Schema

```typescript
interface TeamDefinition {
  name: string;          // Team identifier
  description: string;   // Human-readable purpose
  agents: string[];      // Ordered list of agent names
  workflow: "parallel" | "sequential" | "review";
}
```

### Workflow Types

| Type | Behavior |
|------|----------|
| `parallel` | All agents run simultaneously on the same task |
| `sequential` | Agents run in order. Each agent's output feeds into the next. |
| `review` | Primary agent does the work, review agent validates the output. |

## Dispatch Primitives

PanCode provides three dispatch tools that implement team-like coordination:

### dispatch_agent (Single)

Dispatch one agent for one task.

```
dispatch_agent(task: "Review config.ts", agent: "reviewer")
```

### batch_dispatch (Parallel)

Run multiple tasks simultaneously across agents.

```
batch_dispatch(tasks: [
  { task: "Review auth module", agent: "reviewer" },
  { task: "Review config module", agent: "reviewer" },
  { task: "Explore test coverage", agent: "scout" }
])
```

Each task gets its own worker subprocess. PanCode staggers launches to avoid resource contention.

### dispatch_chain (Sequential Pipeline)

Run a multi-step pipeline where each step builds on the previous.

```
dispatch_chain(steps: [
  { task: "Analyze the authentication flow", agent: "planner" },
  { task: "Implement the proposed changes", agent: "builder" },
  { task: "Review the implementation", agent: "reviewer" }
])
```

The chain stops if any step fails. Each step receives the output of the previous step as context.

## Combining Teams with Modes

Team execution respects the current orchestrator mode:

| Mode | Team Behavior |
|------|---------------|
| Plan | Dispatch disabled. Use shadow agents for exploration. |
| Build | Full team execution. All agents available. |
| Review | Only readonly agents can be dispatched. |
| Admin | Full team execution with elevated permissions. |

In Review mode, a code-review team would fail on the dev step because dev is not readonly. Use this intentionally to restrict what teams can do in different contexts.

## Worktree Isolation

Any dispatch (single, batch, or chain) can use worktree isolation:

```
dispatch_agent(task: "Refactor config.ts", agent: "builder", isolate: true)
```

With isolation enabled:
1. PanCode creates a git worktree for the worker
2. The worker operates on the isolated copy
3. On completion, delta patches are merged back to the main workspace
4. The worktree is cleaned up

This prevents concurrent workers from interfering with each other's file changes.

## Monitoring Team Execution

```
/runs           View all dispatch history
/batches        View batch dispatch history
/cost           Per-run cost breakdown
/metrics        Aggregate statistics
/stoprun <id>   Stop a running dispatch
```

## Budget and Admission

Team dispatches go through the same admission pipeline as single dispatches:

1. **Safety pre-flight**: Checks scope enforcement and loop detection
2. **Budget check**: Verifies budget ceiling is not exceeded
3. **Recursion guard**: Prevents unbounded subprocess trees (default max depth: 2)
4. **Path validation**: Blocks scope violations and warns about missing files

## See Also

- [Agents Guide](./agents.md): Agent definitions and configuration
- [Multi-Agent Dispatch Tutorial](../tutorials/multi-agent-dispatch.md): Practical dispatch patterns
- [Commands Reference](../reference/commands.md): All dispatch-related commands
