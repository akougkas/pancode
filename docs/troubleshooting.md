# Troubleshooting

Common issues, diagnostic commands, and solutions for PanCode.

## Diagnostic Commands

### /doctor

The primary diagnostic tool. Runs 8 health checks:

```
/doctor
```

```
Health Report: 7 pass, 1 warn, 0 fail

  [OK] runtime-dir            Runtime directory exists and is writable
  [OK] orphan-workers         No active worker processes
  [OK] stale-runs             No stale runs detected
  [!!] provider-health        1 provider(s) marked unhealthy
  [OK] json-file-integrity    State files parse correctly
  [OK] session-dir-size       Session directory within limits
  [OK] budget-headroom        Budget has remaining headroom
  [OK] model-available        At least one model available
```

### Other Diagnostic Commands

```
/perf              # Boot phase timing breakdown
/session           # Session state summary
/audit             # Structured audit trail
/metrics           # Aggregate dispatch statistics
```

## Common Issues

### No Models Available at Boot

**Symptom:**
```
[pancode:orchestrator] No models resolved at boot. Starting in degraded mode.
```

**Cause:** No local engines are running and no API keys are configured.

**Solutions:**

1. Start a local engine:
   ```bash
   ollama serve          # Ollama on port 11434
   # or start LM Studio  # Port 1234
   # or llama-server      # Port 8080
   ```

2. Set an API key:
   ```bash
   export ANTHROPIC_API_KEY=sk-ant-...
   export OPENAI_API_KEY=sk-...
   ```

3. Restart PanCode or use `--rediscover`:
   ```bash
   pancode --rediscover
   ```

### tmux Not Installed

**Symptom:**
```
[pancode] tmux is not installed. Install tmux to use PanCode.
```

**Solution:** Install tmux for your platform:
- macOS: `brew install tmux`
- Ubuntu/Debian: `sudo apt install tmux`
- Fedora: `sudo dnf install tmux`
- Arch: `sudo pacman -S tmux`

### Build Failures

**Symptom:** `npm run build` fails.

**Checklist:**

1. Verify Node.js version: `node --version` (must be 20+)
2. Clean install: `rm -rf node_modules && npm install`
3. Build Pi SDK first: `npm run build:pi`
4. Check TypeScript: `npm run typecheck`
5. Check boundaries: `npm run check-boundaries`

### Slow Boot

**Symptom:** Boot takes more than 3 seconds. Warning message appears:

```
[pancode:boot] WARNING: Startup took 4200ms, exceeding budget of 3000ms.
Slowest phase: discovery (3100ms).
```

**Solutions:**

1. Use warm boot (do not pass `--rediscover`). Warm boot reads from cache (~120ms).
2. Reduce dead endpoints. Remove machines from `PANCODE_LOCAL_MACHINES` that are powered off.
3. Check `/perf` for the slow phase.
4. Adjust the budget threshold: `PANCODE_STARTUP_BUDGET_MS=5000`

### Provider Not Discovered

**Symptom:** `/models` does not show expected models. `/doctor` shows provider health warnings.

**Checklist:**

1. Verify the engine is running:
   ```bash
   curl http://localhost:11434/api/tags     # Ollama
   curl http://localhost:1234/v1/models     # LM Studio
   curl http://localhost:8080/health        # llama.cpp
   ```

2. For remote machines, verify connectivity:
   ```bash
   ping 192.168.86.141
   curl http://192.168.86.141:11434/api/tags
   ```

3. Check `PANCODE_LOCAL_MACHINES` is set correctly in `.env`

4. Force rediscovery:
   ```bash
   pancode --rediscover
   ```

### Dispatch Failures

**Symptom:** Dispatches fail or are blocked.

**Diagnostic commands:**

```
/runs              # View dispatch history and status
/audit dispatch    # Dispatch-specific audit entries
/audit error       # Error entries only
```

**Common causes:**

| Cause | Message | Fix |
|-------|---------|-----|
| Wrong mode | "Dispatch disabled in Plan mode" | Switch to Build (Shift+Tab) |
| Readonly violation | "Agent is not readonly" | Use readonly agent or switch to Build mode |
| Recursion limit | "Recursion depth exceeds maximum" | Reduce nesting or increase `PANCODE_DISPATCH_MAX_DEPTH` |
| Budget exceeded | "Budget ceiling would be exceeded" | Increase `PANCODE_BUDGET_CEILING` |
| Scope violation | "resolves outside the project root" | Keep file paths within the project directory |
| Draining | "System is shutting down" | Wait for shutdown or restart |

### Budget Exceeded

**Symptom:**
```
Dispatch blocked: Budget ceiling would be exceeded
(spent: $9.50, estimated next: $0.75, ceiling: $10.00)
```

**Solutions:**

1. Increase the ceiling: "Set budget to $25" (requires Admin mode)
2. Set via environment: `PANCODE_BUDGET_CEILING=25.00`
3. Check spending: `/budget`

### Stale Runs

**Symptom:** `/doctor` reports stale runs:

```
[!!] stale-runs    2 run(s) started over 1 hour ago still marked as running
```

**Cause:** Workers from a previous session were not cleaned up properly.

**Solutions:**

1. PanCode automatically reaps orphaned runs at boot. Restart PanCode.
2. Clean up manually: `pancode reset`
3. Use `--fresh` flag: `pancode --fresh`

### Keyboard Shortcuts Not Working

**Symptom:** Shift+Tab, Alt+A, or Ctrl+Y do not respond.

**Cause:** tmux extended-keys not supported or not configured.

**Solutions:**

1. Verify tmux version: `tmux -V` (3.2+ recommended)
2. PanCode auto-configures extended-keys, but older versions may not support them
3. Use slash commands as alternatives: `/modes`, `/safety`

## Runtime State Reset

To clear all runtime state without losing configuration:

```bash
pancode reset
```

**Cleared:**
- `.pancode/runs.json` (dispatch history)
- `.pancode/metrics.json` (dispatch metrics)
- `.pancode/budget.json` (budget tracking)
- `.pancode/tasks.json` (task list)
- `.pancode/runtime/` (board, worker results)
- `~/.pancode/agent-engine/sessions/` (session history)

**Preserved:**
- `~/.pancode/panpresets.yaml` (presets)
- `~/.pancode/panagents.yaml` (agent fleet)
- `~/.pancode/panproviders.yaml` (provider endpoints)
- `~/.pancode/settings.json` (user preferences)
- `~/.pancode/model-cache.yaml` (model cache)
- `~/.pancode/agent-engine/auth.json` (auth tokens)

The `--fresh` boot flag does the same thing at startup:

```bash
pancode --fresh
```

## Getting Help

```
/help          # List all commands
/hotkeys       # Show keyboard shortcuts
/doctor        # Run health checks
/audit         # Review the audit trail
```

## See Also

- [Installation](./getting-started/installation.md): Prerequisites and setup
- [Configuration Guide](./guides/configuration.md): Environment variables and settings
- [Commands Reference](./reference/commands.md): Complete command reference
- [Providers Guide](./guides/providers.md): Provider discovery and configuration
