---
title: "Engine Boundary"
description: "SDK import boundary and engine isolation"
---

:::caution[Experimental Preview]
This is an experimental preview release. APIs, commands, and features may change without notice.
:::


`src/engine/` is the sole import boundary for all Pi SDK packages in PanCode.
No file outside `src/engine/` may import from `@pancode/pi-coding-agent`,
`@pancode/pi-ai`, `@pancode/pi-tui`, or `@pancode/pi-agent-core`. This rule
is enforced at build time by `npm run check-boundaries`.

## Why the Boundary Exists

PanCode depends on the Pi SDK, which is pre-1.0. In semver for 0.x releases,
minor version bumps can contain breaking changes. Without containment, a Pi SDK
update could break files across all 10 domains simultaneously.

The engine boundary ensures that a Pi SDK breaking change affects only files in
`src/engine/`. Domain code, core infrastructure, worker code, and CLI code
remain stable across SDK updates.

This is not an abstraction over Pi SDK concepts. PanCode uses Pi's extension
model directly (ExtensionFactory, hooks, tools, commands). The engine layer is a
thin re-export and adaptation boundary.

## Engine Layer Structure

```
src/engine/
  index.ts            # Barrel export (re-exports runtimes/)
  types.ts            # Re-exported Pi SDK types
  extensions.ts       # ExtensionFactory creation helpers
  events.ts           # Pi SDK event name constants
  session.ts          # Session creation wrapper
  resources.ts        # Resource loader re-exports
  tools.ts            # Tool registration helpers
  tui.ts              # TUI component re-exports
  shell.ts            # Shell utilities
  shell-overrides.ts  # Shell override configuration
  shadow.ts           # Shadow scout engine
  runtimes/           # Runtime adapter system
    index.ts          # Barrel export
    types.ts          # Runtime interfaces
    registry.ts       # Runtime registry singleton
    discovery.ts      # PATH-based runtime discovery
    cli-base.ts       # Base class for CLI agent adapters
    pi-runtime.ts     # Pi SDK native runtime adapter
    adapters/         # CLI agent adapters
      claude-code.ts
      codex.ts
      gemini.ts
      opencode.ts
      cline.ts
      copilot-cli.ts
```

## What the Engine Exposes

### Type Re-exports (engine/types.ts)

Re-exports types that PanCode uses as-is from the Pi SDK. If Pi renames a type,
the fix is one line in `types.ts`, not changes across every domain.

```typescript
// engine/types.ts re-exports from @pancode/pi-coding-agent:
export type {
  ExtensionFactory,
  ExtensionAPI,
  ExtensionContext,
  AgentToolResult,
  // ... and other types domains need
};
```

### Extension Helpers (engine/extensions.ts)

Provides `defineExtension()`, a convenience wrapper for creating extensions:

```typescript
export type { ExtensionAPI, ExtensionContext, ExtensionFactory } from "@pancode/pi-coding-agent";

export function defineExtension(factory: ExtensionFactory): ExtensionFactory {
  return factory;
}
```

Every domain extension uses `defineExtension()` from this file rather than
importing the type directly from the Pi SDK.

### Event Constants (engine/events.ts)

All Pi SDK lifecycle event names are centralized:

```typescript
export const PiEvent = {
  SESSION_START: "session_start",
  SESSION_SHUTDOWN: "session_shutdown",
  BEFORE_AGENT_START: "before_agent_start",
  MESSAGE_END: "message_end",
  MODEL_SELECT: "model_select",
  CONTEXT: "context",
  TOOL_CALL: "tool_call",
  TOOL_EXECUTION_END: "tool_execution_end",
} as const;
```

Domains subscribe to events using these constants instead of raw string
literals. If the Pi SDK renames an event, this is the single file to update.

### Session Wrapper (engine/session.ts)

Wraps the Pi SDK's `createAgentSession()` and `InteractiveMode` with
PanCode-specific configuration. The wrapper handles auth storage initialization,
model registry setup, settings management, and extension composition.

### Resource Re-exports (engine/resources.ts)

Re-exports `DefaultResourceLoader`, `SessionManager`, and `SettingsManager`
from the Pi SDK for use by the orchestrator's bootstrap sequence.

