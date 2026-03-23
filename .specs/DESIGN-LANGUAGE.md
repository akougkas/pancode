# PanCode TUI Design Language

## Core Identity

PanCode's terminal UI is a mission control surface for multi-agent orchestration.
It presents real-time telemetry in a dense, scannable layout using the terminal
as a first-class rendering target. Every pixel of screen real estate carries
operational data.

## Visual Grammar

### Color Roles

The palette is built on the Pi SDK theme system. Dashboard widgets receive a
`DashboardColorizer` that wraps `theme.fg()` calls. This means colors
automatically adapt when the user switches Pi themes.

| Role | ThemeColor | Usage |
|------|-----------|-------|
| primary | custom (bold accent) | ASCII logo, hero text |
| accent | `accent` | Panel titles, active highlights, mode badge |
| bright | `text` or white | Values that need emphasis (counts, model names) |
| dim | `dim` | Borders, separators, timestamps, inactive items |
| muted | `muted` | Secondary labels, telemetry text |
| success | `success` | DONE status, OPERATIONAL, healthy metrics |
| error | `error` | ERROR status, failed tasks, alerts |
| warning | `warning` | BUSY status, WAIT, budget warnings |
| barFill | `accent` (mode-colored) | Filled portion of progress bars |
| barEmpty | `dim` | Empty portion of progress bars |

### Typography

Everything is monospace. No proportional text.

- **UPPERCASE** for panel titles, status badges, column headers, metric labels
- **lowercase** for agent names, model IDs, log messages, user input
- **Mixed case** forbidden in system-generated UI (only in user-provided content)

### Box Drawing

Single-line borders throughout. No rounded corners (reserving those for the
dispatch board's card style to differentiate it visually).

```
┌─TITLE ────────────────┐
│ content               │
│ content               │
└───────────────────────┘
```

- Title is inset 1 char from left border, rendered with accent color
- Fill characters extend from title to right corner
- Borders rendered with `dim` color to recede visually
- Content has 1-char padding on each side (inner = width - 4)

### Progress Bars

Block characters only. No smooth gradients, no percentage-width divs.

```
██████████████░░░░░░░░░░   (34%)
```

- `█` (U+2588) for filled portion, colored with barFill
- `░` (U+2591) for empty portion, colored with barEmpty
- Always integer character widths (no fractional fills)

### Status Badges

Agent and task statuses use whole-row coloring. The entire text line gets one
color function applied, avoiding mid-line ANSI mixing:

```
panos       ACTIVE      ← entire row in bright/white
scout       IDLE        ← entire row in dim
dev         ERROR       ← entire row in error/red
```

### Layout Grid

Two-column layout with fixed left sidebar:

```
╔════════════════╦══════════════════════════════════════════════╗
║  SIDEBAR (24)  ║             MAIN CONTENT (w-26)             ║
║                ║                                              ║
╚════════════════╩══════════════════════════════════════════════╝
```

- Sidebar: 24 columns, fixed
- Gap: 2 columns
- Main: remaining width
- Minimum viable width: 80 columns
- Design target: 120-140 columns

### Spacing Rules

- 0 blank lines between adjacent bordered panels (borders provide separation)
- 1 blank line inside panels between logical sections
- 2-char gap between side-by-side panels or metric cards

## Anti-Patterns

1. **No inline ANSI mixing.** Build plain text, pad to width, then wrap entire
   string in a single color function. This prevents truncation from splitting
   escape sequences.

2. **No fabricated metrics.** Every number on screen traces to a runtime API.
   If no data source exists, the panel should show "no data" or be omitted.

3. **No decorative elements.** Every character earns its place. No ornamental
   borders, no ASCII art dividers, no blank panels for symmetry.

4. **No smooth animations.** The TUI refreshes on events and a 1-second timer.
   State changes are instant, not animated.

5. **No hardcoded widths.** All layout calculations use the passed `width`
   parameter. Panels adapt to terminal size.
