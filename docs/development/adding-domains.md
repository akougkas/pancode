# Adding Domains

This guide walks through creating a new PanCode domain from scratch. A domain
is a composable unit of functionality with its own manifest, extension, tools,
commands, and state management.

## Prerequisites

Understand the existing domain architecture:
- [Domains](../architecture/domains.md): all 10 domains and their dependencies
- [Event System](../architecture/event-system.md): cross-domain communication
- [Engine Boundary](../architecture/engine-boundary.md): Pi SDK import rules

## Domain Structure

Every domain follows this file structure:

```
src/domains/<name>/
  manifest.ts      # Name and dependency declaration
  extension.ts     # Pi SDK ExtensionFactory (hooks, tools, commands)
  index.ts         # Public API barrel export
```

Additional implementation files are added as needed, but these three are
required.

## Step 1: Create the Manifest

The manifest declares the domain name and its dependencies. Create
`src/domains/<name>/manifest.ts`:

```typescript
import type { DomainManifest } from "../../core/domain-loader";

export const manifest = {
  name: "<name>",
  dependsOn: [],
} as const satisfies DomainManifest;
```

### Dependency Rules

- List only direct dependencies. Transitive dependencies are resolved
  automatically by the topological sort.
- Every dependency must be another domain that exists in the registry.
- If a dependency is not enabled, the domain loader throws a hard error at boot.
- Circular dependencies are detected and produce a clear error message.

Example with dependencies:

```typescript
export const manifest = {
  name: "reporting",
  dependsOn: ["dispatch", "observability"],
} as const satisfies DomainManifest;
```

This means `reporting` loads after both `dispatch` and `observability`.

## Step 2: Create the Extension

The extension is a Pi SDK `ExtensionFactory` that registers hooks, tools, and
commands. Create `src/domains/<name>/extension.ts`:

```typescript
import { PiEvent } from "../../engine/events";
import { defineExtension } from "../../engine/extensions";

export const extension = defineExtension((pi) => {
  // Session initialization
  pi.on(PiEvent.SESSION_START, (_event, _ctx) => {
    // Initialize domain state here
  });
});
```

### Important Import Rules

- Import Pi SDK types and helpers **only** from `src/engine/`. Never import
  directly from `@pancode/pi-coding-agent` or other Pi SDK packages.
- Import core infrastructure from `src/core/`.
- Import from other domains only through their barrel exports (`index.ts`).

### Registering Event Hooks

Available Pi SDK events (from `src/engine/events.ts`):

| Event | When it fires |
|-------|--------------|
| `SESSION_START` | Session initialization (register subscriptions here) |
| `SESSION_SHUTDOWN` | Session teardown |
| `BEFORE_AGENT_START` | Before the LLM processes a user message |
| `MESSAGE_END` | After the LLM finishes a response |
| `MODEL_SELECT` | When a model is being selected |
| `CONTEXT` | When the LLM context is being assembled |
| `TOOL_CALL` | Before a tool call executes |
| `TOOL_EXECUTION_END` | After a tool call completes |

### Registering Tools

Tools are callable functions that the LLM can invoke. Use TypeBox schemas for
parameter validation:

```typescript
import { Type } from "@sinclair/typebox";
import { ToolName } from "../../core/tool-names";
import type { AgentToolResult } from "../../engine/types";

pi.registerTool({
  name: "my_tool_name",
  label: "My Tool",
  description: "Description the LLM reads to decide when to call this tool.",
  parameters: Type.Object({
    input: Type.String({ description: "The input value" }),
    verbose: Type.Optional(Type.Boolean({ description: "Show detailed output" })),
  }),
  async execute(_id, params) {
    const result = doSomething(params.input);
    return {
      content: [{ type: "text", text: result }],
      details: undefined,
    };
  },
});
```

Add the tool name constant to `src/core/tool-names.ts` if it does not exist.

### Registering Commands

Commands are user-invoked slash commands:

```typescript
pi.registerCommand("mycommand", {
  description: "Short description shown in /help",
  async handler(args, _ctx) {
    // args is the string after the command name
    // Use pi.sendMessage() to display output
    pi.sendMessage({
      customType: "panel",
      content: "Command output here",
      display: true,
      details: { title: "My Command" },
    });
  },
});
```

### Subscribing to Bus Events

