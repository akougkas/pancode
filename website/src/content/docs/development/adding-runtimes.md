---
title: "Adding Runtimes"
description: "Add a new runtime adapter to PanCode"
---

:::caution[Experimental Preview]
This is an experimental preview release. APIs, commands, and features may change without notice.
:::


PanCode supports multiple agent runtimes through an adapter system. This guide
covers how to add a new CLI agent adapter so PanCode can discover and dispatch
it as a worker.

## Runtime Architecture

The runtime adapter system lives in `src/engine/runtimes/`:

```
src/engine/runtimes/
  types.ts          # AgentRuntime interface and related types
  registry.ts       # Singleton runtime registry
  discovery.ts      # PATH-based binary discovery
  cli-base.ts       # Base class for CLI agent adapters
  pi-runtime.ts     # Pi SDK native runtime adapter
  adapters/         # CLI agent adapter implementations
    claude-code.ts
    codex.ts
    gemini.ts
    opencode.ts
    cline.ts
    copilot-cli.ts
```

### Three Runtime Tiers

| Tier | Integration | Example |
|------|------------|---------|
| Native | Full Pi SDK control | Pi SDK agents |
| SDK | Programmatic SDK API | Claude Agent SDK, OpenAI Agents SDK |
| CLI | Headless subprocess | Claude Code, Codex, Gemini CLI |

This guide focuses on CLI adapters, which are the most common addition.

## Runtime Interface

Every runtime adapter implements this interface (from `src/engine/runtimes/types.ts`):

```typescript
interface AgentRuntime {
  readonly id: string;        // Unique identifier (e.g., "cli:my-agent")
  readonly name: string;      // Display name (e.g., "My Agent")
  readonly tier: "native" | "sdk" | "cli";
  readonly available: boolean; // Whether the binary was found
  spawn(config: RuntimeTaskConfig): Promise<RuntimeResult>;
}
```

The `RuntimeTaskConfig` provides everything needed to run a task:

```typescript
interface RuntimeTaskConfig {
  task: string;               // Task description
  cwd: string;                // Working directory
  model?: string;             // Model override
  systemPrompt?: string;      // Additional system prompt
  safetyMode?: string;        // Safety level
  timeout?: number;           // Timeout in milliseconds
  env?: Record<string, string>; // Additional environment variables
}
```

The `RuntimeResult` captures the outcome:

```typescript
interface RuntimeResult {
  exitCode: number;
  result: string;             // Agent's output text
  error: string;              // Error output if any
  usage: RuntimeUsage;        // Token/cost metrics
}

interface RuntimeUsage {
  inputTokens: number | null;
  outputTokens: number | null;
  cost: number | null;
  turns: number | null;
}
```

## Step 1: Create the Adapter File

Create `src/engine/runtimes/adapters/<agent-name>.ts`:

```typescript
import { CliAgentBase } from "../cli-base";

export class MyAgentRuntime extends CliAgentBase {
  readonly id = "cli:my-agent";
  readonly name = "My Agent";

  // Binary names to search for in PATH
  protected readonly binaryNames = ["my-agent", "myagent"];

  // Build CLI arguments for headless execution
  protected buildArgs(config: RuntimeTaskConfig): string[] {
    const args: string[] = [];

    // Add headless/non-interactive flag
    args.push("--headless");

    // Add task
    args.push("--prompt", config.task);

    // Add model if specified
    if (config.model) {
      args.push("--model", config.model);
    }

    // Add system prompt if specified
    if (config.systemPrompt) {
      args.push("--system", config.systemPrompt);
    }

    // Add working directory
    args.push("--cwd", config.cwd);

    return args;
  }

  // Parse the agent's output to extract the result
  protected parseOutput(stdout: string, stderr: string, exitCode: number): RuntimeResult {
    return {
      exitCode,
      result: stdout.trim(),
      error: stderr.trim(),
      usage: {
        inputTokens: null,
        outputTokens: null,
        cost: null,
        turns: null,
      },
    };
  }
}
```

### CLI Base Class

The `CliAgentBase` class (`src/engine/runtimes/cli-base.ts`) provides:

- **Binary discovery**: searches PATH for the binary names you specify
- **Subprocess spawning**: handles `child_process.spawn` with proper options
- **Timeout enforcement**: kills the process if it exceeds the timeout
- **Signal forwarding**: forwards SIGTERM/SIGINT to the child process
- **Parent PID monitoring**: terminates the child if the orchestrator dies

