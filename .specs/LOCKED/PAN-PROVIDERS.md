# PAN-PROVIDERS: Unified Provider System

**Status:** LOCKED
**Sprint:** sprint/providers
**Date:** 2026-03-24

---

## 1. Governing Principles

**PanCode is the runtime.** The word "runtime" belongs to PanCode. External agents,
inference engines, and SDKs are providers. PanCode discovers them, connects to them,
observes them, and orchestrates work through them. It does not become them.

**PanCode connects, it does not manage.** PanCode never handles authentication tokens,
subscription billing, or provider internals. Users bring their own CLIs, their own
subscriptions, their own configured tools. PanCode discovers what exists, observes
its state, and orchestrates through it.

**One registry, one domain.** All provider knowledge lives in `src/domains/pan-providers/`.
No other domain maintains shadow copies of provider state. Dispatch, agents, orchestrator,
and TUI read from the pan-providers registry.

**Observation over interference.** PanCode wraps provider telemetry (subscription tier,
usage quotas, remaining tokens, cost tracking) without managing or modifying it. Each
provider exposes different monitoring surfaces. PanCode normalizes that into a unified
observability model.

---

## 2. Provider Categories

Every provider belongs to exactly one category.

### 2.1 Native

PanCode's own Pi SDK execution path. The only category that imports from `@pancode/pi-*`.

| Property | Value |
|----------|-------|
| Examples | pi-coding-agent, pi-ai, pi-tui |
| Control mechanism | Direct SDK calls inside `src/engine/` |
| Model source | Local inference engines (Ollama, LM Studio, llamacpp) |
| Auth | None (local execution) |
| Streaming | NDJSON over subprocess stdout |

### 2.2 CLI

External coding agent CLIs that PanCode detects on the user's PATH.

| Property | Value |
|----------|-------|
| Examples | claude, codex, gemini, cline, opencode, copilot, aider |
| Control mechanism | Subprocess execution with stdout parsing |
| Model source | Each CLI manages its own model selection |
| Auth | Each CLI manages its own credentials |
| Streaming | Buffered JSON on exit (most), NDJSON (some) |

Claude Code has an upgraded control path: when `@anthropic-ai/claude-agent-sdk` is
available, PanCode uses the Agent SDK for typed streaming, session management, and
tool interception instead of subprocess JSON scraping. Same provider ID (`cli:claude`),
different internal implementation. The user never sees the difference.

### 2.3 API

Inference providers accessed via API tokens or OpenAI-compatible HTTP endpoints.
Split into two subcategories:

**Cloud API vendors** (token-based): Traditional API providers where you pay per
token and authenticate with an API key.

| Property | Value |
|----------|-------|
| Examples | Anthropic API, OpenAI API, Google AI, Groq, Inception Labs, Cerebras, OpenRouter |
| Control mechanism | Pi SDK built-in providers (`anthropic-messages`, `openai-completions`, etc.) |
| Model source | Pi SDK model registry (hardcoded catalogs + dynamic discovery) |
| Auth | API key via environment variable or stored credential |
| Integration | Already built into `pi-ai`. PanCode manages auth and surfaces in model selector. |

**Local AI endpoints** (SDK-based): Self-hosted inference servers on user-owned
hardware, accessed through their official SDKs.

| Property | Value |
|----------|-------|
| Examples | Ollama (`ollama` npm), LM Studio (`@lmstudio/sdk`), llamacpp (HTTP), vLLM, LocalAI |
| Control mechanism | Official SDK or OpenAI-compatible HTTP via `registerApiProvider("openai-completions")` |
| Model source | Endpoint model list API (`/api/tags`, `/v1/models`, `/props`) |
| Auth | None (local network) |
| Integration | PanCode registers local endpoints as Pi API providers. The Pi agent loop uses them natively. |

This is PanCode's core contribution: making local AI work as first-class Pi providers.
When a user boots `pancode --preset local-mini`, the llamacpp endpoint on mini is
registered as a Pi provider, and Panos is powered by the local model through the
standard Pi SDK streaming path.

