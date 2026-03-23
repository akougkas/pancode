# PanCode TUI Design Tokens

## DashboardColorizer Interface

The colorizer bridges dashboard widgets to the Pi SDK theme system.
Constructed in extension.ts from `theme.fg()` calls:

```typescript
interface DashboardColorizer extends BoardColorizer {
  primary(text: string): string;   // Bold accent for logo/hero
  bright(text: string): string;    // High-contrast values
  barFill(text: string): string;   // Progress bar filled
  barEmpty(text: string): string;  // Progress bar empty
}
```

### Construction from Pi SDK Theme

```typescript
const colorizer: DashboardColorizer = {
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
};
```

The `barFill` color tracks the active mode (admin=orange, build=green, plan=purple,
, review=red). This makes the context gauge and progress bars
visually reflect what PanCode is doing.

## Box Drawing Characters

```
BOX.tl = ┌  (U+250C)
BOX.tr = ┐  (U+2510)
BOX.bl = └  (U+2514)
BOX.br = ┘  (U+2518)
BOX.h  = ─  (U+2500)
BOX.v  = │  (U+2502)
```

## Block Characters

```
BLOCK.full   = █  (U+2588)  progress bar fill
BLOCK.medium = ▒  (U+2592)  dense fill (used in footer context gauge)
BLOCK.light  = ░  (U+2591)  progress bar empty
```

## Layout Constants

```
SIDEBAR_WIDTH = 24      fixed left column
COLUMN_GAP    = 2       gap between columns
MIN_CARD_WIDTH = 16     minimum metric card width
MAX_LOG_ROWS  = 8       visible log entries
MAX_AGENT_ROWS = 8      visible agent rows (including header)
```

## Panel Inner Width Formula

```
inner = panelWidth - 4
```

- 2 for border characters (│ on each side)
- 2 for padding spaces (1 space each side)

## Column Width Formulas

### Metric Cards
```
cardWidth = max(16, floor((mainWidth - 6) / 4))
inner = cardWidth - 4
```
4 cards with 3 gaps of 2.

### Dispatch Table
```
colTokens = 7  (fixed)
avail = inner - colTokens
colId = min(10, max(6, floor(avail * 0.27)))
colAgent = min(10, max(6, floor(avail * 0.27)))
colStatus = max(4, avail - colId - colAgent)
```

### Dispatch/Log Split
```
dispatchWidth = max(30, floor((mainWidth - GAP) * 0.45))
logWidth = mainWidth - dispatchWidth - GAP
```

## ThemeColor Reference (Pi SDK)

Valid values for `theme.fg()`:

```
accent, border, borderAccent, borderMuted,
success, error, warning, muted, dim, text,
thinkingText, userMessageText, customMessageText,
customMessageLabel, toolTitle, toolOutput,
mdHeading, mdLink, mdLinkUrl, mdCode,
mdCodeBlock, mdCodeBlockBorder, mdQuote,
mdQuoteBorder, mdHr, mdListBullet,
toolDiffAdded, toolDiffRemoved, toolDiffContext,
syntaxComment, syntaxKeyword, syntaxFunction,
syntaxVariable, syntaxString, syntaxNumber,
syntaxType, syntaxOperator, syntaxPunctuation,
bashMode
```

## Mode Colors

```
capture → ThemeColor not defined; use custom #3b82f6
plan    → ThemeColor not defined; use custom #7f45e0
build   → ThemeColor not defined; use custom #16c858
ask     → ThemeColor not defined; use custom #fdac53
review  → ThemeColor not defined; use custom #dc5663
```

These are applied via the existing `modeThemeColor()` function in extension.ts,
which maps mode IDs to ThemeColor values.
