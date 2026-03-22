import { CustomEditor, truncateToWidth, visibleWidth } from "../../engine/tui";

/**
 * PanCode editor with mode-colored borders and informational labels.
 *
 * Top border:    ─── Build ─────────────────────────────
 * Bottom border: ─── model-name · on · full-auto ──
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

    // Top border: mode label only.
    // Format: ─── Build ─────────────────────────────
    const topTag = ` ${this.modeLabel} `;
    const topTagWidth = visibleWidth(topTag);
    if (topTagWidth + 10 <= width) {
      const colorTag = this.modeColorFn(topTag);
      const fillWidth = width - topTagWidth;
      const fill = this.modeColorFn("\u2500".repeat(fillWidth));
      const newTop = `${colorTag}${fill}`;
      if (visibleWidth(newTop) <= width) {
        lines[0] = newTop;
      }
    }

    // Bottom border: model + reasoning + safety.
    // Format: ─── model-name · reasoning · safety ──
    const modelShort = this.modelLabel.includes("/")
      ? this.modelLabel.split("/").pop() ?? this.modelLabel
      : this.modelLabel;
    const bottomParts = [modelShort, this.reasoningLabel, this.safetyLabel].filter(Boolean);
    const bottomTag = ` ${bottomParts.join(" \u00B7 ")} `;
    const bottomTagWidth = visibleWidth(bottomTag);
    const lastIdx = lines.length - 1;
    if (bottomTagWidth + 10 <= width) {
      const colorTag = this.modeColorFn(bottomTag);
      const fillWidth = width - bottomTagWidth;
      const fill = this.modeColorFn("\u2500".repeat(fillWidth));
      const newBottom = `${colorTag}${fill}`;
      if (visibleWidth(newBottom) <= width) {
        lines[lastIdx] = newBottom;
      }
    }

    return lines;
  }
}