### 2.4 SDK

Programmatic agent SDKs for building custom agents.

| Property | Value |
|----------|-------|
| Examples | Anthropic Agent SDK, Google ADK, OpenAI Agents SDK, Vercel AI SDK |
| Control mechanism | SDK-specific adapters with common protocol interface |
| Model source | SDK configuration |
| Auth | SDK-managed |
| Streaming | SDK-native async iterators |

Note: The Claude Agent SDK appears in BOTH cli (as the upgraded control path for
`cli:claude`) and sdk (as a framework for building custom agents). These are
separate use cases. The cli category uses it to control the Claude Code binary.
The sdk category uses it to build standalone agents.

---

## 3. Classification Axes

Every provider is tagged along two orthogonal axes. These are metadata, not categories.

**Compute Location:**
- `local`: inference runs on user-owned hardware
- `cloud`: inference runs on remote infrastructure

**Ownership:**
- `private`: user owns or controls the endpoint
- `public`: commercial API service

Examples:
- Ollama on home server → `local + private`
- Claude API → `cloud + public`
- vLLM on own cloud VPS → `cloud + private`
- OpenRouter → `cloud + public`

---

## 4. Naming Convention

### Reserved words

| Word | Belongs to | Never used for |
|------|-----------|----------------|
| runtime | PanCode itself | External agents or providers |
| provider | External agents and services | PanCode internals |
| adapter | Code that bridges PanCode to a provider | User-facing concepts |

### Provider IDs

Format: `category:name` (lowercase, hyphenated).

```
native:pi
cli:claude
cli:codex
cli:gemini
cli:cline
cli:opencode
cli:copilot
cli:aider
api:ollama
api:lmstudio
api:llamacpp
api:vllm
api:openrouter
sdk:anthropic
sdk:google-adk
sdk:openai-agents
```

### Code naming

| Current (wrong) | New (correct) |
|-----------------|---------------|
| `AgentRuntime` | `ProviderAdapter` |
| `runtimeRegistry` | `providerRegistry` |
| `ClaudeCodeRuntime` | `ClaudeCliAdapter` |
| `ClaudeSdkRuntime` | (merged into ClaudeCliAdapter) |
| `PiRuntime` | `PiNativeAdapter` |
| `CliRuntime` (base class) | `CliAdapter` |
| `discoverAndRegisterRuntimes` | `discoverProviders` |
| `RuntimeResult` | `ProviderResult` |
| `RuntimeTaskConfig` | `TaskConfig` |
| `isSdkRuntime()` | `hasSdkPath()` |

---

## 5. Architecture

### 5.1 Domain structure

```
src/domains/pan-providers/
  manifest.ts                   # Domain registration
  extension.ts                  # Commands, hooks, bus events
  index.ts                      # Public exports

  # Registry (single source of truth)
  registry.ts                   # ProviderRegistry singleton
  types.ts                      # ProviderAdapter interface, ProviderResult, etc.

  # Discovery
  discovery.ts                  # Unified provider discovery (PATH scan + HTTP probes)
  probes/
    path-scanner.ts             # Scan PATH for known CLI binaries
    http-prober.ts              # Probe ports for inference endpoints
    sdk-detector.ts             # Check node_modules for agent SDKs

  # Adapters (one per provider)
  adapters/
    pi-native.ts                # Pi SDK native execution
    claude-cli.ts               # Claude Code (subprocess + SDK dual path)
    codex-cli.ts                # OpenAI Codex CLI
    gemini-cli.ts               # Google Gemini CLI
    cline-cli.ts                # Cline CLI
    opencode-cli.ts             # opencode CLI
    copilot-cli.ts              # GitHub Copilot CLI
    cli-base.ts                 # Base class for CLI adapters

  # Models
  models/
    catalog.ts                  # Unified model catalog (API + local + hardcoded)
    profiles.ts                 # Model capability profiles (context, tools, vision)
    packs.ts                    # Model packs (anthropic, openai, local, hybrid)
    matcher.ts                  # Model resolution and scoring
    usage.ts                    # Per-model usage tracking

  # Observability
  observability/
    telemetry.ts                # Normalized usage/cost/quota from all providers
    health.ts                   # Provider health checks
    cost-tracker.ts             # Per-session cost aggregation

  # Session
  session/
    continuity.ts               # Cross-dispatch session resume
    tracker.ts                  # Unified session tracker (merged from session-continuity + session-pool)

  # Infrastructure
  concurrency.ts                # In-process execution concurrency limiter
```

