# Contributing Guide

This document covers the development workflow, build system, architecture constraints, and conventions for contributing to PanCode.

## Build System

PanCode uses a two-stage build: Pi SDK workspace packages first, then the main application via tsup.

### Build Commands

```bash
npm run build            # Full production build (Pi SDK + tsup)
npm run build:pi         # Build Pi SDK packages only
npm run dev              # Dev mode (tsx, skips tmux)
npm run typecheck        # TypeScript strict mode check
npm run check-boundaries # Verify engine/worker import isolation
npm run lint             # Biome linter
```

### Build Order

1. `build:pi-tui` (Pi TUI framework)
2. `build:pi-ai` (Pi AI abstractions)
3. `build:pi-agent-core` (Pi agent core)
4. `build:pi-coding-agent` (Pi coding agent)
5. `tsup` (PanCode application bundle)

### Pre-Commit Checklist

Every commit must pass:

```bash
npm run typecheck && npm run check-boundaries && npm run build && npm run lint
```

## Architecture Constraints

These are non-negotiable architectural rules. Violations break the boundary checker.

### Engine Boundary

`src/engine/` is the sole import boundary for Pi SDK packages. No file outside `src/engine/` may import from `@pancode/pi-coding-agent`, `@pancode/pi-ai`, `@pancode/pi-tui`, or `@pancode/pi-agent-core`.

```
src/engine/          # ONLY directory that imports @pancode/pi-*
  events.ts          # Pi event type re-exports
  extensions.ts      # defineExtension wrapper
  resources.ts       # ResourceLoader, SessionManager, SettingsManager
  session.ts         # createAgentSession, ModelRegistry, tools
  shell.ts           # PanCodeInteractiveShell
  tui.ts             # TUI component re-exports
  types.ts           # Type re-exports
  runtimes/          # Runtime adapters (pi, cli)
```

### Worker Isolation

`src/worker/` is physically isolated from `src/domains/`. Workers run as separate subprocesses and cannot import domain code.

```
src/worker/          # CANNOT import from src/domains/
  entry.ts           # Worker process entry point
  safety-ext.ts      # Worker-side safety enforcement
  provider-bridge.ts # Worker-side model resolution
```

### Domain Independence

Each domain in `src/domains/` has:
- `manifest.ts`: Metadata and dependency declarations
- `extension.ts`: Behavior (event handlers, commands, tools)

No domain may mutate another domain's state directly. Cross-domain communication uses `SafeEventBus` via `sharedBus`.

### The 10 Domains

| Domain | Purpose |
|--------|---------|
| safety | Tool call interception, action classification, YAML rules |
| session | Context registry, shared board, memory, checkpoints |
| agents | Agent specs, runtime discovery, worker pool |
| prompts | Prompt compilation, versioning, fragment management |
| dispatch | Worker spawning, batch/chain dispatch, task management |
| observability | Metrics, audit trail, health checks, receipts |
| scheduling | Budget tracking, cost admission |
| panconfigure | Conversational configuration tools |
| ui | Dashboard, footer, editor, commands, theme |
| intelligence | Opt-in learning and rules upgrade |

## Code Style

### TypeScript

- Strict mode enabled
- No `any` unless necessary for Pi SDK JSON events
- Use `@sinclair/typebox` for runtime type definitions

### Biome Configuration

- Line width: 120 characters
- Indent: 2 spaces
- Quotes: double
- Semicolons: always

### Prose Style

Never write `[noun] - [parenthetical clause]` sentence structures. This pattern uses a dash to interrupt a sentence with a subordinate clause and is banned everywhere: code comments, commit messages, documentation, and responses.

Bad: `Engine boundary - only src/engine/ imports Pi SDK packages.`
Good: `The engine boundary restricts Pi SDK imports to src/engine/.`

## Commit Conventions

Use Conventional Commits format:

```
feat(dispatch): add batch dispatch support
fix(safety): correct action classifier for bash commands
docs: update configuration guide
chore: upgrade TypeScript to 5.7
refactor(prompts): extract fragment compiler
```

Scopes match domain names: `dispatch`, `safety`, `session`, `agents`, `prompts`, `observability`, `scheduling`, `panconfigure`, `ui`, `intelligence`, `engine`, `worker`, `core`, `cli`.

## Git Rules

- Stage specific files by name. Never use `git add -A` or `git add .`.
- Never force-push or amend published commits.
- Never run destructive operations: `git reset --hard`, `git rebase`, `git branch -D`, `git clean -f`.
- If you need to undo changes, use `git revert` (creates a new commit).

## Testing Philosophy

PanCode does not use traditional test files. Verification is inline:

1. `npm run typecheck`: Type safety
2. `npm run check-boundaries`: Import isolation
3. `npm run build`: Production build succeeds
4. `npm run lint`: Code style compliance

For specific features, the orchestrator provides verification commands:

```
/doctor       # Health checks
/receipt verify <id>  # Receipt integrity
/skills validate      # Skill tool requirements
```

## Project Structure

```
src/
  cli/           # CLI subcommands (up, down, sessions, etc.)
  core/          # Shared utilities (config, events, modes, thinking)
  domains/       # 10 composable domains
  engine/        # Pi SDK boundary layer
  entry/         # Orchestrator entry point
  loader.ts      # Top-level loader and environment setup
  worker/        # Isolated worker process code
```

## Runtime Requirements

- Node.js >= 20
- npm (workspace support)
- TypeScript 5.7 (strict mode)
- Dependencies: `@sinclair/typebox`, `yaml`

## See Also

- [Configuration Reference](../reference/configuration-reference.md): Full config schema
- [Commands Reference](../reference/commands.md): All slash commands
- [Quick Start](../getting-started/quick-start.md): First-time setup
