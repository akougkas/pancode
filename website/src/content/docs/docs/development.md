---
title: Development Guide
---

# Development

This page is for human developers and coding agents who will change the code.

## Build Commands

```bash
npm run build              # Production build (Pi SDK + tsup)
npm run typecheck          # Must pass before commit
npm run check-boundaries   # Engine + worker isolation
npm run dev                # Dev mode (tsx, skips tmux)
pancode --preset local     # Launch in tmux (production path)
```

Useful extras:

```bash
npm run lint
npm run check-prompts
```

## Architecture Constraints

Read this before editing code:

- `src/engine/` is the only place that imports `@pancode/pi-*`
- `src/worker/` never imports from `src/domains/`
- Most PanCode-specific slash commands are registered by domains via `pi.registerCommand()`
- Pi builtin slash commands are hidden, passed through, or rerouted in `src/engine/shell-overrides.ts`
- No domain mutates another domain's state directly
- Shared cross-domain events go through `src/core/bus-events.ts` and `src/core/shared-bus.ts`
- Tool names live in `src/core/tool-names.ts`
- Bus channel names live in `src/core/bus-events.ts`

## Source Of Truth

When documentation, `/help`, and runtime behavior disagree, trust the code in
this order:

1. Command handlers in domain extension files
   For example: `src/domains/session/extension.ts` or `src/domains/ui/extension.ts`
2. Pi builtin patches in `src/engine/shell-overrides.ts`
3. Runtime and worker entry points in `src/engine/runtimes/` and `src/worker/`
4. Display metadata in `src/core/shell-metadata.ts`

Important distinction:

- `src/core/shell-metadata.ts` is the categorized help registry
- It is not the execution source of truth
- Some command names there are wrappers over Pi builtins or prototype patches
- Document behavior from handlers and patches, not from labels

## Adding A New Domain

1. Create a new domain folder with `manifest.ts`
2. Create `extension.ts` inside that folder
3. Add the domain to `src/domains/index.ts`
4. Update any docs or shell metadata that mention the command surface

## Adding A New Runtime Adapter

1. Implement the `AgentRuntime` interface in `src/engine/runtimes/`
2. Add the adapter to `src/engine/runtimes/discovery.ts`
3. If the runtime needs custom parsing, implement it in the adapter file
4. Keep the adapter thin. Do not let domain code import runtime-specific APIs

## Code Style

- Biome with 120-character lines
- 2-space indentation
- Double quotes
- Semicolons
- Conventional Commits
- No emojis
- No em dashes

## Git Workflow

- Stage specific files only
- Never run `git add -A`
- Never force-push
- Use conventional commit messages

## Handoff Rule

When you are done, verify with:

- `npm run typecheck`
- `npm run build`

If you changed docs only, still run the checks. The package version and build
surface need to stay coherent.
