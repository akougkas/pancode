# PanCode TUI Design Language

Reference implementation: `.specs/ui-ux/design-snaps/welcome-dashbord.png`

## Layout Model: Symmetric Bento Box

The TUI is a grid of bordered panels arranged in a bento-box pattern.
Each panel is self-contained, scannable, and has a single responsibility.

```
╭─ Welcome Dashboard ────────────────────────────────────────────────────╮
│                                                                        │
│  ██████  █████  ██   ██  ┌─ Infrastructure ──┐  ┌─ Context ──────────┐│
│  ██  ██ ██  ██ ███  ██   │ Agents: 2/5      │  │ Usage: 34%         ││
│  ██████ █████  ██ █ ██   │ Runtimes: 8      │  │ CPU ▐██▌▐█▐        ││
│  ██     ██  ██ ██  ███   │ Nodes: 3         │  │ MEM ▐███▐██▐       ││
│  ██     ██  ██ ██   ██   │ Orch: Panos      │  │ Latency: 1.5s      ││
│                          └──────────────────┘  └────────────────────┘│
│                          ┌─ Model Registry ──┐  ┌─ Mode Guide ──────┐│
│                          │ Total: 40         │  │ Active: Ask        ││
│                          │ ■ local: 25       │  │                    ││
│                          │ ■ mini: 3         │  │ shift+tab modes    ││
│                          │ ■ dynamo: 12      │  │ /help commands     ││
│                          └──────────────────┘  └────────────────────┘│
╰────────────────────────────────────────────────────────────────────────╯
```

## Design Principles (codified, not aspirational)

```yaml
principles:
  density: "Every character carries operational data. No decorative filler."
  scannable: "Key metrics visible without scrolling. Label: Value pairs."
  symmetric: "Bento grid with equal-width cards per row."
  spacious: "Generous padding inside cards (1 char horizontal, 1 line vertical)."
  real_data: "Every displayed number traces to a runtime telemetry source."
  adaptive: "All widths derive from passed width parameter, never hardcoded."
  pure: "Widgets are pure functions: (state, width, colorizer) → string[]"
  theme_agnostic: "Colors flow through TuiColorizer slots, not raw ANSI."
```

## Border Rules

```yaml
borders:
  outer_container:
    style: rounded       # ╭╮╰╯
    color: dim
    title_color: accent
    title_case: "Title Case"
    title_position: "inset 1 char from left corner"
    examples:
      - "╭─ Welcome Dashboard ──────────────────╮"
      - "╭─ Dispatch ───────────────────────────╮"

  inner_cards:
    style: square        # ┌┐└┘
    color: dim
    title_color: accent
    title_case: "Title Case"
    examples:
      - "┌─ Infrastructure Overview ──────────┐"
      - "┌─ Model Registry ───────────────────┐"

  dispatch_cards:
    style: rounded       # ╭╮╰╯ (differentiates from static panels)
    color: dim
    note: "Dispatch cards use rounded corners for visual distinction"

  separators:
    char: "─"
    color: dim
    full_width: true
    note: "Thin horizontal rules between sections within a panel"
```

## Border Construction Patterns

```typescript
// Panel top border with inset title
function boxTop(title: string, width: number, c: TuiColorizer): string {
  const fillLen = Math.max(0, width - 4 - visibleWidth(title));
  return c.dim(BOX.tl + BOX.h) + c.accent(title) + c.dim(` ${BOX.h.repeat(fillLen)}${BOX.tr}`);
}
// Output: ┌─ Infrastructure Overview ────────────────┐

// Panel content line with padding
function boxLine(content: string, width: number, c: TuiColorizer): string {
  const inner = Math.max(0, width - 4);
  const fitted = padVisible(content, inner);
  return `${c.dim(BOX.v)} ${fitted} ${c.dim(BOX.v)}`;
}
// Output: │ Agents: 2 active / 5 total               │

// Panel bottom border
function boxBottom(width: number, c: TuiColorizer): string {
  return c.dim(BOX.bl + BOX.h.repeat(Math.max(0, width - 2)) + BOX.br);
}
// Output: └──────────────────────────────────────────┘

// Rounded outer border with inset title
function renderTopBorder(title: string, width: number, c: TuiColorizer): string {
  const fillLen = Math.max(0, width - 4 - visibleWidth(title));
  return c.dim("\u256D\u2500") + c.accent(title) + c.dim(` ${"\u2500".repeat(fillLen)}\u256E`);
}
// Output: ╭─ Dispatch ──────────────────────────────╮
```

