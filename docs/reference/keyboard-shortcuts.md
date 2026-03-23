# Keyboard Shortcuts

PanCode registers keyboard shortcuts for common operations. These work inside the PanCode tmux session.

## Shortcut Reference

| Shortcut | Action | Description |
|----------|--------|-------------|
| Shift+Tab | Cycle modes | Rotates through Plan, Build, Review |
| Alt+A | Toggle Admin | Enters or exits God Mode |
| Ctrl+Y | Cycle safety | Rotates through suggest, auto-edit, full-auto |
| Ctrl+D | Exit | Exit PanCode (Pi SDK built-in) |
| Ctrl+O | Expand tools | Expand tool output display (Pi SDK built-in) |
| Ctrl+T | Toggle thinking | Show/hide reasoning output (Pi SDK built-in) |

## Mode Cycling (Shift+Tab)

Shift+Tab cycles through the three standard modes in order:

```
Plan -> Build -> Review -> Plan -> ...
```

Admin mode is excluded from the cycle. Use Alt+A to toggle Admin independently.

Each mode switch:
- Changes the active tool set (e.g., Build adds write/edit tools, Plan removes dispatch tools)
- Adjusts the default reasoning level
- Emits a mode transition message explaining the new mode's capabilities

### Mode Summary

| Mode | Dispatch | File Mutations | Reasoning | Color |
|------|----------|----------------|-----------|-------|
| Plan | Disabled | No | High | Purple |
| Build | Enabled | Yes | Medium | Green |
| Review | Enabled (readonly only) | No | Extra High | Red |
| Admin | Enabled | No | Extra High | Blue |

## Admin Mode (Alt+A)

Alt+A toggles Admin (God Mode). On entry:

- Safety escalates to `full-auto`
- Reasoning escalates to `xhigh`
- Full tool set becomes available (dispatch, shadow, tasks, config)
- File mutations remain disabled

On exit, safety and reasoning revert to their previous values. The mode returns to whatever was active before Admin was entered.

## Safety Cycling (Ctrl+Y)

Ctrl+Y cycles safety levels:

```
suggest -> auto-edit -> full-auto -> suggest -> ...
```

The change takes effect immediately for all subsequent tool calls and dispatch operations.

## Pi SDK Shortcuts

These shortcuts are built into the Pi SDK and cannot be overridden:

| Shortcut | Action |
|----------|--------|
| Ctrl+D | Exit the application |
| Ctrl+O | Expand tool output |
| Ctrl+T | Toggle thinking/reasoning visibility |

## tmux Requirements

PanCode auto-configures tmux extended-keys at session creation:

```
extended-keys = on
extended-keys-format = csi-u
```

This enables proper handling of Alt and Ctrl key combinations. If your tmux version does not support extended keys, some shortcuts may not function.

## Slash Command Alternatives

Every keyboard shortcut has a slash command equivalent:

| Shortcut | Equivalent Command |
|----------|-------------------|
| Shift+Tab | `/modes` |
| Alt+A | `/modes admin` |
| Ctrl+Y | `/safety` |
| Ctrl+D | `/exit` |

## Footer Hint Bar

The TUI footer displays available shortcuts:

```
ctrl+y:safety  |  shift+tab:mode  |  /dashboard  |  /reasoning
```

## See Also

- [Quick Start](../getting-started/quick-start.md): Overview of modes and shortcuts
- [Commands Reference](./commands.md): All slash commands
- [CLI Reference](./cli.md): External CLI commands
