# PanCode Architecture Diagrams

## 1. Layer Cake: What Powers PanCode

```mermaid
graph TB
    subgraph USER["User"]
        Terminal["Terminal / tmux"]
    end

    subgraph PANCODE["PanCode Runtime"]
        direction TB

        subgraph DOMAINS["Domain Extensions (src/domains/)"]
            direction LR
            Safety["safety"]
            Dispatch["dispatch"]
            Agents["agents"]
            Providers["pan-providers"]
            UI["ui"]
            Session["session"]
            Obs["observability"]
            Sched["scheduling"]
            Intel["intelligence"]
            Prompts["prompts"]
        end

        subgraph ENGINE["Engine Boundary (src/engine/)"]
            direction LR
            Extensions["extensions.ts"]
            Events["events.ts"]
            Types["types.ts"]
            TUI["tui.ts"]
            ShellOvr["shell-overrides.ts"]
        end
    end

    subgraph PIE["Pi SDK Engine (PIE)"]
        direction TB
        PiCoding["pi-coding-agent\n(agent loop, tools, modes)"]
        PiAI["pi-ai\n(providers, models, streaming)"]
        PiTUI["pi-tui\n(rendering, editor, components)"]
        PiCore["pi-agent-core\n(agent primitives)"]
    end

    subgraph EXTERNAL["External World"]
        direction LR
        LocalAI["Local AI Endpoints\n(Ollama, LM Studio, llamacpp)"]
        CloudAPI["Cloud APIs\n(Anthropic, OpenAI, Google)"]
        CLIAgents["CLI Agents\n(claude, codex, gemini)"]
        SDKAgents["Agent SDKs\n(Claude Agent SDK, ADK)"]
    end

    Terminal --> PANCODE
    DOMAINS --> ENGINE
    ENGINE --> PIE
    PiAI --> LocalAI
    PiAI --> CloudAPI
    Dispatch --> CLIAgents
    Dispatch --> SDKAgents
    PiTUI --> Terminal

    style PANCODE fill:#0d9488,stroke:#0d9488,color:#fff
    style PIE fill:#1e3a5f,stroke:#1e3a5f,color:#fff
    style DOMAINS fill:#115e59,stroke:#115e59,color:#fff
    style ENGINE fill:#134e4a,stroke:#134e4a,color:#fff
```

**Key insight:** PanCode is an overlay of domain extensions on top of the Pi SDK engine.
The Pi SDK provides the agent loop, TUI rendering, model/provider system, and tool
framework. PanCode extends it with safety, dispatch, multi-agent orchestration,
observability, and local AI provider integration.

---

## 2. Provider Categories and Data Flow

```mermaid
graph LR
    subgraph PANPROVIDERS["pan-providers domain"]
        Discovery["Discovery\n(PATH scan + HTTP probe)"]
        Registry["Provider Registry\n(single source of truth)"]
        Catalog["Model Catalog\n(unified across all providers)"]
    end

    subgraph PIREGISTRY["Pi SDK pi-ai"]
        ApiRegistry["ApiProvider Registry\n(registerApiProvider)"]
        ModelManager["Model Manager\n(ModelSelector)"]
    end

    subgraph NATIVE["native: Pi SDK"]
        PiAgent["Pi Coding Agent\nPanos orchestrator\nPlatinum workers"]
    end

    subgraph CLI["cli: External Agent CLIs"]
        Claude["claude binary"]
        Codex["codex binary"]
        Gemini["gemini binary"]
    end

    subgraph API["api: Inference Endpoints"]
        Ollama["Ollama\n(ollama-js SDK)"]
        LMStudio["LM Studio\n(@lmstudio/sdk)"]
        LlamaCpp["llamacpp\n(HTTP client)"]
    end

    subgraph CLOUDAPI["api: Cloud Inference"]
        Anthropic["Anthropic API"]
        OpenAI["OpenAI API"]
        Google["Google AI"]
        Groq["Groq / Others"]
    end

    subgraph SDK["sdk: Agent SDKs"]
        ClaudeSDK["Claude Agent SDK"]
        GoogleADK["Google ADK"]
    end

    Discovery --> Registry
    Registry --> Catalog

    %% Local AI endpoints register INTO Pi SDK
    Ollama -->|"registerApiProvider\n(openai-completions)"| ApiRegistry
    LMStudio -->|"registerApiProvider\n(openai-completions)"| ApiRegistry
    LlamaCpp -->|"registerApiProvider\n(openai-completions)"| ApiRegistry

    %% Cloud APIs use Pi SDK built-in providers
    Anthropic -->|"built-in\nanthropic-messages"| ApiRegistry
    OpenAI -->|"built-in\nopenai-completions"| ApiRegistry
    Google -->|"built-in\ngoogle-generative-ai"| ApiRegistry
    Groq -->|"built-in\nopenai-completions"| ApiRegistry

    ApiRegistry --> ModelManager
    ModelManager --> PiAgent

    %% CLI agents are dispatched as worker subprocesses
    Registry -->|"dispatch_agent tool"| Claude
    Registry -->|"dispatch_agent tool"| Codex
    Registry -->|"dispatch_agent tool"| Gemini

    %% SDK agents are dispatched in-process
    Registry -->|"executeViaSdk"| ClaudeSDK
    Registry -->|"executeViaSdk"| GoogleADK
```

**Key insight:** Local AI endpoints (Ollama, LM Studio, llamacpp) are registered
as Pi SDK API providers using `registerApiProvider()`. They use the `openai-completions`
API type since they all speak the OpenAI-compatible protocol. This means the Pi agent
loop can use local models natively, without any PanCode-specific inference layer.