### 5.2 What moves where

| Current location | New location | Notes |
|-----------------|-------------|-------|
| `src/engine/runtimes/types.ts` | `pan-providers/types.ts` | Renamed interfaces |
| `src/engine/runtimes/registry.ts` | `pan-providers/registry.ts` | Renamed to ProviderRegistry |
| `src/engine/runtimes/discovery.ts` | `pan-providers/discovery.ts` | Expanded with HTTP probes |
| `src/engine/runtimes/cli-base.ts` | `pan-providers/adapters/cli-base.ts` | Renamed to CliAdapter |
| `src/engine/runtimes/pi-runtime.ts` | `pan-providers/adapters/pi-native.ts` | Stays in engine boundary |
| `src/engine/runtimes/adapters/*.ts` | `pan-providers/adapters/*.ts` | Renamed per provider |
| `src/engine/runtimes/sdk-concurrency.ts` | `pan-providers/concurrency.ts` | Kept, generalized name |
| `src/engine/runtimes/sdk-session-pool.ts` | `pan-providers/session/tracker.ts` | Merged with continuity |
| `src/domains/providers/discovery.ts` | `pan-providers/discovery.ts` | Merged with PATH scanner |
| `src/domains/providers/engines/*.ts` | `pan-providers/probes/http-prober.ts` | Unified into one prober |
| `src/domains/providers/registry.ts` | `pan-providers/models/catalog.ts` | Model-specific registry |
| `src/domains/providers/shared.ts` | `pan-providers/index.ts` (exports) | Auth stays in engine |
| `src/domains/providers/model-matcher.ts` | `pan-providers/models/matcher.ts` | |
| `src/domains/providers/model-perf.ts` | `pan-providers/models/profiles.ts` | |
| `src/domains/providers/anthropic-catalog.ts` | `pan-providers/models/catalog.ts` | Merged |
| `src/domains/providers/openai-codex-catalog.ts` | `pan-providers/models/catalog.ts` | Merged |
| `src/domains/dispatch/session-continuity.ts` | `pan-providers/session/continuity.ts` | |
| `src/domains/dispatch/routing.ts` | `pan-providers/models/matcher.ts` | Model routing |

### 5.3 Pi SDK IS the engine

The Pi SDK is not something PanCode wraps at arm's length. It IS the engine that
powers PanCode. The `pi-coding-agent` provides the agent loop. The `pi-ai` provides
the model/provider system with `registerApiProvider()`, `ModelManager`, and streaming.
The `pi-tui` renders the TUI. PanCode is a set of domain extensions layered on top.

**For the native category:** The Pi coding agent IS the native execution path. When
PanCode boots, it starts a Pi coding agent extended with PanCode's domain extensions.
The orchestrator (Panos) is a Pi coding agent. Native workers are Pi coding agent
subprocesses. There is no separate "Pi adapter." The Pi SDK is the foundation.

**For local AI providers (Ollama, LM Studio, llamacpp):** These endpoints speak
OpenAI-compatible APIs. PanCode registers them INTO the Pi SDK's provider registry
using `registerApiProvider()` with the `openai-completions` API type. The Pi agent
loop then uses local models natively through its own streaming infrastructure. No
PanCode-specific inference layer needed.

**For cloud API providers (Anthropic, OpenAI, Google, Groq):** These are already
built into `pi-ai` as registered API providers. PanCode's job is to manage auth
(API keys) and surface them in the model selector.

