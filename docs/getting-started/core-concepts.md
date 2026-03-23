# Core Concepts

PanCode orchestrates coding agents the way Kubernetes orchestrates containers.
It discovers agents installed on the user's machine, composes them into
workflows, dispatches them as isolated subprocesses, and observes everything
from one terminal.

This document introduces the conceptual foundations you need before diving into
the architecture or configuration guides.

## The Pan Taxonomy

"Pan" means "all." PanCode's name reflects six dimensions of universality:

### Pan-provider

PanCode works with any LLM provider. Local inference engines (Ollama, LM Studio,
llama.cpp), cloud APIs (Anthropic, OpenAI, Google, Groq, Together, Mistral),
and mixed configurations where the orchestrator uses one provider while workers
use another.

At boot, PanCode probes configured endpoints to discover available models. The
discovery results are cached in `~/.pancode/model-cache.yaml` for fast
subsequent starts.

### Pan-model

PanCode routes tasks to models by capability and cost. A high-reasoning model
handles the orchestrator's planning. A fast, cheap model handles worker tasks.
A lightweight model handles scout exploration. The user configures this through
presets or environment variables:

- `PANCODE_MODEL`: orchestrator model
- `PANCODE_WORKER_MODEL`: worker model
- `PANCODE_SCOUT_MODEL`: scout/shadow model

### Pan-runtime

PanCode supports three runtime tiers for agent execution:

| Tier | Backend | Integration Depth |
|------|---------|-------------------|
| Native | PanCode native agents | Full control: tools, model, prompt, safety, events |
| SDK | Claude Agent SDK, OpenAI Agents SDK, Mastra | Deep control, structured I/O |
| CLI | Headless subprocess | Task + CWD + system prompt |

Every agent, regardless of its backend, produces a PanCode worker with the same
dispatch, safety, and observability guarantees.

### Pan-agent

PanCode discovers and registers agents automatically. At boot, it scans PATH
for known agent binaries (Claude Code, Codex, Gemini CLI, OpenCode, Cline,
Copilot CLI). Each discovered binary becomes a registered agent that PanCode
can dispatch.

Users define additional agents in `~/.pancode/panagents.yaml` with custom
system prompts, tool sets, and model assignments.

### Pan-safety

PanCode applies a unified safety model across all runtimes and agents. The same
policy matrix governs what actions are allowed, regardless of whether the worker
is a native agent or a CLI subprocess. Workers cannot escalate their own
permissions beyond what the orchestrator grants.

### Pan-observe

PanCode provides unified observability across all agents: cost tracking, token
usage, turn counts, tool call monitoring, heartbeat health, and structured audit
trails. The observability domain collects metrics from all dispatch runs through
bus events.

## Three-Tier Runtime Model

PanCode does not compete with individual coding agents on code quality. It is
the conductor, not an instrument. Any coding agent installed on the user's
machine becomes a managed, observable, coordinated PanCode worker.

### Native Tier

Native agents run inside PanCode's process model with full control over tools,
model selection, prompt injection, safety enforcement, and lifecycle events.
This is the highest-fidelity integration.

### SDK Tier

SDK agents (Claude Agent SDK, OpenAI Agents SDK) provide programmatic control
with structured input/output. PanCode wraps them in its worker model for
consistent dispatch and safety.

### CLI Tier

CLI agents run as headless subprocesses. PanCode passes a task, working
directory, and system prompt. The agent runs independently and returns output.
Adding a new CLI agent requires implementing one TypeScript adapter file that
specifies the binary name, CLI flags for headless mode, and output parsing.

The CLI tier currently supports:
- Claude Code (`claude --print`)
- OpenAI Codex (`codex --quiet`)
- Google Gemini CLI (`gemini`)
- OpenCode (`opencode`)
- Cline (headless mode)
- GitHub Copilot CLI

## Workers and Agents

Understanding the distinction between agents and workers is important:

- An **agent** is a definition: a name, model assignment, system prompt, tool
  set, and runtime type. Agents are defined in `~/.pancode/panagents.yaml` or
  discovered automatically via PATH scanning.
- A **worker** is a running instance of an agent. When PanCode dispatches an
  agent, it creates a worker subprocess. Multiple workers can run the same
  agent definition concurrently.

The orchestrator manages workers through the dispatch system. It can run single
workers, parallel batches, and sequential chains. Each worker is isolated in its
own subprocess with its own safety policy.

## Activity Modes

PanCode operates in one of four activity modes. Modes control what the
orchestrator does with user input by physically gating which tools the LLM sees.

| Mode | Purpose | Dispatch | File Mutations |
|------|---------|----------|----------------|
| **Admin** | System management and diagnostics | Yes | No |
| **Plan** | Analysis and exploration | No | No |
| **Build** | Full development workflow | Yes | Yes |
| **Review** | Quality checks and analysis | Yes | No |