## Typography Rules

```yaml
typography:
  font: monospace       # terminal default, no exceptions
  title_case: "Title Case"    # panel titles: "Infrastructure Overview"
  label_case: "Title Case"    # "Active Mode:", "Total Models:"
  value_case: "as-is"         # model IDs, agent names preserve original case
  status_case: "UPPERCASE"    # ACTIVE, IDLE, ERROR, RUNNING, DONE
  column_headers: "UPPERCASE" # RUN_ID, AGENT, STATUS, TOKENS
  shortcut_format: "[Key]label"  # [D]ashboard, [S]ettings, [Q]uit
```

## Content Line Patterns

```yaml
# Key-value pair (most common content pattern)
kv_line:
  format: "{label}: {value}"
  label_color: bright
  value_color: bright
  separator: ": "
  examples:
    - "Agents: 2 active / 5 total"
    - "Total Models: 40"
    - "Active Mode: Ask"
    - "Avg. Latency: 1.5s"

# Color-coded indicator (model registry, node indicators)
indicator_line:
  format: "{dot} {label}: {count}"
  dot: "■"    # U+25A0 filled square (1 char, colored per node)
  examples:
    - "■ local: 25"     # dot colored green
    - "■ mini: 3"       # dot colored cyan
    - "■ dynamo: 12"    # dot colored magenta

# Shortcut hint
shortcut_line:
  format: "{key_combo} for {action}"
  key_color: bright
  text_color: muted
  examples:
    - "shift+tab for modes"
    - "type '/help' for commands"
    - "ctrl+c to quit"
```

## Bento Grid Construction

```typescript
// 2x2 bento grid inside a panel (from screenshot)
function renderBentoGrid(
  cards: [string[], string[], string[], string[]],
  containerWidth: number,
  c: TuiColorizer,
): string[] {
  const innerWidth = containerWidth - 4; // panel padding
  const gap = 2;
  const leftWidth = Math.floor((innerWidth - gap) / 2);
  const rightWidth = innerWidth - leftWidth - gap;

  // Render cards[0]+cards[1] side by side (top row)
  // Render cards[2]+cards[3] side by side (bottom row)
  const topRow = mergeColumns(cards[0], cards[1], leftWidth, rightWidth, gap);
  const bottomRow = mergeColumns(cards[2], cards[3], leftWidth, rightWidth, gap);

  return [...topRow, ...bottomRow];
}

function mergeColumns(
  left: string[],
  right: string[],
  leftWidth: number,
  rightWidth: number,
  gap: number,
): string[] {
  const maxLines = Math.max(left.length, right.length);
  const result: string[] = [];
  for (let i = 0; i < maxLines; i++) {
    const l = i < left.length ? padVisible(left[i], leftWidth) : " ".repeat(leftWidth);
    const r = i < right.length ? padVisible(right[i], rightWidth) : " ".repeat(rightWidth);
    result.push(`${l}${" ".repeat(gap)}${r}`);
  }
  return result;
}
```

