# AGENTS.md

Instructions for AI coding agents working on the PanCode codebase.

## What is PanCode

PanCode is a composable multi-agent runtime for software engineering. It orchestrates coding agents (Claude Code, Codex, Gemini CLI, OpenCode, Copilot CLI, and native workers) through a unified dispatch, safety, and observability layer. The codebase is TypeScript strict mode, built on a vendored SDK with a strict engine boundary that isolates all SDK imports to `src/engine/`.

## Quick Setup

```bash
git clone https://github.com/akougkas/pancode.git
cd pancode
npm install
npm run build
npm run typecheck
```

## Build Commands

| Command | What It Does |
|---------|-------------|
| `npm run build` | Builds vendored SDK packages, then bundles with tsup |
| `npm run build:pi` | Builds only the vendored SDK packages |
| `npm run dev` | Runs in dev mode with tsx, skips tmux |
| `npm run typecheck` | Builds SDK packages, runs boundary check, runs prompt check, runs tsc --noEmit |
| `npm run check-boundaries` | Verifies engine boundary and worker isolation invariants |
| `npm run check-constitution` | Audits constitutional prompt fragments across all role/tier/mode combinations |
| `npm run check-prompts` | Validates prompt fragment references |
| `npm run lint` | Runs Biome linter on src/ |
| `npm run smoke-test` | Baseline smoke test |
| `npm run verify-tui` | TUI width-safety regression harness |

## Architecture Rules

### Engine Boundary

`src/engine/` is the sole import boundary for vendored SDK packages (`@pancode/pi-coding-agent`, `@pancode/pi-ai`, `@pancode/pi-tui`, `@pancode/pi-agent-core`). No file outside `src/engine/` may import from these packages. The `check-boundaries` script enforces this at build time.

### Worker Isolation

`src/worker/` is physically isolated. It cannot import from `src/domains/`. Every worker runs as a separate subprocess with no shared memory, event loop, or file descriptors. The `check-boundaries` script also enforces this.

### Domain Independence

Each domain in `src/domains/` is self-contained with a `manifest.ts` (metadata, dependencies) and an `extension.ts` (runtime registration). No domain mutates another domain's state. Cross-domain communication goes through `SafeEventBus` in `src/core/event-bus.ts`.

## Code Style

- **TypeScript 5.7 strict mode.** No `any` unless absolutely necessary for SDK JSON events.
- **Biome formatter.** 120-character lines, 2-space indent, double quotes, semicolons always.
- **Conventional Commits.** `feat(scope):`, `fix(scope):`, `docs:`, `chore:`.
- **No emojis.** Professional tone in all code, comments, and output.
- **Atomic file writes.** Use temp file + rename for all state persistence.

## File Organization

```
src/
  cli/            CLI commands (start, up, down, sessions, login, version, reset)
  core/           Foundation (config, modes, event bus, presets, agent profiles)
  domains/        10 composable domains, each with manifest.ts + extension.ts
    agents/       Agent fleet management, worker pool, discovery
    dispatch/     Worker dispatch pipeline, receipts, batching, health monitoring
    intelligence/ Intelligence gating and routing (experimental)
    observability/ Cost tracking, metrics, token counting, dispatch ledger
    panconfigure/ Conversational configuration tools
    prompts/      Constitutional prompt compilation (fragments, compiler, tiering)
    providers/    Provider registry, model matching, engine discovery
    safety/       Safety levels, action classification, scope contracts, audit trail
    scheduling/   Budget tracking and task scheduling
    session/      Session lifecycle, checkpoints, persistence
    ui/           TUI dashboard, panels, footer, editor, responsive layout
  engine/         SOLE SDK IMPORT BOUNDARY
    runtimes/     Runtime abstraction layer
      adapters/   CLI adapters (claude-code, codex, gemini, opencode, copilot-cli)
                  SDK adapters (claude-sdk, claude-sdk-remote)
  entry/          Orchestrator entry point and bootstrap
  worker/         ISOLATED worker subprocess entry point and safety extension
```

## Adding Features

### New Domain

1. Create a directory under `src/domains/<name>/`.
2. Add `manifest.ts` exporting domain metadata (id, version, dependencies).
3. Add `extension.ts` exporting the `activate` function that registers slash commands and tools.
4. The domain loader in `src/core/domain-loader.ts` discovers and loads domains in topological order based on manifest dependencies.

### New Runtime Adapter

1. Create a new file in `src/engine/runtimes/adapters/<name>.ts`.
2. Implement the `AgentRuntime` interface (see `claude-code.ts` for CLI adapters or `claude-sdk.ts` for SDK adapters).
3. Register the adapter in `src/engine/runtimes/discovery.ts`.

### New Slash Command

Register commands in the domain's `extension.ts` using `registerCommand`. Each domain owns its own commands. Do not register commands for other domains.

## Verification Checklist

Run these before committing any changes:

```bash
npm run typecheck          # TypeScript + boundary + prompt checks
npm run check-boundaries   # Engine and worker isolation
npm run build              # Full production build
npm run lint               # Biome linter
```

All four must pass. If `typecheck` fails, fix it before proceeding.

## Banned Patterns

- **No `git add -A` or `git add .`.** Stage specific files by name.
- **No force push.** Never `git push --force`.
- **No SDK imports outside engine.** Only `src/engine/` may import `@pancode/pi-*`.
- **No domain imports in worker.** `src/worker/` cannot import from `src/domains/`.
- **No cross-domain state mutation.** Use `SafeEventBus` for cross-domain communication.
- **No em dashes as clause separators.** Do not write `[noun] - [parenthetical clause]` sentence structures.
- **No emojis** in code, comments, or commit messages.

## Key Files to Read First

| File | Purpose |
|------|---------|
| `.claude/CLAUDE.md` | Project rules, build commands, architecture constraints, sprint context |
| `.specs/PAN-ARCHITECTURE.md` | Full architecture specification |
| `.specs/PAN-IDENTITY.md` | Brand identity and positioning |
| `.specs/PAN-MODES.md` | 4-layer behavioral model (modes, safety, fleet, infrastructure) |
| `src/core/config.ts` | Runtime configuration schema and defaults |
| `src/core/domain-loader.ts` | Domain manifest discovery and topological loading |
| `src/core/event-bus.ts` | SafeEventBus for cross-domain events |
| `src/engine/index.ts` | Engine boundary entry point |
