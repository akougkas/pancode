# Contributing to PanCode

Welcome to PanCode. We appreciate contributions of all kinds, from bug reports to
code changes to documentation improvements. PanCode is licensed under Apache 2.0.
By contributing, you agree that your contributions will be licensed under the same
terms.

## Getting Started

### Prerequisites

- Node.js 20 or later
- npm
- tmux
- git

### Setup

1. Fork the repository on GitHub.
2. Clone your fork:
   ```bash
   git clone https://github.com/<your-username>/pancode.git
   cd pancode
   ```
3. Install dependencies:
   ```bash
   npm install
   ```
4. Build the project:
   ```bash
   npm run build
   ```
5. Verify everything works:
   ```bash
   npm run typecheck && npm run check-boundaries && npm run build && npm run lint
   ```

## Development Workflow

1. Create a feature branch from `main`:
   ```bash
   git checkout -b feat/my-feature main
   ```
2. Make your changes.
3. Run the verification suite:
   ```bash
   npm run typecheck && npm run check-boundaries && npm run build && npm run lint
   ```
4. Commit using [Conventional Commits](https://www.conventionalcommits.org/) format.
5. Push your branch and open a pull request against `main`.

## Code Style

PanCode uses [Biome](https://biomejs.dev/) for formatting and linting.

- **Line length:** 120 characters max
- **Indentation:** 2 spaces
- **Quotes:** double quotes
- **Semicolons:** always
- **TypeScript:** strict mode (TypeScript 5.7)
- **Commits:** Conventional Commits format (`feat(scope):`, `fix(scope):`, `docs:`, `chore:`)

Do not use em dashes as clause separators in documentation, comments, or commit
messages. If you need to explain a noun, write a full sentence instead.

## Architecture Constraints

These constraints are non-negotiable. Pull requests that violate them will not be merged.

### Engine Boundary

Only files in `src/engine/` may import from the underlying SDK packages. No file
outside `src/engine/` should contain SDK package imports. The boundary checker
(`npm run check-boundaries`) enforces this automatically.

### Worker Isolation

`src/worker/` is physically isolated from `src/domains/`. Workers cannot import
domain code, and domains cannot import worker internals. All communication between
workers and domains flows through the engine layer.

### Domain Independence

Each domain in `src/domains/` owns its own state. No domain may mutate another
domain's state directly. Cross-domain communication uses SafeEventBus exclusively.

### Domain Structure

Every domain follows the same file layout:
- `manifest.ts` declares the domain metadata and capabilities
- `extension.ts` registers slash commands and event handlers
- `index.ts` re-exports public API

## Adding a New Domain

1. Create a new directory under `src/domains/<your-domain>/`.
2. Add `manifest.ts` with the domain metadata, following the pattern of existing
   domains.
3. Add `extension.ts` to register any slash commands and event handlers for
   this domain.
4. Add `index.ts` to re-export the public API.
5. Register the domain in the domain registry.
6. Run `npm run typecheck && npm run check-boundaries` to verify isolation.

## Adding a Runtime Adapter

1. Create a new adapter file under `src/engine/runtimes/`.
2. Implement the runtime adapter interface, following the pattern of existing
   adapters.
3. Register the adapter in the runtime registry.
4. Verify the engine boundary is maintained: `npm run check-boundaries`.

## Testing

PanCode uses inline verification rather than a traditional test suite. The
verification gate consists of:

```bash
npm run typecheck          # TypeScript type checking
npm run check-boundaries   # Engine and worker isolation enforcement
npm run build              # Production build
npm run lint               # Biome linting
npm run smoke-test         # End-to-end smoke test
```

All five checks must pass before a pull request can be merged.

## Pull Request Process

When you open a PR, reviewers will check for:

- All verification checks pass (`typecheck`, `check-boundaries`, `build`, `lint`)
- No SDK imports outside `src/engine/`
- No `src/domains/` imports in `src/worker/`
- Conventional Commit message format
- Code matches existing style and patterns
- Changes are focused and minimal

Fill out the PR template completely. Link related issues using `Fixes #N` or
`Relates to #N`.

## Reporting Issues

Use the [GitHub issue templates](https://github.com/akougkas/pancode/issues/new/choose)
to report bugs or request features. Check existing issues before filing a duplicate.
Include your PanCode version (`pancode version`), Node.js version, and operating
system when reporting bugs.
