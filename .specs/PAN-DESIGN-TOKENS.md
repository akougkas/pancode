# PanCode TUI Design Tokens

Machine-readable reference for all visual constants.
Every value is used in code. No aspirational tokens.

## Color Slots (TuiColorizer)

```yaml
# 12-slot unified color interface. Constructed in extension.ts from Pi SDK theme.
# All slots are functions: (text: string) => string

slots:
  accent:   { piTheme: "accent",  usage: "panel titles, active highlights, interactive elements" }
  bold:     { piTheme: "bold()",   usage: "strong emphasis, agent names in cards" }
  muted:    { piTheme: "muted",   usage: "secondary labels, telemetry text, key names" }
  dim:      { piTheme: "dim",     usage: "borders, separators, timestamps, structural chrome" }
  success:  { piTheme: "success", usage: "done status, healthy state, operational indicator" }
  error:    { piTheme: "error",   usage: "error status, failed tasks, auth failures" }
  warning:  { piTheme: "warning", usage: "busy status, budget warnings, stale workers" }
  primary:  { piTheme: "bold(accent)", usage: "ASCII logo, hero text, banner headings" }
  bright:   { piTheme: "text",    usage: "high-contrast values, counts, model names, shortcuts" }
  barFill:  { piTheme: "mode-color", usage: "filled portion of progress bars" }
  barEmpty: { piTheme: "dim",     usage: "empty portion of progress bars" }
  mode:     { piTheme: "mode-color", usage: "mode badge, mode-specific highlights" }
```

```typescript
// Construction in extension.ts (source of truth for theme bridging)
const colorizer: TuiColorizer = {
  accent:  (t) => theme.fg("accent", t),
  bold:    (t) => theme.bold(t),
  muted:   (t) => theme.fg("muted", t),
  dim:     (t) => theme.fg("dim", t),
  success: (t) => theme.fg("success", t),
  error:   (t) => theme.fg("error", t),
  warning: (t) => theme.fg("warning", t),
  primary: (t) => theme.bold(theme.fg("accent", t)),
  bright:  (t) => theme.fg("text", t),
  barFill: (t) => theme.fg(modeThemeColor(getModeDefinition()), t),
  barEmpty:(t) => theme.fg("dim", t),
  mode:    (t) => theme.fg(modeThemeColor(getModeDefinition()), t),
};
```

## Mode Colors

```yaml
# Custom hex values (Pi SDK ThemeColor does not define mode colors)
modes:
  capture: "#3b82f6"   # blue
  plan:    "#7f45e0"   # purple
  build:   "#16c858"   # green
  ask:     "#fdac53"   # orange/amber
  review:  "#dc5663"   # red
```

## Runtime-Specific Accent Colors

```yaml
# Used for runtime-specialized widget theming (e.g., Claude SDK card)
runtimes:
  pi:              { accent: null, note: "uses default theme accent (green)" }
  sdk:claude-code: { accent: "#D97706", fallback256: 172, fallback16: "yellow", label: "Anthropic orange" }
  cli:claude-code: { accent: "#D97706", fallback256: 172, fallback16: "yellow", label: "Anthropic orange" }
  cli:codex:       { accent: "#10B981", fallback256: 36,  fallback16: "green",  label: "OpenAI green" }
  cli:gemini:      { accent: "#4285F4", fallback256: 33,  fallback16: "blue",   label: "Google blue" }
```

