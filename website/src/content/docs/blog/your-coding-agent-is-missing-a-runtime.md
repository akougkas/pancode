---
title: "Your Coding Agent Is Missing a Runtime"
description: "The problem with coding agents isn't the agents themselves — it's the missing layer underneath them. PanCode is the runtime that makes them work together."
---

You installed Claude Code. Maybe Codex CLI too. You gave one of them a task, it ran for a while, burned some tokens, and shipped something decent. Then you needed a second opinion, so you opened Gemini CLI in another tab. Copy-pasted context. Lost the thread. Started over.

Now multiply that by a real workday. Three agents. Five tasks. Two local models. One cloud API with rate limits. No shared safety policy. No cost tracking. No way to know which agent is even appropriate for what you're asking.

This is where most developers are right now. And the problem is not the agents. The agents are fine. The problem is that nobody built the layer underneath them.

That is what PanCode is.

## What a coding agent actually does

Before I explain why the runtime matters, it helps to be precise about what a coding agent does when it works well. There are roughly six things happening under the hood of any good coding tool, whether it is Claude Code, Codex, Cursor, or anything else.

**It reads your project before it acts.** A good agent knows your git branch, your directory layout, your README, your test commands. It does not start from zero every time you ask a question. It builds a workspace snapshot and carries that forward.

**It caches what does not change.** The system instructions, the tool descriptions, the project summary — these stay mostly stable across turns. A well-built agent separates the stable prefix from the changing parts (your latest request, the recent conversation) so it is not reprocessing the same information on every single call.

**It uses tools, not prose.** Instead of suggesting "you could run pytest," a real agent runs pytest, reads the output, and acts on the result. But tool access needs structure — named tools, validated arguments, approval gates, path restrictions. The agent gets less freedom but becomes more reliable.

**It fights context bloat.** Coding sessions produce enormous amounts of text. File reads, command outputs, error logs, conversation history. If you shove everything into the context window, the model drowns in noise. Good agents clip long outputs, deduplicate repeated file reads, and compress older history while keeping recent events detailed.

**It remembers across turns.** There is a difference between the full transcript of everything that happened and the distilled working memory of what matters right now. The transcript is your audit trail. The working memory is what the agent actually uses to stay on task.

**It delegates.** Sometimes the agent needs a side answer — which file defines a function, why a test is failing, what a config says. Instead of cramming that work into the main thread, it spins up a child agent with constrained permissions, gets the answer, and moves on.

These six capabilities are not optional extras. They are table stakes. If your coding agent does not do all of them, it is a chatbot with file access.

## The problem nobody is solving

Here is the thing. Every coding agent on your machine implements these six capabilities independently. Claude Code has its own context management, its own tool system, its own memory, its own subagent spawning. Codex has a completely separate version of all of those. Gemini CLI has another. Your local model running through Ollama has none of them.

When you use one agent at a time, this is fine. But the moment you want to use two agents on the same project — or pick the right agent for the right task — or track what you are spending — or enforce consistent safety rules — you are on your own.

There is no shared dispatch. No shared safety. No shared observability. No way to say "use the fast local model for reconnaissance and the frontier model for the hard implementation work." No way to get a receipt that tells you what happened, what it cost, and whether it worked.

The agents are silos. And running silos in parallel is not orchestration. It is chaos with extra terminals.

## PanCode is the runtime

PanCode treats coding agents the way Kubernetes treats containers. You do not care which container runtime is underneath. You care about scheduling, resource management, health checks, and policy. The runtime handles the rest.

When PanCode boots, it scans your machine. It finds Claude Code, Codex, Gemini CLI, OpenCode, Copilot CLI. It finds your local inference endpoints — LM Studio, Ollama, llama.cpp. It registers every one of them as a worker in a unified fleet. One control plane. One dispatch system. One safety model. One terminal.

```
$ pancode --preset hybrid
booting control plane...

discover scanning PATH for runtimes
ok claude-code        CLI        anthropic/claude-sonnet-4
ok codex              CLI        openai/codex-mini
ok gemini-cli         CLI        google/gemini-2.5-pro
ok native-worker      NATIVE     local/llama3.3-70b

summary 4 adapters   10 domains   receipts on   budget live
ready pancode v0.3.0-exp
```