**For CLI agent providers (claude, codex, gemini):** These are worker dispatch
targets, not Pi providers. When PanCode dispatches work to a CLI agent, it spawns
a subprocess. The CLI agent manages its own model/provider selection internally.

**For SDK agent providers (Claude Agent SDK, Google ADK):** These are in-process
dispatch targets. PanCode uses their programmatic APIs for typed streaming and
session management.

See `.specs/LOCKED/diagrams/architecture-layers.md` for visual diagrams of this
architecture.

---

## 6. Provider Lifecycle

### 6.1 Discovery (boot time)

```
discoverProviders()
  ├─ pathScanner.scan()         # which CLIs exist on PATH?
  ├─ httpProber.probe()         # which endpoints respond?
  ├─ sdkDetector.detect()       # which SDKs are installed?
  └─ providerRegistry.register(...)  # populate the registry
```

### 6.2 Registration

Each discovered provider is registered with:

```typescript
interface RegisteredProvider {
  id: string;                          // "cli:claude", "api:ollama", etc.
  category: "native" | "cli" | "api" | "sdk";
  displayName: string;                 // "Claude Code", "Ollama", etc.
  available: boolean;                  // can we use it right now?
  version: string | null;             // detected version
  computeLocation: "local" | "cloud";
  ownership: "private" | "public";

  // Connection
  connectionMethod: "subprocess" | "http" | "sdk-inprocess";
  endpoint: string | null;            // URL for API providers
  binary: string | null;              // binary name for CLI providers

  // Capabilities
  models: string[];                   // available model IDs
  features: ProviderFeatures;         // streaming, tool use, vision, etc.
  telemetryTier: "platinum" | "gold" | "silver" | "bronze";

  // Auth
  authMethod: "none" | "api-key" | "oauth" | "cli-managed";
  authenticated: boolean;

  // Adapter
  adapter: ProviderAdapter;           // the execution adapter
}
```

### 6.3 Health monitoring

The pan-providers extension periodically calls `adapter.health()` on all registered
providers. Degraded or unavailable providers are marked in the registry. Dispatch
skips them. Recovery is automatic when health checks pass.

### 6.4 Observation

For providers that expose usage APIs:
- Anthropic: usage endpoint (tier, tokens, requests, cost)
- OpenAI: billing API (similar)
- Ollama: `/api/ps` (loaded models, VRAM usage)
- LM Studio: `/v0/models` (loaded models, context)
- llamacpp: `/health` + `/props` (loaded model, context, slots)

PanCode polls and caches this data. Providers without usage APIs get
`quota: "unmetered"` (local) or `quota: "unknown"` (cloud without API key).

---

## 7. Adapter Interface

Every provider adapter implements:

```typescript
interface ProviderAdapter {
  readonly id: string;
  readonly category: "native" | "cli" | "api" | "sdk";
  readonly displayName: string;
  readonly telemetryTier: TelemetryTier;

  /** Detect availability, version, capabilities */
  probe(): ProbeResult;

  /** Check if the provider is healthy right now */
  health(): HealthStatus;

  /** Start a unit of work */
  spawn(config: TaskConfig): Promise<ProviderResult>;

  /** Abort a running task */
  abort(handle: string): void;

  /** Version string, or null if unknown */
  getVersion(): string | null;
}
```

CLI adapters that support the SDK upgrade path additionally implement:

```typescript
interface SdkCapableAdapter extends ProviderAdapter {
  /** True when the SDK path is available and preferred */
  hasSdkPath(): boolean;

  /** Which control plane is active */
  controlPlane: "subprocess" | "sdk";

  /** In-process execution via SDK (used when hasSdkPath() is true) */
  executeViaSdk(config: TaskConfig, callbacks?: SdkCallbacks): Promise<ProviderResult>;
}
```

---

## 8. Model System

### 8.1 Model catalog

All models from all providers are registered in a unified catalog.

