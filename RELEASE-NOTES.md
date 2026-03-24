# PanCode v0.3.0-exp

Experimental Preview Release

## What is PanCode

PanCode is a composable multi-agent runtime for software engineering. It orchestrates coding agents the way Kubernetes orchestrates containers, turning any agent installed on your machine into a managed, observable, coordinated worker.

## Why Experimental

This is the first public preview of PanCode. The core architecture is stable and the feature set is functional, but the project has not yet been battle-tested across diverse environments. Configuration formats, CLI interfaces, and internal APIs may change between releases as we incorporate feedback. We are shipping early to get real-world input, not because we believe the surface area is frozen.

What works well today:

- Launching sessions with tmux lifecycle management
- Dispatching workers across 7 runtime adapters
- Constitutional prompt compilation across agents and modes
- Conversational configuration through the orchestrator
- Runtime discovery of installed CLI agents
- Local AI inference with Ollama, LM Studio, and llama.cpp

What is still rough:

- Error messages could be more descriptive in edge cases
- Some adapter integrations depend on specific CLI versions
- Documentation coverage is growing but incomplete

## Highlights

- **7 runtime adapters** bring Claude Code, Codex, Gemini CLI, OpenCode, Cline, and Copilot CLI under one dispatch and safety layer alongside native workers.
- **4 orchestrator modes** (Admin, Plan, Build, Review) structurally gate tool visibility, dispatch permissions, and mutation capabilities.
- **Constitutional prompt system** compiles typed prompt fragments per role, tier, and mode, enforcing behavioral rules across all agents and runtimes.
- **Dispatch pipeline with receipts** provides admission gating, recursion guards, heartbeat monitoring, batch launches, and audit-ready reproducibility receipts.
- **10 composable domains** load in topological order from manifests, each with independent state and slash command registration.
- **Conversational configuration** replaces settings menus with natural language. Ask the orchestrator to change safety levels, models, budgets, or presets.
- **Provider-agnostic local-first design** supports local engines (Ollama, LM Studio, llama.cpp) and cloud APIs through a unified provider registry.

## Known Limitations

- Multi-node dispatch across machines is not yet implemented. Workers currently run on the local machine only.
- SDK agent adapters (Claude Agent SDK, OpenAI Agents SDK, Mastra) are planned but not yet available. Current adapters are CLI-based.
- Dynamic model routing with cost-aware selection is not yet implemented. Model assignment is currently static per agent.
- The web dashboard companion is not yet available. All interaction is terminal-based.
- Plugin system for third-party domain extensions is not yet implemented.
- Agent marketplace and community skill sharing are planned for future releases.
- tmux is required. There is no non-tmux execution mode.

## What's Next

The roadmap includes multi-node fleet dispatch for distributing workers across machines, SDK agent adapters for deep programmatic integration with Claude Agent SDK and OpenAI Agents SDK, dynamic model routing with cost-aware task assignment, an agent marketplace for community-contributed agent definitions, team-based multi-agent workflows, and a web dashboard companion for fleet monitoring. No dates or timelines are promised for any of these capabilities.

## Installation

```bash
npm install -g pancode@exp
```

Requires Node.js 20 or newer and tmux.

```bash
pancode                    # Start a new session
pancode --preset local     # Start with local inference
```

## Feedback

Bug reports, feature requests, and general feedback are welcome at [GitHub Issues](https://github.com/akougkas/pancode/issues).
