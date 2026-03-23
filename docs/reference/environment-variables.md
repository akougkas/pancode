# Environment Variables

Complete reference for all environment variables that PanCode reads or writes.

## User-Configurable Variables

These variables can be set in your shell, `.env` file, or system environment.

### Model Configuration

| Variable | Description | Example |
|----------|-------------|---------|
| `PANCODE_MODEL` | Orchestrator model (provider/model-id) | `localhost-ollama/llama3.2` |
| `PANCODE_WORKER_MODEL` | Default worker model | `dynamo-ollama/codellama` |
| `PANCODE_SCOUT_MODEL` | Scout model override | `localhost-ollama/llama3.2` |
| `PANCODE_DEFAULT_MODEL` | Alias for PANCODE_MODEL | `localhost-ollama/llama3.2` |

### Runtime Configuration

| Variable | Description | Default |
|----------|-------------|---------|
| `PANCODE_SAFETY` | Safety level: suggest, auto-edit, full-auto | `auto-edit` |
| `PANCODE_REASONING` | Reasoning preference: off, minimal, low, medium, high, xhigh | `medium` |
| `PANCODE_THINKING` | Backward-compatible alias for PANCODE_REASONING | (none) |
| `PANCODE_THEME` | TUI theme name | `dark` |
| `PANCODE_PROFILE` | Config profile name | `standard` |
| `PANCODE_PROJECT` | Working directory override | (cwd) |
| `PANCODE_HOME` | Base directory for user config | `~/.pancode` |
| `PANCODE_TIMEOUT_MS` | Default timeout in milliseconds | `120000` |
| `PANCODE_PROMPT` | Default prompt text | `list files...` |
| `PANCODE_TOOLS` | Default tool set (comma-separated) | `read,bash,grep,find,ls` |

### Budget and Limits

| Variable | Description | Default |
|----------|-------------|---------|
| `PANCODE_BUDGET_CEILING` | Session budget ceiling in dollars | `10.0` |
| `PANCODE_PER_RUN_BUDGET` | Per-dispatch cost cap in dollars | (none) |
| `PANCODE_DISPATCH_MAX_DEPTH` | Maximum recursion depth for dispatch | `2` |
| `PANCODE_WORKER_TIMEOUT_MS` | Worker timeout override in milliseconds | (uses timeoutMs) |
| `PANCODE_MAX_RUNS` | Maximum run history entries (ring buffer) | `500` |
| `PANCODE_MAX_METRICS` | Maximum metric history entries (ring buffer) | `1000` |
| `PANCODE_STARTUP_BUDGET_MS` | Boot time budget before warning | `3000` |

### Discovery and Providers

| Variable | Description | Example |
|----------|-------------|---------|
| `PANCODE_LOCAL_MACHINES` | Additional machines for engine discovery | `mini=192.168.86.141,dynamo=192.168.86.143` |
| `ANTHROPIC_API_KEY` | Anthropic API key for Claude models | `sk-ant-...` |
| `OPENAI_API_KEY` | OpenAI API key | `sk-...` |

### Agent Configuration

| Variable | Description | Default |
|----------|-------------|---------|
| `PANCODE_DEFAULT_AGENT` | Default agent for dispatch | `dev` |
| `PANCODE_STRICT_TIERS` | Enforce strict tier matching (set to "1") | (off) |
| `PANCODE_HEARTBEAT_INTERVAL_MS` | Worker heartbeat interval in milliseconds | `10000` |

### Feature Flags

| Variable | Description | Default |
|----------|-------------|---------|
| `PANCODE_VERBOSE` | Enable verbose logging to stderr | (off) |
| `PANCODE_INTELLIGENCE` | Enable intelligence domain (set to "enabled") | (off) |

## Internal Variables

PanCode sets these automatically. Do not override them unless you understand the implications.

### Set by the Loader

| Variable | Description |
|----------|-------------|
| `PANCODE_PACKAGE_ROOT` | Absolute path to PanCode installation directory |
| `PANCODE_BIN_PATH` | Path to the loader script |
| `PANCODE_HOME` | User config directory (default: `~/.pancode`) |
| `PANCODE_AGENT_DIR` | Agent engine directory (`~/.pancode/agent-engine`) |
| `PI_CODING_AGENT_DIR` | Pi SDK agent directory (defaults to PANCODE_AGENT_DIR) |
| `PANCODE_ENTRYPOINT` | Boot target: `orchestrator` or other |

### Set by the Orchestrator

| Variable | Description |
|----------|-------------|
| `PANCODE_INSIDE_TMUX` | Set to `"1"` when running inside PanCode tmux session |
| `PANCODE_PRESET` | Name of the active boot preset |
| `PANCODE_SESSION_ID` | Unique session identifier |
| `PANCODE_RUNTIME_ROOT` | Path to `.pancode/runtime/` |
| `PANCODE_ENABLED_DOMAINS` | Comma-separated list of loaded domain names |
| `PANCODE_EFFECTIVE_THINKING` | Resolved thinking level for current model |
| `PANCODE_BUDGET_SPENT` | Current session spend (updated on each dispatch) |
| `PI_SKIP_VERSION_CHECK` | Set to `"1"` to suppress Pi SDK version checks |

### Set for Worker Subprocesses

| Variable | Description |
|----------|-------------|
| `PANCODE_DISPATCH_DEPTH` | Current recursion depth (incremented per dispatch level) |
| `PANCODE_RUN_ID` | Worker's run identifier |
| `PANCODE_AGENT_NAME` | Name of the agent spec this worker uses |
| `PANCODE_BOARD_FILE` | Path to shared board file for coordination |
| `PANCODE_CONTEXT_FILE` | Path to context registry file |
| `PANCODE_PARENT_PID` | PID of the parent orchestrator process |

## .env File

PanCode reads a `.env` file from the project root at startup. Existing environment variables are not overwritten.

```bash
# .env
PANCODE_MODEL=localhost-ollama/llama3.2
PANCODE_WORKER_MODEL=dynamo-ollama/codellama
PANCODE_SCOUT_MODEL=localhost-ollama/llama3.2
PANCODE_BUDGET_CEILING=25.00
PANCODE_LOCAL_MACHINES=mini=192.168.86.141,dynamo=192.168.86.143
ANTHROPIC_API_KEY=sk-ant-...
```

Format: one `KEY=VALUE` per line. Lines starting with `#` are comments. Empty lines are skipped.

## See Also

- [Configuration Guide](../guides/configuration.md): Resolution order and config patterns
- [Configuration Reference](./configuration-reference.md): Full config schema
- [Providers Guide](../guides/providers.md): Provider discovery and model resolution