For cross-domain communication, subscribe to SharedBus events in the
`SESSION_START` handler:

```typescript
import { BusChannel, type RunFinishedEvent } from "../../core/bus-events";
import { sharedBus } from "../../core/shared-bus";

pi.on(PiEvent.SESSION_START, (_event, _ctx) => {
  sharedBus.on(BusChannel.RUN_FINISHED, (payload) => {
    const event = payload as RunFinishedEvent;
    // React to dispatch completion
  });
});
```

### Emitting Bus Events

If your domain owns state that other domains need to observe, define new
channel constants in `src/core/bus-events.ts` and emit via SharedBus:

```typescript
sharedBus.emit("pancode:my-event", { key: "value" });
```

## Step 3: Create the Barrel Export

Create `src/domains/<name>/index.ts` to expose the public API:

```typescript
export { manifest } from "./manifest";
export { extension } from "./extension";

// Export any public functions other domains need
export { getMyState } from "./state";
```

Keep the barrel export minimal. Only export what other domains actually need.

## Step 4: Register the Domain

Add the domain to the registry in `src/domains/index.ts`:

```typescript
import { extension as mydomainExtension, manifest as mydomainManifest } from "./mydomain";

export const DOMAIN_REGISTRY = {
  // ... existing domains ...
  mydomain: { manifest: mydomainManifest, extension: mydomainExtension },
} satisfies DomainRegistry;
```

## Step 5: Enable the Domain

Add the domain name to the enabled domains list. Either:

1. Add it to `DEFAULT_ENABLED_DOMAINS` in `src/core/defaults.ts` (for
   always-on domains)
2. Let users enable it via environment variable or configuration (for
   optional domains like `intelligence`)

## Step 6: Verify

Run the verification gate:

```bash
npm run typecheck && npm run check-boundaries && npm run build && npm run lint
```

The boundary check verifies that your new domain does not import directly from
Pi SDK packages. The typecheck verifies that your manifest, extension, and
barrel export types are correct.

## State Management

If your domain needs persistent state:

1. Create a state file in `.pancode/` (e.g., `.pancode/mystate.json`)
2. Read on construction, write on mutation
3. Use atomic writes via `atomicWriteTextSync()` from `src/core/config-writer.ts`
4. Implement a ring buffer if the data can grow unbounded

```typescript
import { atomicWriteTextSync } from "../../core/config-writer";

function saveState(runtimeRoot: string, state: MyState): void {
  const filePath = join(runtimeRoot, "mystate.json");
  atomicWriteTextSync(filePath, JSON.stringify(state, null, 2));
}
```

## Common Patterns

### Registering Pre-Flight Checks with Dispatch

If your domain needs to gate dispatch admission:

```typescript
import { registerPreFlightCheck } from "../dispatch";

pi.on(PiEvent.SESSION_START, (_event, _ctx) => {
  registerPreFlightCheck("my-gate", (context) => {
    if (shouldBlock(context)) {
      return { admit: false, reason: "Explanation for why dispatch is blocked" };
    }
    return { admit: true };
  });
});
```

### Reading State from Other Domains

Import through barrel exports only:

```typescript
import { getBudgetTracker } from "../scheduling";
import { getSpecRegistry } from "../agents";

const budget = getBudgetTracker();
const registry = getSpecRegistry();
```

Never import internal files from other domains. If you need something that is
not exported, ask the owning domain to add it to their barrel export.

## Checklist

- [ ] `manifest.ts` with correct name and dependencies
- [ ] `extension.ts` using `defineExtension()` from engine
- [ ] `index.ts` barrel export
- [ ] Domain registered in `src/domains/index.ts`
- [ ] Domain enabled (defaults or config)
- [ ] Tool names added to `src/core/tool-names.ts` (if registering tools)
- [ ] Bus channels added to `src/core/bus-events.ts` (if emitting events)
- [ ] `npm run typecheck` passes
- [ ] `npm run check-boundaries` passes
- [ ] No direct Pi SDK imports outside `src/engine/`

## Cross-References

- [Domains](../architecture/domains.md): complete domain reference
- [Engine Boundary](../architecture/engine-boundary.md): import rules
- [Event System](../architecture/event-system.md): bus event patterns
- [Adding Runtimes](./adding-runtimes.md): adding CLI agent adapters