```typescript
// ANSI escape construction for runtime accents
function runtimeAccent(hex: string, fallback256: number): (text: string) => string {
  // Prefer truecolor, fall back to 256-color
  return (text: string) => `\x1b[38;2;${hexToRgb(hex)}m${text}\x1b[39m`;
}
```

## Box Drawing Characters

```yaml
# Single-line (inner cards, panels, tables)
box:
  tl: "\u250C"   # ┌
  tr: "\u2510"   # ┐
  bl: "\u2514"   # └
  br: "\u2518"   # ┘
  h:  "\u2500"   # ─
  v:  "\u2502"   # │

# Rounded (outer dashboard border, dispatch board border)
rounded:
  tl: "\u256D"   # ╭
  tr: "\u256E"   # ╮
  bl: "\u2570"   # ╰
  br: "\u256F"   # ╯
  h:  "\u2500"   # ─ (same horizontal)
  v:  "\u2502"   # │ (same vertical)
```

## Block Characters

```yaml
blocks:
  full:   "\u2588"   # █  progress bar fill, sparkline bars
  medium: "\u2592"   # ▒  dense fill (footer context gauge)
  light:  "\u2591"   # ░  progress bar empty
  half_upper: "\u2580"  # ▀  sparkline top half
  half_lower: "\u2584"  # ▄  sparkline bottom half
```

## Status Icons

```yaml
status_icons:
  pending:         "\u25CB"   # ○  hollow circle
  running:         "\u25CF"   # ●  filled circle
  done:            "\u2713"   # ✓  checkmark
  error:           "\u2717"   # ✗  cross
  cancelled:       "\u2298"   # ⊘  circled slash
  interrupted:     "\u2298"   # ⊘
  timeout:         "\u2298"   # ⊘
  budget_exceeded: "\u2298"   # ⊘
```

## Layout Constants

```yaml
layout:
  sidebar_width: 24          # fixed left column (menu + agent registry)
  column_gap: 2              # gap between side-by-side panels
  card_gap: 2                # gap between cards in a grid row
  min_card_width: 24         # minimum dispatch card width
  card_height: 6             # fixed dispatch card height (lines)
  indent: "  "               # 2-space indent for content inside boards
  panel_padding_x: 1         # 1 space each side inside bordered panels
  panel_padding_y: 0         # no vertical padding (content starts on next line)
  max_log_rows: 8            # visible log entries
  max_agent_rows: 8          # visible agent rows (including header)

breakpoints:
  compact: 100               # below 100 cols: single column stacked
  standard: [100, 160]       # 100-160 cols: sidebar + main
  wide: 160                  # above 160 cols: sidebar + main + secondary
```

## Panel Inner Width Formula

```typescript
// All panels use this formula
const inner = panelWidth - 4;  // 2 for borders (│), 2 for padding spaces

// Grid card width
const cardWidth = Math.max(24, Math.floor((availableWidth - (cols - 1) * CARD_GAP) / cols));

// Bento grid (2x2 metric cards from screenshot)
const bentoGap = 2;
const leftWidth = Math.floor((innerWidth - bentoGap) / 2);
const rightWidth = innerWidth - leftWidth - bentoGap;
```

## Dispatch/Log Split

```yaml
split:
  dispatch_ratio: 0.45       # dispatch gets 45% of main width
  log_ratio: 0.55            # logs get 55% of main width
  min_dispatch: 30           # minimum dispatch panel width
```

## Progress Bar Rendering

```typescript
function renderProgressBar(value: number, max: number, width: number, c: TuiColorizer): string {
  const pct = max > 0 ? Math.min(1, value / max) : 0;
  const filled = Math.round(pct * width);
  const empty = width - filled;
  return c.barFill(BLOCK.full.repeat(filled)) + c.barEmpty(BLOCK.light.repeat(empty));
}
// Output (width=20, 74%): ██████████████░░░░░░
```

## Sparkline Rendering

```typescript
// Mini bar chart (from screenshot: CPU/MEM indicators)
function renderSparkline(values: number[], height: number, width: number, c: TuiColorizer): string {
  const max = Math.max(...values, 1);
  return values
    .slice(-width)
    .map((v) => {
      const barHeight = Math.round((v / max) * height);
      return barHeight > 0 ? c.barFill(BLOCK.full) : c.barEmpty(BLOCK.light);
    })
    .join("");
}
// Output: ▐█▌▐██▐
```

## Pi SDK ThemeColor Reference

```yaml
# Valid values for theme.fg(colorName, text)
theme_colors:
  text: [accent, border, borderAccent, borderMuted, success, error, warning,
         muted, dim, text, thinkingText, userMessageText, customMessageText,
         customMessageLabel, toolTitle, toolOutput]
  markdown: [mdHeading, mdLink, mdLinkUrl, mdCode, mdCodeBlock,
             mdCodeBlockBorder, mdQuote, mdQuoteBorder, mdHr, mdListBullet]
  diff: [toolDiffAdded, toolDiffRemoved, toolDiffContext]
  syntax: [syntaxComment, syntaxKeyword, syntaxFunction, syntaxVariable,
           syntaxString, syntaxNumber, syntaxType, syntaxOperator, syntaxPunctuation]
  special: [bashMode]
```