Your adapter overrides `buildArgs()` to construct the CLI invocation and
`parseOutput()` to extract the result from stdout/stderr.

### Existing Adapter Examples

Study the existing adapters for patterns:

**Claude Code** (`claude-code.ts`):
- Binary: `claude`
- Headless mode: `--print` flag
- Model passthrough: `--model` flag
- System prompt: `--system-prompt` flag

**Codex** (`codex.ts`):
- Binary: `codex`
- Headless mode: `--quiet` flag
- Model and prompt passed as arguments

**Gemini CLI** (`gemini.ts`):
- Binary: `gemini`
- Headless mode with specific flags

## Step 2: Register in Discovery

Add your adapter to the discovery system in `src/engine/runtimes/discovery.ts`:

```typescript
import { MyAgentRuntime } from "./adapters/my-agent";

// Add to the list of adapters to discover
const CLI_ADAPTERS = [
  // ... existing adapters ...
  new MyAgentRuntime(),
];
```

The discovery system calls `discover()` on each adapter at boot, which checks
PATH for the binary. If found, the adapter is marked as `available: true` and
registered in the runtime registry.

## Step 3: Register in the Runtime Registry

The runtime registry (`src/engine/runtimes/registry.ts`) is a singleton that
stores discovered adapters. After discovery, adapters are registered
automatically. No manual registration step is needed if you added the adapter
to the discovery list.

## Step 4: Map the Runtime ID in Agent Specs

Users can reference your runtime in `~/.pancode/panagents.yaml`:

```yaml
my-custom-agent:
  description: "Custom agent using My Agent runtime"
  runtime: "cli:my-agent"
  model: "gpt-4"
  systemPrompt: "You are a specialized coding agent."
```

The `runtime` field matches the `id` property of your adapter class.

## Step 5: Verify

```bash
npm run typecheck && npm run check-boundaries && npm run build && npm run lint
```

Then start PanCode and check that your runtime is discovered:

```
/runtimes
```

The output should list your agent with its availability status.

## Advanced: Usage Metrics

If your agent provides usage information (token counts, cost) in its output,
parse it in `parseOutput()`:

```typescript
protected parseOutput(stdout: string, stderr: string, exitCode: number): RuntimeResult {
  // Parse usage from structured output (e.g., JSON footer)
  const usageMatch = stdout.match(/USAGE:\s*({.*})/);
  let usage: RuntimeUsage = {
    inputTokens: null,
    outputTokens: null,
    cost: null,
    turns: null,
  };

  if (usageMatch) {
    try {
      const parsed = JSON.parse(usageMatch[1]);
      usage = {
        inputTokens: parsed.input_tokens ?? null,
        outputTokens: parsed.output_tokens ?? null,
        cost: parsed.cost ?? null,
        turns: parsed.turns ?? null,
      };
    } catch {
      // Ignore parse failures
    }
  }

  return { exitCode, result: stdout.trim(), error: stderr.trim(), usage };
}
```

Accurate usage metrics enable PanCode's cost tracking and budget enforcement
for your agent.

## Advanced: Custom Environment Variables

If your agent needs specific environment variables, set them in `buildEnv()`:

```typescript
protected buildEnv(config: RuntimeTaskConfig): Record<string, string> {
  return {
    ...super.buildEnv(config),
    MY_AGENT_API_KEY: process.env.MY_AGENT_API_KEY ?? "",
    MY_AGENT_CONFIG: "/path/to/config",
  };
}
```

## Checklist

- [ ] Adapter class extends `CliAgentBase`
- [ ] `id` follows the `cli:<name>` pattern
- [ ] `binaryNames` lists all possible binary names
- [ ] `buildArgs()` includes headless/non-interactive flags
- [ ] `parseOutput()` extracts result text and (optionally) usage metrics
- [ ] Adapter added to discovery list
- [ ] `npm run typecheck` passes
- [ ] `npm run check-boundaries` passes (adapter is inside `src/engine/`)
- [ ] `/runtimes` shows the new adapter after boot

## Cross-References

- [Engine Boundary](../architecture/engine-boundary.md): runtime adapter system
- [Worker Isolation](../architecture/worker-isolation.md): how workers use runtimes
- [Dispatch](../guides/dispatch.md): how runtimes are selected during dispatch
- [Adding Domains](./adding-domains.md): creating new domains
