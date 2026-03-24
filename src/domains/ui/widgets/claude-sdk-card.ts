/**
 * Claude SDK card widget for sdk:claude-code workers.
 *
 * Renders an extended dispatch card with Anthropic orange accent,
 * progress tracking, token breakdown, and session status sections.
 * Uses rounded borders matching the bento-box aesthetic.
 *
 * Pure function: no Pi SDK imports, no side effects, no event subscriptions.
 * All widths derived from the passed width parameter.
 */

import { visibleWidth } from "../../../engine/tui";
import type { TuiColorizer } from "../dashboard-theme";
import { BLOCK, BOX } from "../dashboard-theme";
import type { DispatchCardData } from "../dispatch-board";
import { renderDispatchCard } from "../dispatch-board";
import { formatCost, formatDuration, formatTokenCount, padRight, truncate } from "../widget-utils";
import type { CardWidget } from "./agent-card";

// ---------------------------------------------------------------------------
// Extended card data for SDK-specific fields
// ---------------------------------------------------------------------------

export interface ClaudeSdkCardData extends DispatchCardData {
  maxTurns?: number;
  sessionId?: string | null;
  sessionResumeAvailable?: boolean;
  streamActive?: boolean;
  thinkingActive?: boolean;
  cacheReadTokens?: number | null;
  cacheWriteTokens?: number | null;
  currentTool?: string | null;
  currentToolArgs?: string | null;
  recentTools?: string[];
  toolCount?: number;
}

// ---------------------------------------------------------------------------
// Status icons (match dispatch-board.ts)
// ---------------------------------------------------------------------------

const STATUS_ICONS: Record<string, string> = {
  pending: "\u25CB",
  running: "\u25CF",
  done: "\u2713",
  error: "\u2717",
  cancelled: "\u2298",
  interrupted: "\u2298",
  timeout: "\u2298",
  budget_exceeded: "\u2298",
};

// ---------------------------------------------------------------------------
// Anthropic orange local colorizer
// ---------------------------------------------------------------------------

function claudeAccent(text: string): string {
  return `\x1b[38;2;217;119;6m${text}\x1b[39m`;
}

/** Create a card-local colorizer that overrides accent and barFill with Anthropic orange. */
function makeClaudeColorizer(base: TuiColorizer): TuiColorizer {
  return {
    ...base,
    accent: claudeAccent,
    barFill: claudeAccent,
  };
}

// ---------------------------------------------------------------------------
// Rounded border helpers
// ---------------------------------------------------------------------------

const ROUNDED = { tl: "\u256D", tr: "\u256E", bl: "\u2570", br: "\u256F", h: "\u2500", v: "\u2502" };

/** Pad a string to exactly `targetWidth` visible columns. ANSI-aware. */
function padVisible(text: string, targetWidth: number): string {
  const w = visibleWidth(text);
  if (w >= targetWidth) return text;
  return text + " ".repeat(targetWidth - w);
}

function renderTopBorder(title: string, width: number, cc: TuiColorizer): string {
  // Layout: ╭─── Title ────...────╮
  // chars:  1 + 4(prefix) + titleLen + 1(space) + fillLen + 1(tr) = width
  const prefix = `${ROUNDED.h}${ROUNDED.h}${ROUNDED.h} `;
  const titleLen = visibleWidth(title);
  const fillLen = Math.max(0, width - 1 - prefix.length - titleLen - 1 - 1);
  return (
    cc.dim(ROUNDED.tl) +
    cc.dim(prefix) +
    cc.accent(title) +
    cc.dim(` ${ROUNDED.h.repeat(fillLen)}`) +
    cc.dim(ROUNDED.tr)
  );
}

function renderBottomBorder(width: number, cc: TuiColorizer): string {
  return cc.dim(ROUNDED.bl + ROUNDED.h.repeat(Math.max(0, width - 2)) + ROUNDED.br);
}