### TUI Re-exports (engine/tui.ts)

Re-exports Pi TUI components (Theme, Box, Text, Container, etc.) that change
more frequently than the core SDK. Isolating them in `tui.ts` means TUI
rendering changes stay contained.

## Runtime Adapter System

The runtime system in `src/engine/runtimes/` abstracts the differences between
agent backends. Every agent, regardless of backend, produces a PanCode worker
with the same dispatch, safety, and observability guarantees.

### Three Runtime Tiers

| Tier | Backend | Integration Depth |
|------|---------|-------------------|
| Native | Pi SDK agents | Full control (tools, model, prompt, safety, events) |
| SDK | Claude Agent SDK, OpenAI Agents SDK | Deep control, structured I/O |
| CLI | Headless subprocess (Claude Code, Codex, Gemini, etc.) | Task + CWD + system prompt |

### Runtime Interface (runtimes/types.ts)

Every runtime adapter implements the `AgentRuntime` interface:

```typescript
interface AgentRuntime {
  readonly id: string;
  readonly name: string;
  readonly tier: "native" | "sdk" | "cli";
  readonly available: boolean;
  spawn(config: RuntimeTaskConfig): Promise<RuntimeResult>;
}
```

The `spawn()` method takes a task configuration (task text, agent spec, model,
safety mode, working directory) and returns a result with exit code, output,
usage metrics, and error information.

### CLI Base Class (runtimes/cli-base.ts)

All CLI agent adapters extend a shared base class that handles:

- Binary PATH discovery (checking common installation paths)
- Subprocess spawning with proper environment setup
- Stdout/stderr capture and result parsing
- Timeout enforcement and signal forwarding
- Parent PID monitoring for orphan prevention

### Adapter Implementations

Each CLI adapter file implements the specifics for one agent:

- **claude-code.ts**: Claude Code (`claude`) with `--print` mode for headless
  operation, `--model` and `--system-prompt` passthrough
- **codex.ts**: OpenAI Codex CLI (`codex`) with `--quiet` mode
- **gemini.ts**: Google Gemini CLI (`gemini`) with headless flags
- **opencode.ts**: OpenCode (`opencode`) CLI adapter
- **cline.ts**: Cline headless mode adapter
- **copilot-cli.ts**: GitHub Copilot CLI adapter

### Runtime Discovery (runtimes/discovery.ts)

At boot, `discoverRuntimes()` scans the system PATH for known agent binaries.
Each discovered binary is registered in the runtime registry. The discovery
result is emitted as a `pancode:runtimes-discovered` event so other domains
(agents, ui) can react.

### Runtime Registry (runtimes/registry.ts)

A singleton registry that stores discovered runtime adapters. The dispatch
domain queries the registry to find the appropriate adapter for a given agent
spec's `runtime` field (e.g., `"pi"`, `"cli:claude-code"`, `"cli:codex"`).

## Import Enforcement

The boundary check runs as `npm run check-boundaries` and is part of the CI
gate. It scans all TypeScript files outside `src/engine/` for direct imports
from Pi SDK packages:

```
Files matching src/domains/**, src/core/**, src/cli/**, src/worker/**
must NOT contain: from "@pancode/pi-coding-agent"
must NOT contain: from "@pancode/pi-ai"
must NOT contain: from "@pancode/pi-tui"
```

Only `src/engine/**` may import from these packages.

## Upgrade Protocol

When the Pi SDK ships a new minor release:

1. Read the changelog for breaking changes
2. Create a branch: `upgrade/pi-X.Y`
3. Update the dependency version
4. Fix all breakage in `src/engine/` only (adapt wrappers, update re-exports)
5. Verify no domain file changed. If a domain file must change, the engine
   layer missed an abstraction point; fix the layer, not the domain.
6. Run `npm run typecheck && npm run check-boundaries && npm run lint`
7. Merge when green

## Cross-References

- [Architecture Overview](./overview.md): where the engine fits in the 5-layer model
- [Worker Isolation](./worker-isolation.md): how workers use the engine boundary
- [Adding Runtimes](../development/adding-runtimes.md): how to add a new CLI agent adapter
