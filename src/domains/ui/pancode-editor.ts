import { CustomEditor, visibleWidth } from "../../engine/tui";

// Rounded box-drawing characters
const TL = "\u256D"; // ╭
const TR = "\u256E"; // ╮
const BL = "\u2570"; // ╰
const BR = "\u256F"; // ╯
const H = "\u2500"; // ─

// ANSI inverse mode for badge background effect
const INVERSE_ON = "\x1b[7m";
const ANSI_RESET = "\x1b[0m";

// Prompt symbol (heavy right-pointing angle quotation mark)
const PROMPT = "\u276F"; // ❯

/** Narrow terminal threshold below which badges and info are suppressed. */
const NARROW_THRESHOLD = 40;

/**
 * PanCode editor with premium mode-colored borders and informational labels.
 *
 * Top border:    ╭──────────────────────────── Build ──╮
 * Input area:    ❯ _
 * Bottom border: ╰── auto-edit · reasoning:medium · model (provider) ──╯
 *
 * Mode badge is right-aligned with filled background color using ANSI
 * inverse to turn the mode's foreground color into a background. Bottom
 * border shows exactly three elements: safety level, reasoning state,
 * and model with provider. Rounded Unicode corners soften the visual
 * frame across all terminal emulators.
 *
 * Follows the Pi SDK modal-editor pattern: call super.render(), then
 * replace border lines and inject prompt symbol. Never modifies cursor
 * markers, input handling, or keybindings.
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

  /**
   * Build the top border with a right-aligned filled mode badge.
   *
   *   ╭──────────────────────────────── Build ──╮
   *
   * The badge uses ANSI inverse to turn the mode foreground color into
   * a filled background, creating a visual pill that pops against the border.
   */
  private buildTopBorder(width: number): string | null {
    const badgeText = ` ${this.modeLabel} `;
    const badgeVW = visibleWidth(badgeText);

    // Need: ╭ (1) + leftFill (min 3) + badge + rightFill (2) + ╮ (1)
    const minWidth = 1 + 3 + badgeVW + 2 + 1;
    if (width < minWidth) return null;

    const rightFillLen = 2;
    const leftFillLen = width - 2 - badgeVW - rightFillLen;

    // Badge: inverse mode turns the foreground color into background
    const badge = `${INVERSE_ON}${this.modeColorFn(badgeText)}${ANSI_RESET}`;

    const left = this.modeColorFn(TL + H.repeat(leftFillLen));
    const right = this.modeColorFn(H.repeat(rightFillLen) + TR);

    return `${left}${badge}${right}`;
  }

  /**
   * Build the bottom border with three status elements.
   *
   *   ╰── auto-edit · reasoning:medium · model-id (provider) ──╯
   *
   * Model label is reformatted from "provider/model-id" to "model-id (provider)"
   * so the model name leads and the provider reads as context.
   */
  private buildBottomBorder(width: number): string | null {
    // Reformat "provider/model-id" to "model-id (provider)"
    const slashIdx = this.modelLabel.indexOf("/");
    let modelDisplay: string;
    if (slashIdx > 0) {
      const provider = this.modelLabel.slice(0, slashIdx);
      const modelId = this.modelLabel.slice(slashIdx + 1);
      modelDisplay = `${modelId} (${provider})`;
    } else {
      modelDisplay = this.modelLabel;
    }

    const infoParts = [this.safetyLabel, `reasoning:${this.reasoningLabel}`, modelDisplay].filter(Boolean);
    const infoText = ` ${infoParts.join(" \u00B7 ")} `;
    const infoVW = visibleWidth(infoText);

    // Need: ╰ (1) + leftFill (2) + info + rightFill (2) + ╯ (1)
    const minWidth = 1 + 2 + infoVW + 2 + 1;
    if (width < minWidth) return null;

    const leftFillLen = 2;
    const rightFillLen = width - 2 - infoVW - leftFillLen;

    const left = this.modeColorFn(BL + H.repeat(leftFillLen));
    const coloredInfo = this.modeColorFn(infoText);
    const right = this.modeColorFn(H.repeat(rightFillLen) + BR);

    return `${left}${coloredInfo}${right}`;
  }

  render(width: number): string[] {
    const lines = super.render(width);
    if (lines.length < 2) return lines;

    const lastIdx = lines.length - 1;

    // Narrow terminals: rounded corners only, no badges or info
    if (width < NARROW_THRESHOLD) {
      const fillLen = Math.max(0, width - 2);
      lines[0] = this.modeColorFn(TL + H.repeat(fillLen) + TR);
      lines[lastIdx] = this.modeColorFn(BL + H.repeat(fillLen) + BR);
      return lines;
    }

    // Top border: right-aligned mode badge with inverse background
    const topBorder = this.buildTopBorder(width);
    if (topBorder) {
      lines[0] = topBorder;
    }

    // Bottom border: safety · reasoning · model (provider)
    const bottomBorder = this.buildBottomBorder(width);
    if (bottomBorder) {
      lines[lastIdx] = bottomBorder;
    }

    // Inject prompt symbol into the first content line.
    // Content lines start at index 1 (after the top border).
    // With paddingX >= 2, the line starts with at least 2 spaces.
    // Replace the first space with the colored prompt symbol.
    if (lines.length > 2 && this.getPaddingX() >= 2) {
      const contentLine = lines[1];
      if (contentLine.length >= 2 && contentLine[0] === " " && contentLine[1] === " ") {
        const prompt = this.modeColorFn(PROMPT);
        lines[1] = `${prompt} ${contentLine.slice(2)}`;
      }
    }

    return lines;
  }
}