function sectionDivider(title: string, width: number, cc: TuiColorizer): string {
  const prefix = `${ROUNDED.h}${ROUNDED.h}${ROUNDED.h} `;
  const titleLen = visibleWidth(title);
  const fillLen = Math.max(0, width - 3 - prefix.length - titleLen);
  return `${cc.dim("\u251C")}${cc.dim(prefix)}${cc.accent(title)} ${cc.dim(ROUNDED.h.repeat(fillLen))}${cc.dim(ROUNDED.v)}`;
}

function cardLine(content: string, width: number, cc: TuiColorizer): string {
  const inner = Math.max(0, width - 4);
  const fitted = padVisible(content, inner);
  return `${cc.dim(ROUNDED.v)} ${fitted} ${cc.dim(ROUNDED.v)}`;
}

// ---------------------------------------------------------------------------
// Progress bar (orange fill via card-local colorizer)
// ---------------------------------------------------------------------------

function renderProgressBar(value: number, max: number, barWidth: number, cc: TuiColorizer): string {
  const pct = max > 0 ? Math.min(1, value / max) : 0;
  const filled = Math.round(pct * barWidth);
  const empty = barWidth - filled;
  return cc.barFill(BLOCK.full.repeat(filled)) + cc.barEmpty(BLOCK.light.repeat(empty));
}

// ---------------------------------------------------------------------------
// Status icon colorization
// ---------------------------------------------------------------------------

function colorizeStatusIcon(icon: string, status: string, c: TuiColorizer): string {
  switch (status) {
    case "running":
      return c.accent(icon);
    case "done":
      return c.success(icon);
    case "error":
      return c.error(icon);
    default:
      return c.dim(icon);
  }
}

// ---------------------------------------------------------------------------
// Error state rendering
// ---------------------------------------------------------------------------

const ERROR_MESSAGES: Record<string, string> = {
  auth_failure: "Run: claude login",
  rate_limit: "Retry in a moment",
  budget_exceeded: "Budget limit reached",
  timeout: "Timeout exceeded",
};

function isErrorState(card: DispatchCardData): boolean {
  return card.status === "error" || card.status === "timeout" || card.status === "budget_exceeded";
}

function renderErrorCard(card: DispatchCardData, width: number, cc: TuiColorizer): string[] {
  const inner = Math.max(1, width - 4);
  const lines: string[] = [];

  lines.push(renderTopBorder("Claude SDK Worker", width, cc));

  // Header: error icon + agent name + status + elapsed
  const icon = STATUS_ICONS[card.status] ?? "\u2717";
  const elapsed = formatDuration(card.elapsedMs);
  const statusText = card.status;
  const headerPlain = `${icon} ${card.agent}`;
  const rightPart = `${statusText}  ${elapsed}`;
  const headerGap = Math.max(1, inner - headerPlain.length - rightPart.length);
  lines.push(
    cardLine(
      `${cc.error(icon)} ${cc.bold(cc.accent(card.agent))}${" ".repeat(headerGap)}${cc.error(statusText)}  ${cc.dim(elapsed)}`,
      width,
      cc,
    ),
  );

  // Error message
  let errorMsg = "";
  if (card.status === "budget_exceeded") {
    const sdkCard = card as ClaudeSdkCardData;
    const costStr = sdkCard.cost != null ? formatCost(sdkCard.cost) : "---";
    errorMsg = `Final cost: ${costStr}`;
  } else if (card.status === "timeout") {
    errorMsg = `Elapsed: ${formatDuration(card.elapsedMs)}`;
  } else {
    // Generic error or auth_failure
    errorMsg = card.taskPreview || "Authentication required";
  }
  lines.push(cardLine(`  ${cc.error(truncate(errorMsg, inner - 2))}`, width, cc));

  // Action hint
  const hint = ERROR_MESSAGES[card.status] ?? "";
  if (hint) {
    lines.push(cardLine("", width, cc));
    lines.push(cardLine(`  ${cc.muted(hint)}`, width, cc));
  }

  lines.push(renderBottomBorder(width, cc));
  return lines;
}

// ---------------------------------------------------------------------------
// Claude SDK Card Widget
// ---------------------------------------------------------------------------

