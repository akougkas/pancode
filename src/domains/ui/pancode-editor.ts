import { CustomEditor, truncateToWidth, visibleWidth } from "../../engine/tui";

/** Minimum terminal width for label injection. Below this, plain borders are used. */
const MIN_LABEL_WIDTH = 40;

/**
 * PanCode custom editor with mode and safety labels on border lines.
 *
 * Follows the Pi SDK modal-editor pattern: call super.render(), then minimally
 * modify the first and last lines by truncating from the right and appending
 * labels. This preserves the editor's internal ANSI styling, scroll indicators,
 * cursor markers, and accessibility properties.
 *
 * Top border:  ──────────────────────────────── Build ──
 * Bottom border: ─────────────────── auto-edit  shift+tab ──
 */
export class PanCodeEditor extends CustomEditor {
  private modeLabel = "Build";
  private modeColorFn: (s: string) => string = (s) => s;
  private safetyLabel = "auto-edit";

  setModeDisplay(label: string, colorFn: (s: string) => string): void {
    this.modeLabel = label;
    this.modeColorFn = colorFn;
  }

  setSafetyDisplay(label: string): void {
    this.safetyLabel = label;
  }

  render(width: number): string[] {
    const lines = super.render(width);
    if (lines.length < 2 || width < MIN_LABEL_WIDTH) return lines;

    // Top border: truncate existing border from right, append mode label.
    // Build the tag first, then measure it with visibleWidth() to get the
    // exact visible character count including all spaces. Never compute
    // width manually; always measure the actual constructed string.
    const modeTag = this.modeColorFn(` ${this.modeLabel} `) + this.borderColor("──");
    const modeTagWidth = visibleWidth(modeTag);
    if (visibleWidth(lines[0]) >= modeTagWidth + 4) {
      lines[0] = truncateToWidth(lines[0], width - modeTagWidth, "") + modeTag;
    }

    // Bottom border: truncate existing border from right, append safety + hint.
    const bottomIdx = lines.length - 1;
    const safetyTag = this.modeColorFn(this.safetyLabel) + this.borderColor("  shift+tab ──");
    const safetyTagWidth = visibleWidth(safetyTag);
    if (visibleWidth(lines[bottomIdx]) >= safetyTagWidth + 4) {
      lines[bottomIdx] = truncateToWidth(lines[bottomIdx], width - safetyTagWidth, "") + safetyTag;
    }

    return lines;
  }
}