```typescript
interface CatalogEntry {
  id: string;                    // "anthropic/claude-opus-4-6"
  provider: string;              // "cli:claude" or "api:ollama"
  displayName: string;
  family: string;                // "claude", "gpt", "qwen", "granite"
  contextWindow: number;
  capabilities: ModelCapabilities;
  pricing: ModelPricing | null;  // null for local/free models
  source: "hardcoded" | "discovered" | "user-configured";
}

interface ModelCapabilities {
  toolCalling: boolean;
  vision: boolean;
  streaming: boolean;
  thinking: boolean;
  codeExecution: boolean;
}
```

### 8.2 Model packs

Model packs map PanCode's modes to specific model IDs.

```typescript
interface ModelPack {
  id: string;
  name: string;
  models: {
    admin: string;    // orchestrator model (God Mode / admin tasks)
    plan: string;     // planning model
    build: string;    // coding model (workers)
    review: string;   // review model (read-only workers)
  };
}
```

Built-in packs:

| Pack | Admin | Plan | Build | Review |
|------|-------|------|-------|--------|
| `anthropic` | claude-opus-4-6 | claude-opus-4-6 | claude-sonnet-4-5 | claude-haiku-4-5 |
| `openai` | o3 | gpt-5.3-codex | gpt-5.3-codex | gpt-5.1-codex-mini |
| `local` | (best local) | (best local) | (best local) | (fast local) |
| `hybrid` | claude-opus-4-6 | (best local) | (best local) | claude-haiku-4-5 |

### 8.3 Model routing

When dispatch needs a model, resolution follows this priority:

1. Explicit agent spec model (e.g., `model: anthropic/claude-opus-4-6`)
2. Active model pack for the current mode
3. Environment variable (`PANCODE_WORKER_MODEL`)
4. Best available model from discovered providers

The matcher considers: capability requirements, cost, latency class, provider
health, and user preference.

### 8.4 Usage tracking

Every model invocation increments `modelUseCounts[modelId]` in settings.
The model selector sorts by: current first, then by usage count descending,
then alphabetical.

---

## 9. Session Management

### 9.1 Unified session tracker

Merges the current session-continuity store and SDK session pool into one.

```typescript
interface TrackedSession {
  sessionId: string;
  taskId: string | null;
  agentName: string;
  providerId: string;               // was "runtimeId"
  model: string | null;
  totalCost: number;
  totalTurns: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  dispatchCount: number;
  createdAt: number;
  lastUsedAt: number;
}
```

TTL: 30 minutes (configurable via `PANCODE_SESSION_TTL_MS`).
Persistence: checkpoint to disk on session shutdown, lazy load on restart.

### 9.2 Continuation args

Provider-specific session resume arguments:

| Provider | Stored | Injected args |
|----------|--------|---------------|
| cli:claude | sessionId | `--resume <sessionId>` |
| cli:cline | taskId | `--continue -T <taskId>` |
| cli:opencode | sessionId | `--continue --session <sessionId>` |

---

## 10. TUI Integration

### 10.1 Per-provider card widgets

Each provider category gets its own themed card widget in the dispatch board.