/** Narrow terminal threshold below which the card collapses to the default 6-line layout. */
const NARROW_THRESHOLD = 50;

/** Default max turns when the SDK card data does not specify. */
const DEFAULT_MAX_TURNS = 30;

export class ClaudeSdkCardWidget implements CardWidget {
  readonly runtimeId = "sdk:claude-code";

  render(card: DispatchCardData, width: number, c: TuiColorizer): string[] {
    // Narrow terminal: collapse to default 6-line card
    if (width < NARROW_THRESHOLD) {
      return renderDispatchCard(card, width, c);
    }

    const cc = makeClaudeColorizer(c);

    // Error states: render compact error card
    if (isErrorState(card)) {
      return renderErrorCard(card, width, cc);
    }

    const inner = Math.max(1, width - 4);
    const lines: string[] = [];

    lines.push(renderTopBorder("Claude SDK Worker", width, cc));
    lines.push(...this.renderHeader(card, width, inner, cc));
    lines.push(...this.renderProgress(card as ClaudeSdkCardData, width, inner, cc));
    lines.push(...this.renderTokens(card as ClaudeSdkCardData, width, inner, cc));
    lines.push(...this.renderSession(card as ClaudeSdkCardData, width, inner, cc));
    lines.push(renderBottomBorder(width, cc));

    return lines;
  }

  private renderHeader(card: DispatchCardData, width: number, inner: number, cc: TuiColorizer): string[] {
    const lines: string[] = [];
    const icon = STATUS_ICONS[card.status] ?? "\u25CB";
    const coloredIcon = colorizeStatusIcon(icon, card.status, cc);
    const elapsed = formatDuration(card.elapsedMs);
    const statusText = card.status;

    // Line 1: status icon + agent name (bold accent) + status + elapsed
    const agentName = cc.bold(cc.accent(card.agent));
    const agentNameLen = visibleWidth(card.agent);
    const rightSide = `${statusText}${" ".repeat(Math.max(1, 6 - statusText.length))}${elapsed}`;
    const rightLen = rightSide.length;
    const gap = Math.max(1, inner - 2 - agentNameLen - rightLen);
    lines.push(
      cardLine(
        `${coloredIcon} ${agentName}${" ".repeat(gap)}${cc.muted(statusText)}${" ".repeat(Math.max(1, 6 - statusText.length))}${cc.dim(elapsed)}`,
        width,
        cc,
      ),
    );

    // Line 2: model name (muted) + runtime badge "sdk:claude-code" (muted)
    const model = card.model ? truncate(card.model, Math.max(1, inner - 20)) : "---";
    const badge = "sdk:claude-code";
    const modelLen = model.length;
    const modelGap = Math.max(1, inner - 2 - modelLen - badge.length);
    lines.push(cardLine(`  ${cc.muted(model)}${" ".repeat(modelGap)}${cc.muted(badge)}`, width, cc));

    return lines;
  }

