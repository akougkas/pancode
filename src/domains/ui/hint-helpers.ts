/**
 * Read-only hint helpers for slash command panels.
 * Configuration changes happen through conversation with Panos.
 * Keyboard shortcuts (ctrl+y, shift+tab, alt+a) are the only direct mutation paths.
 */

/** Top-of-panel banner indicating a read-only view. */
export function readOnlyBanner(): string {
  return "\u2139 Read-only view. Ask Panos to change any setting, or use keyboard shortcuts.";
}

/** Bottom-of-panel hint with example phrases and keyboard shortcuts. */
export function settingHint(examples: ReadonlyArray<string>, shortcuts: ReadonlyArray<string>): string {
  const exStr = examples.map((e) => `"${e}"`).join("  ");
  const scStr = shortcuts.join("  ");
  return `Tip: ${exStr} | ${scStr}`;
}

/** Inline hint next to a configurable value showing how to change it conversationally. */
export function inlineHint(phrase: string): string {
  return `(say "${phrase}")`;
}