Modes are switched with keyboard shortcuts:
- **Shift+Tab**: cycle through plan, build, review
- **Alt+A**: toggle Admin mode (excluded from cycle to prevent accidental activation)

Mode is the outer gate. It determines which tools the LLM can see. If a tool is
not visible, the LLM cannot call it. This is a structural constraint, not a
policy check.

## Safety Levels

Safety levels control how much autonomy the system has. They are the inner gate,
evaluated after mode determines tool visibility.

| Level | Description |
|-------|-------------|
| **suggest** | Read-only. No file writes, no bash execution, no dispatch. |
| **auto-edit** | Standard autonomy. File writes, bash, and dispatch allowed. Destructive operations blocked. |
| **full-auto** | Maximum autonomy. Most operations allowed. Destructive bash requires confirmation. |

Safety levels are switched with **Ctrl+Y** or configured via presets.

The interaction between modes and safety:

```
User input
  → Mode filter: is the tool visible?
  → Safety filter: is this action allowed?
  → Execute or block
```

Build mode + suggest safety: the LLM sees dispatch tools but safety blocks
dispatch calls because they require auto-edit or higher.

Plan mode + full-auto safety: the LLM never sees dispatch tools, so safety
never fires for dispatch. Mode prevents the attempt structurally.

See [Safety](../guides/safety.md) for the complete behavioral model.

## The Kubernetes Analogy

PanCode's relationship to coding agents mirrors Kubernetes' relationship to
containers:

| Kubernetes | PanCode |
|-----------|---------|
| Container | Worker (isolated subprocess) |
| Pod | Dispatch unit (single worker or batch) |
| Deployment | Agent definition (desired state) |
| Scheduler | Dispatch + scheduling domains |
| kubectl | PanCode CLI + TUI |
| Node | Machine (local or cluster node) |
| Health probe | Worker heartbeat monitoring |
| Resource limits | Budget ceiling + per-run limits |
| RBAC | Safety levels + scope enforcement |

The user describes what they want (a task). PanCode determines which agent
handles it, where it runs, with what permissions, and monitors the result. The
user dispatches by capability, not by backend.

## Domain Architecture

PanCode is composed of 10 domains, each responsible for a specific concern:

| Domain | Responsibility |
|--------|---------------|
| safety | Tool call policy enforcement, action classification |
| session | Lifecycle coordination, cross-agent context sharing |
| agents | Agent discovery, spec registry, worker pool |
| prompts | System prompt compilation for orchestrator, workers, scouts |
| dispatch | Worker spawning, run lifecycle, result collection |
| observability | Metrics, audit trail, receipts, diagnostics |
| scheduling | Budget tracking, cluster coordination |
| intelligence | Adaptive dispatch planning (experimental, disabled by default) |
| panconfigure | Runtime configuration tools |
| ui | TUI presentation, keyboard shortcuts, theming |

Domains are loaded in dependency order via topological sort. Each domain
declares its dependencies in a manifest. Adding a new domain requires only
writing two files: `manifest.ts` and `extension.ts`.

See [Domains](../architecture/domains.md) for the complete domain reference.

## Presets

Presets are named boot configurations stored in `~/.pancode/panpresets.yaml`.
Each preset defines the orchestrator model, worker model, scout model, reasoning
level, and safety mode.

```yaml
local:
  description: "Local inference via homelab engines"
  model: "qwen2.5-coder:32b"
  workerModel: "qwen2.5-coder:7b"
  scoutModel: "qwen2.5-coder:3b"
  reasoning: medium
  safety: auto-edit
```

Apply a preset at boot with `pancode --preset local` or switch during a session
with the `/preset` command.

See [Modes and Presets](../guides/modes-and-presets.md) for configuration details.

## What PanCode Is NOT

Understanding what PanCode is not clarifies its value:

- **Not a chatbot.** PanCode orchestrates agents. It does not compete with them
  on chat quality.
- **Not a plugin.** PanCode is the runtime. Agents are plugins to PanCode, not
  the other way around.
- **Not a cloud service.** PanCode is local-first. It runs on the user's machine.
- **Not a model provider.** Users bring their own models and providers.
- **Not an IDE extension.** PanCode is terminal-native, running inside tmux.
- **Not a competitor to any single agent.** PanCode is the conductor, not an
  instrument. It makes every agent better by adding orchestration, safety, and
  observability.

## Next Steps

- [Architecture Overview](../architecture/overview.md): understand the 5-layer
  system architecture
- [Safety](../guides/safety.md): learn the 4-layer behavioral model
- [Dispatch](../guides/dispatch.md): understand the dispatch pipeline
- [Modes and Presets](../guides/modes-and-presets.md): configure PanCode for
  your workflow