From here, you talk to Panos — the orchestrator. You do not talk to Claude Code or Codex or Gemini directly. You describe work. Panos decides who does it.

## How the six capabilities change at fleet scale

Every one of those six agent capabilities I described earlier still matters. But when you are running a fleet instead of a single agent, each one works differently.

**Project context becomes a dispatchable task.** Instead of every agent independently scanning your repo, PanCode has a dedicated `scout` agent whose only job is fast codebase reconnaissance. It runs first, builds the context, and that context informs how Panos dispatches the real work. Context gathering is not a harness subroutine. It is a fleet operation.

**Prompt caching becomes prompt compilation.** A single agent caches one prefix. PanCode compiles structurally distinct prompts for each worker based on its role, safety level, and the current mode. The `builder` agent gets write tools. The `reviewer` does not. The `red-team` agent gets adversarial framing. All of them inherit the same constitutional policy. The prompt is not a static prefix. It is a compiled artifact.

**Tool access becomes two-axis gating.** PanCode enforces tool permissions along two independent axes. The first is the orchestrator mode — Plan cannot write files, Review cannot mutate code, Build gets full access. The second is the safety level — suggest, auto-edit, or full-auto. These are orthogonal. You can be in Build mode with suggest-level safety, which means workers can write code but every mutation needs your approval. And because every worker runs as an isolated OS subprocess — no shared memory, no shared event loop — the sandbox is not a path check. It is a process boundary.

**Context isolation replaces context compression.** The hardest problem for a single agent is fitting everything into one context window without drowning in noise. PanCode sidesteps this entirely. Each worker gets its own context window. The orchestrator never sees the raw file reads, tool outputs, or intermediate reasoning from workers. It sees receipts. This is context isolation by architecture, not context compression by heuristic. The orchestrator stays sharp because it is never polluted by worker-level noise.

**Receipts replace transcripts.** Every dispatch produces a reproducibility receipt — worker identity, scope, tokens consumed, cost in dollars, wall time, and outcome classification. These receipts are not just logs. They are structured data you can query, compare, and reason about. Over time, the system learns which agents perform best on which kinds of tasks, which models are cost-efficient for which complexity tiers, and how your dispatch patterns evolve. The runtime gets smarter because the receipts feed back into dispatch decisions.

**Delegation becomes the core primitive.** A single agent treats subagent delegation as an optional extension — nice to have when you need a side answer. PanCode treats fleet dispatch as the fundamental operation that everything else is built around. Seven default agents ship out of the box, each with a dedicated role, tier classification, readonly flag, and speed profile. You can dispatch a single task, a parallel batch, or a sequential chain. Recursion depth is structurally limited. The fleet is the product.

## What this looks like in practice

You open PanCode. You say: "Review the authentication module and build rate limiting for the search endpoint."

Panos decomposes that into two dispatch units. The review goes to a `reviewer` agent backed by a mid-tier model in readonly mode. The implementation goes to a `builder` agent backed by a frontier model with write access. Both run as isolated subprocesses. Both produce receipts.

You hit `Shift+Tab` to switch to Review mode and read what the reviewer found. You hit it again to go to Build mode and check the builder's implementation. You run `/workers` to see the fleet status. You run `/costs` to see what the session has cost so far. Everything is in one terminal. One session. One control surface.

If the builder's output needs a security check, Panos dispatches the `red-team` agent against the diff. If documentation needs updating, the `documenter` handles it. You are not context-switching between tools. You are operating a fleet.

## Why this matters now

The coding agent landscape in 2026 is fragmented by design. Every vendor wants you locked into their agent, their model, their billing. That made sense when there was one good model. It does not make sense when there are fifteen good models and six viable coding agents, half of which are free and open source.

The value is moving from the model to the system around it. The harness matters more than the model. And the runtime matters more than the harness.

PanCode is that runtime. It is terminal-native, local-first, and Apache 2.0. It does not replace your agents. It makes them work together.

One runtime. Every agent.

---

*PanCode is in experimental preview (v0.3.0-exp). The APIs may shift. The architecture will not.*

*[pancode.dev](https://pancode.dev) · [GitHub](https://github.com/akougkas/pancode)*