## Full TUI Bento Layout (target view)

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ Header: product | mode | model                                    HH:MM:SS │
├──────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ┌─ Menu ──────┐  ╭─ Banner (logo + status) ────────────────────────────╮  │
│  │ [D]ashboard │  │  ██████  █████  ██   ██  ┌─ Context ─┐ ┌─ Workers ┐│  │
│  │ [E]ditor    │  │  ██  ██ ██  ██ ███  ██   │ usage 34% │ │ 2 active ││  │
│  │ [A]gents    │  │  ...                     └───────────┘ └──────────┘│  │
│  │ [L]ogs      │  ╰────────────────────────────────────────────────────╯  │
│  │ [S]ettings  │                                                          │
│  │ [Q]uit      │  ┌─ Infra ──┐ ┌─ Models ──┐ ┌─ Session ─┐ ┌─ Mode ──┐ │
│  └─────────────┘  │ nodes: 3 │ │ total: 40 │ │ runs: 7   │ │ Ask     │ │
│                    │ runtimes │ │ local: 25 │ │ $0.12     │ │ safety  │ │
│  ┌─ Agents ────┐  └──────────┘ └───────────┘ └───────────┘ └─────────┘ │
│  │ scout ACTIVE│                                                          │
│  │ dev   IDLE  │  ╭─ Dispatch ──────────────╮ ┌─ Logs ──────────────────┐│
│  │ plan  IDLE  │  │  ACTIVE                 │ │ [12:34] Agent started   ││
│  └─────────────┘  │  ╭──────╮  ╭──────╮    │ │ [12:35] Dispatch done   ││
│                    │  │ dev  │  │scout │    │ │ [12:36] Budget: $0.12   ││
│  ╭─ Codex ─────╮  │  ╰──────╯  ╰──────╯    │ └─────────────────────────┘│
│  │ prompt area  │  │  RECENT                 │                            │
│  ╰─────────────╯  │  ✓ scout  Found 8 files │                            │
│                    ╰────────────────────────╯                            │
│                                                                              │
├──────────────────────────────────────────────────────────────────────────────┤
│ ─── Build ── auto-edit ── claude-opus-4-6 ── reasoning:high ──────────────  │
│   ● 2 active  dev → sdk:claude-code (23s, 1.2k tok)                        │
│   Runs: 7  Cost: $0.12  Tokens: 23k in / 8k out                            │
│   Context: [████████████░░░░░░░░] 42%  sys│tools│dispatch│panos│free        │
│   [Tab] mode  [^P] model  [^L] select  [^O] expand  [^T] thinking          │
└──────────────────────────────────────────────────────────────────────────────┘
```

## Widget Rendering Contract

```typescript
// Every widget follows this contract
type WidgetRenderer<S> = (state: S, width: number, c: TuiColorizer) => string[];

// No Pi SDK imports in widget files
// No side effects
// No direct ANSI escapes (use colorizer slots)
// All width calculations from the passed width parameter
// Return value: array of terminal-ready strings, one per line
```

## Color Application Rules

```yaml
rules:
  - name: "No inline ANSI mixing"
    description: "Build plain text string, pad to width, then wrap in ONE color function"
    bad:  "c.accent('hello') + ' ' + c.dim('world')"
    good: "c.dim(padRight('hello world', inner))"
    exception: "Status lines with icon + text + elapsed can use 2-3 segments"

  - name: "Structural chrome is dim"
    description: "All borders, separators, box-drawing chars use c.dim()"

  - name: "Titles are accent"
    description: "Panel titles in borders use c.accent()"

  - name: "Values are bright"
    description: "Numeric values, model names, counts use c.bright()"

  - name: "Labels are muted or default"
    description: "Key names in kv pairs use default or c.muted()"

  - name: "Status uses semantic colors"
    mapping:
      running: accent
      done: success
      error: error
      pending: dim
      timeout: warning
      budget_exceeded: warning
```

## Anti-Patterns

```yaml
banned:
  - pattern: "Fabricated metrics"
    reason: "Every number on screen traces to a runtime API call"
  - pattern: "Decorative filler"
    reason: "No blank panels for symmetry, no ornamental borders"
  - pattern: "Hardcoded widths"
    reason: "All calculations use the passed width parameter"
  - pattern: "Raw ANSI escapes in widget code"
    reason: "Use TuiColorizer slots exclusively"
  - pattern: "Smooth animations"
    reason: "TUI refreshes on events + 1s timer. State changes are instant."
  - pattern: "Importing Pi SDK in widget files"
    reason: "Widgets are pure functions. Theme bridging happens in extension.ts."
```