| Provider | Accent color | Card style |
|----------|-------------|------------|
| native:pi | PanCode brand (teal) | Default 6-line card |
| cli:claude | Anthropic orange (#D97706) | Enhanced card with progress, tokens, session |
| cli:codex | OpenAI green (#10A37F) | Enhanced card |
| cli:gemini | Google purple (#8E24AA) | Enhanced card |
| cli:opencode | Blue (#2196F3) | Default card |
| cli:copilot | GitHub gray (#6E7681) | Default card |
| api:* | Neutral | Default card |

The existing `ClaudeSdkCardWidget` becomes the `ClaudeCardWidget`, registered for
`cli:claude` instead of `sdk:claude-code`.

### 10.2 Provider status panel

A TUI widget showing all discovered providers, their status (active/degraded/unavailable),
current control plane path (for SDK-capable providers), and capability summary.

### 10.3 Cost and quota dashboard

For providers with quota observation: tokens used/remaining, requests used/remaining,
estimated cost this session, estimated cost this month.

---

## 11. Migration Path

### Phase 1: Create the domain, rename types

- Create `src/domains/pan-providers/` with the new structure
- Move adapter code from `src/engine/runtimes/adapters/` to `src/domains/pan-providers/adapters/`
- Rename all `*Runtime` classes to `*Adapter`
- Rename `AgentRuntime` interface to `ProviderAdapter`
- Change all provider IDs (e.g., `cli:claude-code` → `cli:claude`)
- Update all downstream consumers (dispatch, agents, UI)
- Merge `sdk:claude-code` into `cli:claude` as the SDK upgrade path

### Phase 2: Unify discovery

- Merge PATH scanning (from engine/runtimes/discovery.ts) with HTTP probing (from domains/providers/discovery.ts)
- Single `discoverProviders()` entry point
- Unified registry replaces both `runtimeRegistry` and the model registry

### Phase 3: Merge model system

- Move model catalog, profiles, matcher, usage tracking into pan-providers/models/
- Implement model packs
- Wire model routing to dispatch

### Phase 4: Merge session management

- Implement unified SessionTracker (from SESSION-UNIFICATION.md spec)
- Absorb session-continuity and session-pool
- Add disk persistence

### Phase 5: Wire observability and TUI

- Provider health monitoring
- Cost/quota observation
- Per-provider card widgets
- Provider status panel

### Phase 6: Delete old code

- Remove `src/engine/runtimes/` (fully absorbed)
- Remove `src/domains/providers/` (fully absorbed)
- Update all imports across the codebase

---

## 12. Files Affected (Estimate)

### New files (~25)

All in `src/domains/pan-providers/`.

### Deleted files (~20)

- `src/engine/runtimes/*.ts` (8 files)
- `src/engine/runtimes/adapters/*.ts` (8 files)
- `src/domains/providers/*.ts` (10 files)
- `src/domains/providers/engines/*.ts` (5 files)

### Modified files (~15)

- `src/domains/dispatch/worker-spawn.ts` (provider adapter calls)
- `src/domains/dispatch/extension.ts` (registry references)
- `src/domains/dispatch/routing.ts` (model resolution)
- `src/domains/agents/extension.ts` (provider suggestions)
- `src/domains/ui/extension.ts` (card widget registration)
- `src/domains/ui/widgets/claude-sdk-card.ts` → `claude-card.ts`
- `src/domains/ui/tui-verify.ts` (mock data)
- `src/domains/ui/dispatch-board.ts` (card rendering)
- `src/entry/orchestrator.ts` (boot discovery)
- `src/engine/index.ts` (removed runtime exports)
- Various barrel exports

---

## 13. Architectural Decision: Pi Coding Agent vs Custom Agent

Two paths exist for building PanCode's orchestrator agent:

**Path A (current):** Use `pi-coding-agent` directly. PanCode creates an
ExtensionFactory that hooks into the Pi agent's lifecycle and overlays domain
extensions. The Pi agent handles the agent loop, tool execution, and conversation
management. PanCode extends it.

**Path B (future option):** Build a custom "Panos" agent using `pi-ai` +
`pi-tui` + `pi-agent-core` primitives. PanCode owns the agent loop entirely.
No dependency on the `pi-coding-agent` binary. Full control over the agent's
behavior, tool routing, and conversation flow.

**Current decision:** Path A. The Pi coding agent is mature, handles edge cases
(context compaction, tool retries, session persistence), and gives PanCode free
upgrades when the SDK improves. Path B is only justified if PanCode needs agent
loop control that the Pi extension model cannot provide.

This decision should be revisited when PanCode's dispatch system matures. If
multi-agent orchestration requires control over the agent loop itself (not just
extensions on top of it), Path B becomes necessary.

---

## 14. What This Spec Does NOT Cover

- XDG filesystem layout (see PRODUCTIZATION.md)
- Onboarding wizard (separate sprint)
- OAuth flows (future, depends on Pi SDK support)
- LibSQL persistence (future sprint)
- Remote SSH dispatch (deferred, needs correct architecture first)
