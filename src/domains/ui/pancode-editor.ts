import { CustomEditor, truncateToWidth, visibleWidth } from "../../engine/tui";

/**
 * PanCode editor with mode-colored borders and informational labels.
 *
 * Top border:    ─── provider/model ─────────────────── Build ──
 * Bottom border: ─── reasoning:level ──────────────── auto-edit ──
 *
 * Border color changes per mode. The entire border line is rendered in the
 * mode's theme color, making mode transitions visually immediate.
 *
 * Follows the Pi SDK modal-editor pattern: call super.render(), then
 * truncate existing border lines from the right and append labels.
 * Never modifies content lines, cursor markers, or input handling.
 */
export class PanCodeEditor extends CustomEditor {
  private modeLabel = "Build";
  private modeColorFn: (s: string) => string = (s) => s;
  private safetyLabel = "auto-edit";
  private modelLabel = "";
  private reasoningLabel = "off";

  setModeDisplay(label: string, colorFn: (s: string) => string): void {
    this.modeLabel = label;
    this.modeColorFn = colorFn;
    // Color the entire border in the mode color for strong visual signal.
    this.borderColor = colorFn;
  }

  setSafetyDisplay(label: string): void {
    this.safetyLabel = label;
  }

  setModelDisplay(label: string): void {
    this.modelLabel = label;
  }

  setReasoningDisplay(label: string): void {
    this.reasoningLabel = label;
  }

  render(width: number): string[] {
    const lines = super.render(width);
    if (lines.length < 2 || width < 50) return lines;

    // Top border: model on left, mode on right.
    // Format: ─── provider/model ──────────────────── Build ──
    const topLeft = this.modelLabel ? ` ${this.modelLabel} ` : "";
    const topRight = ` ${this.modeLabel} `;
    const topTagsWidth = visibleWidth(topLeft) + visibleWidth(topRight);
    if (topTagsWidth + 10 <= width) {
      const colorLeft = this.modeColorFn(topLeft);
      const colorRight = this.modeColorFn(topRight);
      // Truncate the existing border, inject left tag, fill, inject right tag.
      const fillWidth = width - topTagsWidth;
      const fill = this.modeColorFn("\u2500".repeat(fillWidth));
      const newTop = fill.length > 0 ? `${colorLeft}${fill}${colorRight}` : lines[0];
      if (visibleWidth(newTop) <= width) {
        lines[0] = newTop;
      }
    }

    // Bottom border: reasoning on left, safety on right.
    // Format: ─── reasoning:level ──────────────── auto-edit ──
    const bottomLeft = ` ${this.reasoningLabel} `;
    const bottomRight = ` ${this.safetyLabel} `;
    const bottomTagsWidth = visibleWidth(bottomLeft) + visibleWidth(bottomRight);
    const lastIdx = lines.length - 1;
    if (bottomTagsWidth + 10 <= width) {
      const colorLeft = this.modeColorFn(bottomLeft);
      const colorRight = this.modeColorFn(bottomRight);
      const fillWidth = width - bottomTagsWidth;
      const fill = this.modeColorFn("\u2500".repeat(fillWidth));
      const newBottom = `${colorLeft}${fill}${colorRight}`;
      if (visibleWidth(newBottom) <= width) {
        lines[lastIdx] = newBottom;
      }
    }

    return lines;
  }
}
