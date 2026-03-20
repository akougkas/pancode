import { CustomEditor, visibleWidth } from "../../engine/tui";

/** Minimum terminal width for label injection. Below this, plain borders are used. */
const MIN_LABEL_WIDTH = 40;

/**
 * PanCode custom editor that displays mode and safety labels on the border lines.
 *
 * Top border:  ───────────────────────────────── Build ──
 * Bottom border: ── auto-edit ────────────────── shift+tab ──
 *
 * Border color follows the active mode's theme color. Labels update
 * dynamically on mode switch, safety change, and theme change.
 */
export class PanCodeEditor extends CustomEditor {
  private modeLabel = "Build";
  private modeColorFn: (s: string) => string = (s) => s;
  private safetyLabel = "auto-edit";

  setModeDisplay(label: string, colorFn: (s: string) => string): void {
    this.modeLabel = label;
    this.modeColorFn = colorFn;
    this.invalidate();
  }

  setSafetyDisplay(label: string): void {
    this.safetyLabel = label;
    this.invalidate();
  }

  render(width: number): string[] {
    const lines = super.render(width);
    // Need at least 2 lines (top border + bottom border) to inject labels.
    // Skip label injection for very narrow terminals.
    if (lines.length < 2 || width < MIN_LABEL_WIDTH) return lines;

    lines[0] = this.buildTopBorder(width);
    lines[lines.length - 1] = this.buildBottomBorder(width);

    return lines;
  }

  /**
   * Build top border with mode label on the right.
   * Format: ───────────────────────────────── Build ──
   *
   * All border characters are colored via this.borderColor (from the EditorTheme).
   * The mode label is colored via the mode's theme color function.
   */
  private buildTopBorder(width: number): string {
    const label = ` ${this.modeLabel} `;
    const labelVisible = visibleWidth(label);
    const suffixStr = "──";
    const suffixLen = 2;
    const fillLen = Math.max(0, width - labelVisible - suffixLen);

    // Build the fill as a single string of box-drawing chars, then color once.
    // Do NOT repeat a pre-colored string (which would duplicate ANSI escapes).
    const fill = this.borderColor("─".repeat(fillLen));
    const coloredLabel = this.modeColorFn(label);
    const suffix = this.borderColor(suffixStr);

    return `${fill}${coloredLabel}${suffix}`;
  }

  /**
   * Build bottom border with safety label left and key hint right.
   * Format: ── auto-edit ────────────────── shift+tab ──
   */
  private buildBottomBorder(width: number): string {
    const prefixStr = "── ";
    const prefixLen = 3;
    const safetyText = `${this.safetyLabel} `;
    const safetyVisible = visibleWidth(safetyText);
    const hintStr = " shift+tab ";
    const hintVisible = visibleWidth(hintStr);
    const suffixStr = "──";
    const suffixLen = 2;

    const usedWidth = prefixLen + safetyVisible + hintVisible + suffixLen;
    const fillLen = Math.max(0, width - usedWidth);

    const prefix = this.borderColor(prefixStr);
    const coloredSafety = this.modeColorFn(safetyText);
    const fill = this.borderColor("─".repeat(fillLen));
    const hint = this.borderColor(hintStr);
    const suffix = this.borderColor(suffixStr);

    return `${prefix}${coloredSafety}${fill}${hint}${suffix}`;
  }
}
