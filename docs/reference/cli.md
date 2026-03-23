# CLI Reference

PanCode provides a command-line interface for session management and orchestrator configuration.

## Commands

### pancode

Start a new PanCode tmux session.

```bash
pancode
pancode --preset local
pancode --model localhost-ollama/llama3.2 --safety full-auto
```

Creates a tmux session named `pancode-<hash>` (where hash is the first 6 characters of the SHA-256 digest of the working directory) and attaches to it. Each project gets its own session namespace. Multiple sessions can coexist.

If a session already exists for the current directory, a new one is created with an incrementing suffix: `pancode-a3f2b1-2`, `pancode-a3f2b1-3`, etc.

### pancode up

Attach to an existing PanCode tmux session.

```bash
pancode up                # Attach to most recent session
pancode up pancode-a3f2b1 # Attach to specific session by name
```

If the session is already attached in another terminal, the command fails with a message.

### pancode down

Stop PanCode tmux sessions.

```bash
pancode down              # Stop most recent session
pancode down pancode-a3f2b1  # Stop specific session
pancode down --all        # Stop all PanCode sessions
```

Shutdown is graceful: PanCode sends Ctrl+C to trigger the ShutdownCoordinator, waits up to 5 seconds for clean exit, then force-kills if needed. This gives workers time to receive SIGTERM and flush state.

### pancode sessions

List all running PanCode tmux sessions.

```bash
pancode sessions
```

Output:

```
2 sessions:

  pancode-a3f2b1   detached
  pancode-7e4c89   attached
```

### pancode version

Print the PanCode version number.

```bash
pancode version
# 0.3.0
```

### pancode login

Display instructions for in-shell provider authentication.

```bash
pancode login
# Use /login inside the PanCode shell to authenticate with providers.
```

### pancode reset

Clear runtime state while preserving user configuration.

```bash
pancode reset
```

**Cleared:**
- `.pancode/runs.json`, `metrics.json`, `budget.json`, `tasks.json`
- `.pancode/runtime/` (board.json, worker results)
- `~/.pancode/agent-engine/sessions/`

**Preserved:**
- `~/.pancode/panpresets.yaml`
- `~/.pancode/panagents.yaml`
- `~/.pancode/panproviders.yaml`
- `~/.pancode/settings.json`
- `~/.pancode/agent-engine/auth.json`

## Orchestrator Flags

These flags are passed to the orchestrator process when starting a new session. They can be combined with the base `pancode` command.

| Flag | Argument | Description |
|------|----------|-------------|
| `--preset <name>` | Preset name | Apply a boot preset (local, openai, openai-max, hybrid) |
| `--cwd <path>` | Directory path | Working directory for the session |
| `--provider <name>` | Provider name | Preferred provider for model resolution |
| `--model <id>` | Model reference | Model override in `provider/model-id` format |
| `--profile <name>` | Profile name | Config profile name |
| `--safety <level>` | Safety level | `suggest`, `auto-edit`, or `full-auto` |
| `--theme <name>` | Theme name | TUI theme name |
| `--rediscover` | (none) | Force full engine discovery, ignoring cache |
| `--fresh` | (none) | Clear runtime state before boot |
| `--help` | (none) | Show usage information |

### Flag Precedence

CLI flags override preset values. If you specify both `--preset local` and `--safety full-auto`, the safety level from the flag wins.

Priority: CLI flag > preset value > environment variable > project config > global config > default.

### Examples

```bash
# Start with local preset
pancode --preset local

# Override model from preset
pancode --preset local --model dynamo-lmstudio/qwen2.5-coder-32b

# Fresh start with full-auto safety
pancode --fresh --safety full-auto

# Force rediscovery on a specific project
pancode --cwd /path/to/project --rediscover

# Show help
pancode --help
```

## Session Naming

Session names use a project-specific hash to prevent collisions:

```
pancode-<hash>       # First session for a project
pancode-<hash>-2     # Second session for same project
pancode-<hash>-3     # Third session
```

The hash is the first 6 hex characters of the SHA-256 digest of the working directory path.

## tmux Integration

PanCode auto-configures tmux extended-keys for proper key handling:

```
extended-keys = on
extended-keys-format = csi-u
```

This enables keyboard shortcuts like Alt+A and Ctrl+Y to work correctly. The configuration is applied globally on session creation and silently fails on older tmux versions.

## See Also

- [Quick Start](../getting-started/quick-start.md): First-time usage walkthrough
- [Configuration Guide](../guides/configuration.md): Config resolution details
- [Keyboard Shortcuts](./keyboard-shortcuts.md): All keyboard shortcuts
