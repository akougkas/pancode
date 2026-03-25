# PanCode Documentation

PanCode orchestrates coding agents the way Kubernetes orchestrates containers.

## Guides

- [Getting Started](./getting-started/installation.md): install, configure, first dispatch
- [Architecture](./architecture/overview.md): system layers, domain model, engine boundary
- [Configuration](./guides/configuration.md): environment variables, presets, agent specs
- [Domains](./architecture/domains.md): the 10 composable domains and their commands
- [Dispatch](./guides/dispatch.md): worker lifecycle, runtimes, batch and chain dispatch
- [Development](./development/contributing.md): build, test, contribute, and extend PanCode
- [Demo Scenarios](./demos.md): reproducible demos for launch

## For Coding Agents

If you are an AI coding agent working on this codebase, start with
[Development](./development/contributing.md) for build commands and architectural
constraints, then [Architecture](./architecture/overview.md) for the layer model.

If behavior and help text disagree, trust domain extension files such as
`src/domains/session/extension.ts` and `src/domains/ui/extension.ts`, plus
`src/engine/shell-overrides.ts`, over `src/core/shell-metadata.ts`.
