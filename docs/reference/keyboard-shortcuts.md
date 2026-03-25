# Keyboard Shortcuts

PanCode registers keyboard shortcuts for common operations. These work inside the PanCode tmux session.

## Shortcut Reference

Organized into four categories matching the `/hotkeys` command output.

### PanCode Shortcuts

| Shortcut | Action |
|----------|--------|
| Shift+Tab | Cycle mode (Plan, Build, Review). Auto-sets reasoning per mode unless explicitly overridden. |
| Alt+A | Toggle Admin (God) mode |
| Ctrl+Y | Cycle safety level (suggest, auto-edit, full-auto) |

### Navigation and Input

| Shortcut | Action |
|----------|--------|
| Ctrl+C | Interrupt current generation |
| Ctrl+D | Exit PanCode |
| Escape | Cancel current input or dismiss |
| Shift+Enter | Insert new line without submitting |
| Alt+Enter | Submit follow-up message |
| Ctrl+V | Paste image from clipboard |

### Model and Thinking

| Shortcut | Action |
|----------|--------|
| Ctrl+P | Cycle model forward |
| Shift+Ctrl+P | Cycle model backward |
| Ctrl+L | Select model (interactive) |
| Ctrl+T | Toggle thinking display |
| Ctrl+O | Expand tool details |

### Editor

| Shortcut | Action |
|----------|--------|
| Ctrl+G | Open external editor |
| Ctrl+K | Delete to end of line |
| Alt+Up | Dequeue last message |
| Ctrl+Z | Suspend to shell (fg to resume) |

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
