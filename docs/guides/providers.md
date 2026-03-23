# Providers Guide

PanCode discovers and manages LLM providers automatically. It supports local inference engines and cloud API providers, routing models by capability and cost.

## Local Engines

PanCode discovers three types of local inference engines at boot:

| Engine | Default Port | Protocol |
|--------|-------------|----------|
| LM Studio | 1234 | OpenAI-compatible API |
| Ollama | 11434 | Ollama native API |
| llama.cpp (llama-server) | 8080 | llama.cpp API |

### Discovery Process

On startup, PanCode probes each known service on each configured machine:

1. Sends a lightweight health probe (500ms timeout for first tier, 1000ms for second)
2. Lists available models from responding endpoints
3. Matches models against the knowledge base for capability metadata
4. Caches results in `~/.pancode/model-cache.yaml`

### Boot Performance

| Boot Mode | Duration | Behavior |
|-----------|----------|----------|
| Cold (first run or `--rediscover`) | ~1150ms | Probes all endpoints, writes cache |
| Warm (cached) | ~120ms | Reads cache, zero network I/O |

On warm boot, PanCode loads from cache and starts a background refresh after the shell is interactive. The refreshed data takes effect on the next boot.

## Configuring Machines

By default, PanCode only scans `localhost`. To discover engines on other machines, set `PANCODE_LOCAL_MACHINES`:

```bash
# In .env or your shell
PANCODE_LOCAL_MACHINES=mini=192.168.86.141,dynamo=192.168.86.143
```

Format: `name1=address1,name2=address2`

PanCode probes every combination of machine and service. With 3 machines and 3 services, it probes 9 endpoints.

## Provider IDs

Each discovered endpoint gets a provider ID in the format `machine-engine`:

```
localhost-ollama
localhost-lmstudio
mini-ollama
dynamo-lmstudio
dynamo-llamacpp
```

## Model References

Models are referenced as `provider/model-id`:

```
localhost-ollama/llama3.2
dynamo-lmstudio/qwen2.5-coder-32b
mini-llamacpp/codestral
```

Use this format everywhere: `--model` flag, `PANCODE_MODEL` env var, agent specs, and the `/models` command.

## Cloud API Providers

Set the appropriate API key in your environment:

```bash
export ANTHROPIC_API_KEY=sk-ant-...
export OPENAI_API_KEY=sk-...
```

API provider registration is minimal in the current release. Cloud models are available through the model registry once API keys are configured.

## Model Resolution

PanCode resolves the orchestrator model using this priority:

1. `--model` CLI flag
2. `PANCODE_MODEL` environment variable
3. `.pancode/default-model` file (first line)
4. `preferredModel` from settings
5. First available model from discovery

If no model resolves, PanCode starts in degraded mode and surfaces the issue in the shell.

## Model Cache

Discovery results are cached at `~/.pancode/model-cache.yaml`. This file contains merged model profiles with capability metadata from the knowledge base.

### Force Rediscovery

```bash
pancode --rediscover    # Cold boot, ignore cache
```

### View Models

```
/models                 # List all visible models
/models provider/model  # Switch to a specific model
```

## Provider Health

PanCode tracks provider health through the resilience system:

- **Backoff**: Repeated failures trigger exponential backoff
- **Rate limiting**: 429 responses trigger dedicated backoff
- **Recovery**: Successful dispatches reset backoff state

Use `/doctor` to check provider health status.

## Model Knowledge Base

PanCode includes an offline knowledge base with metadata for known models:

- Capability classification (coding, reasoning, general)
- Parameter counts and context window sizes
- Performance tiers (frontier, mid, small)
- Cost estimates per provider

The knowledge base lives in the `models/` directory of the PanCode installation. It matches discovered models against known entries to provide accurate routing.

## Sampling Presets

Agents reference sampling presets that control generation parameters:

| Preset | Use Case |
|--------|----------|
| `general` | Conversation and analysis |
| `coding` | Code generation and editing |

Agent class profiles (orchestrator, worker, scout) further refine temperature, top-p, and top-k values independently of sampling presets.

## See Also

- [Configuration Guide](./configuration.md): Config resolution and environment variables
- [Agents Guide](./agents.md): Agent specs and runtime selection
- [Local Fleet Tutorial](../tutorials/local-fleet.md): Step-by-step local setup
- [Environment Variables](../reference/environment-variables.md): All PANCODE_* variables