  private renderProgress(card: ClaudeSdkCardData, width: number, inner: number, cc: TuiColorizer): string[] {
    const lines: string[] = [];
    lines.push(sectionDivider("Progress", width, cc));

    // Line 1: progress bar (turn/maxTurns) + cost ticker
    const turns = card.turns ?? 0;
    const maxTurns = card.maxTurns ?? DEFAULT_MAX_TURNS;
    const turnLabel = `Turn ${turns}/${maxTurns}`;
    const costLabel = card.cost != null ? formatCost(card.cost) : "---";
    const fixedParts = turnLabel.length + costLabel.length + 6; // spaces + padding
    const barWidth = Math.max(8, inner - fixedParts - 2);
    const bar = renderProgressBar(turns, maxTurns, barWidth, cc);
    const barVisLen = visibleWidth(bar);
    const progressGap = Math.max(1, inner - 2 - barVisLen - turnLabel.length - costLabel.length - 2);

    lines.push(
      cardLine(`  ${bar}  ${cc.muted(turnLabel)}${" ".repeat(progressGap)}${cc.bright(costLabel)}`, width, cc),
    );

    // Line 2: current tool + truncated args (or "idle")
    const currentTool = card.currentTool;
    if (currentTool) {
      const argsPreview = card.currentToolArgs
        ? ` ${truncate(card.currentToolArgs, Math.max(1, inner - currentTool.length - 8))}`
        : "";
      lines.push(cardLine(`  \u25B8 ${cc.bright(currentTool)}${cc.dim(argsPreview)}`, width, cc));
    } else {
      lines.push(cardLine(`  ${cc.dim("\u25B8 idle")}`, width, cc));
    }

    // Line 3: Recent tools ring buffer
    const recentTools = card.recentTools ?? [];
    if (recentTools.length > 0) {
      const toolChain = recentTools.join(" \u2192 ");
      const prefix = "Recent: ";
      lines.push(
        cardLine(`  ${cc.dim(prefix + truncate(toolChain, Math.max(1, inner - prefix.length - 2)))}`, width, cc),
      );
    } else {
      lines.push(cardLine(`  ${cc.dim("Recent: ---")}`, width, cc));
    }

    return lines;
  }

  private renderTokens(card: ClaudeSdkCardData, width: number, inner: number, cc: TuiColorizer): string[] {
    const lines: string[] = [];
    lines.push(sectionDivider("Tokens", width, cc));

    // Line 1: In: N   Out: N   Cache: N read
    const inTok = card.inputTokens != null ? formatTokenCount(card.inputTokens) : "---";
    const outTok = card.outputTokens != null ? formatTokenCount(card.outputTokens) : "---";
    const cacheRead = card.cacheReadTokens != null ? `${formatTokenCount(card.cacheReadTokens)} read` : "---";
    const tokenLine = `In: ${inTok}   Out: ${outTok}   Cache: ${cacheRead}`;
    lines.push(cardLine(`  ${cc.muted(truncate(tokenLine, inner - 2))}`, width, cc));

    // Line 2: Thinking: active/idle + right-aligned Cost: $N.NNN
    const thinkingState = card.thinkingActive ? "active" : "idle";
    const thinkingLabel = `Thinking: ${thinkingState}`;
    const costLabel = card.cost != null ? `Cost: ${formatCost(card.cost)}` : "Cost: ---";
    const tokenGap = Math.max(1, inner - 2 - thinkingLabel.length - costLabel.length);
    lines.push(cardLine(`  ${cc.muted(thinkingLabel)}${" ".repeat(tokenGap)}${cc.bright(costLabel)}`, width, cc));

    return lines;
  }

  private renderSession(card: ClaudeSdkCardData, width: number, inner: number, cc: TuiColorizer): string[] {
    const lines: string[] = [];
    lines.push(sectionDivider("Session", width, cc));

    // Line 1: Truncated session ID + resume availability
    const sessionId = card.sessionId ? truncate(card.sessionId, 12) : "---";
    const resumeLabel = card.sessionResumeAvailable ? "Resume: available" : "Resume: unavailable";
    const sessionGap = Math.max(1, inner - 2 - `ID: ${sessionId}`.length - resumeLabel.length - 3);
    lines.push(
      cardLine(`  ${cc.muted(`ID: ${sessionId}`)}${" ".repeat(sessionGap)}${cc.muted(resumeLabel)}`, width, cc),
    );

    // Line 2: Stream status + tool call count
    const streamLabel = card.streamActive ? "\u25B8\u25B8\u25B8 live" : "\u25A0 ended";
    const streamColored = card.streamActive ? cc.accent(`Stream: ${streamLabel}`) : cc.dim(`Stream: ${streamLabel}`);
    const toolCountLabel = `Tools: ${card.toolCount ?? 0} calls`;
    const streamGap = Math.max(1, inner - 2 - visibleWidth(`Stream: ${streamLabel}`) - toolCountLabel.length);
    lines.push(cardLine(`  ${streamColored}${" ".repeat(streamGap)}${cc.muted(toolCountLabel)}`, width, cc));

    return lines;
  }
}
