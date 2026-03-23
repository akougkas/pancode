# Tutorial: Setting Up a Local LLM Fleet

This tutorial walks through setting up PanCode with local inference engines across multiple machines. By the end, you will have a working multi-machine fleet with Ollama, LM Studio, and llama.cpp.

## Prerequisites

- PanCode installed ([Installation Guide](../getting-started/installation.md))
- At least one local inference engine installed
- Network access between machines (if using multiple)

## Step 1: Install Local Engines

Install one or more of these inference engines on your machines.

### Ollama

```bash
# Install Ollama
curl -fsSL https://ollama.com/install.sh | sh

# Pull a model
ollama pull llama3.2

# Ollama serves on port 11434 by default
ollama serve
```

### LM Studio

Download from [lmstudio.ai](https://lmstudio.ai). Load a model and start the local server. LM Studio serves on port 1234 by default and provides an OpenAI-compatible API.

### llama.cpp (llama-server)

```bash
# Build llama.cpp
git clone https://github.com/ggerganov/llama.cpp
cd llama.cpp && make

# Start the server with a model
./llama-server -m models/codestral.gguf --port 8080
```

llama-server provides a REST API on port 8080 by default.

## Step 2: Configure Machines

If your engines run on machines other than localhost, set `PANCODE_LOCAL_MACHINES` in your `.env` file:

```bash
# .env
PANCODE_LOCAL_MACHINES=mini=192.168.86.141,dynamo=192.168.86.143
```

Format: `name=address` pairs separated by commas. PanCode always scans localhost in addition to any machines listed here.

With 3 machines and 3 engine types, PanCode probes 9 endpoints at boot.

## Step 3: Configure Models

Set model environment variables in your `.env` file:

```bash
# .env
PANCODE_MODEL=localhost-ollama/llama3.2
PANCODE_WORKER_MODEL=dynamo-ollama/codellama
PANCODE_SCOUT_MODEL=localhost-ollama/llama3.2
```

Model references use the format `provider/model-id` where the provider is `machine-engine`.

### Choosing Models by Role

| Role | Recommended Characteristics |
|------|---------------------------|
| Orchestrator (`PANCODE_MODEL`) | Strong reasoning, large context window |
| Worker (`PANCODE_WORKER_MODEL`) | Good at code generation, moderate context |
| Scout (`PANCODE_SCOUT_MODEL`) | Fast, small, good at following simple instructions |

## Step 4: Create a Preset

Edit `~/.pancode/panpresets.yaml` to define a preset for your fleet:

```yaml
local:
  description: "Local inference via homelab engines"
  model: localhost-ollama/llama3.2
  workerModel: dynamo-ollama/codellama
  scoutModel: localhost-ollama/llama3.2
  reasoning: medium
  safety: auto-edit

local-max:
  description: "Local fleet with high reasoning"
  model: mini-lmstudio/qwen2.5-coder-32b
  workerModel: dynamo-ollama/codellama
  scoutModel: localhost-ollama/llama3.2
  reasoning: high
  safety: auto-edit
```

PanCode seeds this file on first run. After that, it never overwrites your edits.

## Step 5: Boot PanCode

```bash
pancode --preset local
```

Expected output:

```
[pancode] Preset: local (Local inference via homelab engines)
Starting PanCode session "pancode-a3f2b1"...
```

PanCode enters the interactive shell after boot completes.

## Step 6: Verify the Fleet

### Check Health

```
/doctor
```

Expected output:

```
Health Report: 7 pass, 0 warn, 0 fail

  [OK] runtime-dir            Runtime directory exists and is writable
  [OK] orphan-workers         No active worker processes
  [OK] stale-runs             No stale runs detected
  [OK] provider-health        3 provider(s) tracked, all healthy or degraded
  ...
```

### Check Models

```
/models
```

Lists all discovered models with their provider, model ID, and capabilities.

### Check Runtimes

```
/runtimes
```

Shows registered runtimes (Pi native plus any discovered CLI agents).

### Check Boot Performance

```
/perf
```

Displays timing for each boot phase. Phases exceeding 500ms are flagged.

## Step 7: Run a Dispatch

Switch to Build mode (Shift+Tab until you see Build), then ask PanCode to perform a task:

```
You: "Dispatch the scout agent to explore the project structure and report the main directories"
```

PanCode dispatches a worker subprocess running the scout agent. The worker explores the codebase and returns findings to the orchestrator.

Monitor the dispatch:

```
/runs       # View dispatch history
/metrics    # View aggregate statistics
/cost       # View per-run cost breakdown
```

## Understanding Discovery

### Cold Boot

On the first run or with `--rediscover`, PanCode performs cold discovery:

1. Probes each machine + engine combination (tiered timeouts: 500ms, then 1000ms)
2. Lists models from responding endpoints
3. Matches models against the knowledge base for capability metadata
4. Writes results to `~/.pancode/model-cache.yaml` and `~/.pancode/panproviders.yaml`

Average cold boot: ~1150ms (varies with number of machines and endpoints).

### Warm Boot

On subsequent boots, PanCode reads from `~/.pancode/model-cache.yaml` with zero network I/O.

Average warm boot: ~120ms.

After the shell is interactive, PanCode runs a background refresh. If the model count changes, a message appears on stderr. Changes take effect on the next boot.

### Forcing Rediscovery

```bash
pancode --rediscover
```

Ignores the cache and performs full cold discovery. Useful after adding a new engine or machine.

## Troubleshooting

### Engine Not Discovered

1. Verify the engine is running: `curl http://localhost:11434/api/tags` (Ollama)
2. Check the port matches the expected default
3. For remote machines, verify network connectivity: `ping 192.168.86.141`
4. Run `pancode --rediscover` to force a fresh scan

### Model Not Available

1. Verify the model is loaded in the engine: `ollama list`
2. Check `/models` inside PanCode for the full model list
3. Model references are case-sensitive and must match exactly

### Slow Boot

If boot exceeds the 3-second budget:
1. Run `/perf` to identify the slow phase
2. Phase 3 (discovery) is usually the bottleneck on cold boot
3. Reduce the number of dead endpoints (machines that are off)
4. Use warm boot (do not pass `--rediscover` unless needed)

## See Also

- [Providers Guide](../guides/providers.md): Provider architecture and model resolution
- [Configuration Guide](../guides/configuration.md): Environment variables and presets
- [Multi-Agent Dispatch Tutorial](./multi-agent-dispatch.md): Dispatch patterns