---

## 3. How Panos Gets Powered

```mermaid
sequenceDiagram
    participant User
    participant PanCode as PanCode Runtime
    participant Engine as Engine (src/engine/)
    participant PiAI as pi-ai
    participant PiAgent as pi-coding-agent
    participant Provider as Local/Cloud Provider

    User->>PanCode: pancode --preset local-mini
    PanCode->>PanCode: Load preset (model: llamacpp/qwen3.5-35b)
    PanCode->>Engine: Initialize Pi SDK
    PanCode->>PiAI: registerApiProvider("openai-completions")<br/>baseURL: http://192.168.86.141:8080

    PanCode->>PiAgent: Start agent loop<br/>model: llamacpp/qwen3.5-35b
    PiAgent->>PiAI: stream(model, context)
    PiAI->>Provider: POST /v1/chat/completions<br/>(via openai-completions provider)
    Provider-->>PiAI: SSE stream
    PiAI-->>PiAgent: AssistantMessageEvents
    PiAgent-->>PanCode: Tool calls, text output
    PanCode-->>User: TUI rendering via pi-tui

    Note over User,Provider: User switches model via /models
    User->>PanCode: /models → select anthropic/claude-sonnet
    PanCode->>PiAI: ModelSelector.setModel("anthropic/claude-sonnet")
    PiAgent->>PiAI: stream(newModel, context)
    PiAI->>Provider: Anthropic API (built-in provider)
    Provider-->>PiAI: SSE stream
    PiAI-->>PiAgent: AssistantMessageEvents
```

**Key insight:** Model switching is seamless. The Pi agent loop doesn't care whether
the model comes from a local llamacpp server or the Anthropic cloud API. PanCode's
job is to register the local endpoints as Pi providers and let the SDK handle the rest.

---

## 4. Worker Dispatch: Native vs CLI vs SDK

```mermaid
graph TB
    subgraph Orchestrator["Panos (Orchestrator Agent)"]
        DispatchTool["dispatch_agent tool"]
    end

    DispatchTool -->|"native worker"| NativeWorker
    DispatchTool -->|"cli worker"| CliWorker
    DispatchTool -->|"sdk worker"| SdkWorker

    subgraph NativeWorker["Native Worker (Platinum)"]
        PiSubprocess["Pi Coding Agent subprocess\n(same engine, isolated process)"]
        PiSubprocess -->|"powered by"| LocalModel["Local/Cloud model\nvia Pi SDK providers"]
    end

    subgraph CliWorker["CLI Worker"]
        ClaudeCli["claude -p 'task' --json"]
        CodexCli["codex exec 'task'"]
        GeminiCli["gemini -p 'task'"]
    end

    subgraph SdkWorker["SDK Worker"]
        ClaudeAgentSDK["Claude Agent SDK\nquery() in-process"]
        GoogleADKWorker["Google ADK\nagent.run() in-process"]
    end

    NativeWorker -->|"NDJSON stdout"| ResultParser["Result Parser"]
    CliWorker -->|"JSON stdout"| ResultParser
    SdkWorker -->|"Typed async stream"| ResultParser
    ResultParser --> RunLedger["RunLedger\n(cost, tokens, status)"]
```

**Key insight:** Three distinct execution paths. Native workers use the same Pi engine
as the orchestrator (maximum telemetry, streaming, tool interception). CLI workers
are black-box subprocesses. SDK workers use programmatic APIs for typed streaming.

---

## 5. Domain Extension Architecture

```mermaid
graph TB
    subgraph PiSDK["Pi SDK (ExtensionFactory)"]
        Hooks["Lifecycle Hooks\nsession_start, tool_call,\nsession_shutdown, etc."]
        Tools["Tool Registration\nregisterTool()"]
        Commands["Command Registration\nregisterCommand()"]
    end

    subgraph Extensions["PanCode Domain Extensions"]
        direction TB

        SafetyExt["safety/extension.ts\nhook: tool_call → evaluate rules\nhook: before_provider_request → scope"]

        DispatchExt["dispatch/extension.ts\ntool: dispatch_agent\ncmd: /cost, /runs, /stoprun"]

        AgentsExt["agents/extension.ts\nhook: session_start → discover + register\ncmd: /agents, /runtimes, /workers"]

        ProvidersExt["pan-providers/extension.ts\nhook: session_start → discover providers\ncmd: /providers, /models"]

        UIExt["ui/extension.ts\nhook: session_start → init TUI\nall keyboard shortcuts\ncmd: /dashboard, /settings"]

        ObsExt["observability/extension.ts\nhook: session_start → init telemetry\ncmd: /metrics, /health"]
    end

    PiSDK --> Extensions
    SafetyExt -.->|"bus: SAFETY_DECISION"| DispatchExt
    ProvidersExt -.->|"bus: PROVIDERS_DISCOVERED"| AgentsExt
    DispatchExt -.->|"bus: RUN_STARTED/FINISHED"| UIExt
    DispatchExt -.->|"bus: RUN_FINISHED"| ObsExt

    style PiSDK fill:#1e3a5f,stroke:#1e3a5f,color:#fff
    style Extensions fill:#115e59,stroke:#115e59,color:#fff
```

**Key insight:** Every PanCode domain is a Pi SDK extension. Extensions hook into
lifecycle events and register tools/commands. Cross-domain communication goes
through SafeEventBus. The Pi SDK orchestrates the extension lifecycle.
