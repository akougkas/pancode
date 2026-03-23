/**
 * Structured panel renderer for consistent slash command output.
 *
 * PanelSpec provides a declarative interface for building panel content
 * with key-value rows, raw text lines, and section headings. The renderer
 * handles column alignment, borders, and theme-aware coloring.
 */

import { truncateToWidth } from "../../engine/tui";
import type { TuiColorizer } from "./dashboard-theme";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ColumnAlign = "left" | "right";

/** Key-value row with aligned columns. */
export interface KvRow {
  kind: "kv";
  key: string;
  value: string;
}

/** Raw text line. */
export interface TextRow {
  kind: "text";
  text: string;
}

/** Blank separator line. */
export interface BlankRow {
  kind: "blank";
}

/** A single row in a panel section. */
export type PanelRow = KvRow | TextRow | BlankRow;

/** A group of related rows with an optional heading. */
export interface PanelSection {
  /** Optional section heading (rendered with bold in renderPanel). */
  heading?: string;
  /** Content rows. */
  rows: PanelRow[];
  /** Key column alignment for KV rows. Defaults to "left". */
  keyAlign?: ColumnAlign;
  /** Value column alignment for KV rows. Defaults to "left". */
  valueAlign?: ColumnAlign;
  /** Extra indent (in spaces) applied to content rows. Defaults to 0. */
  indent?: number;
}

/**
 * Declarative specification for a bordered panel.
 * Used by slash commands to produce consistent, structured output.
 */
export interface PanelSpec {
  /** Panel title (rendered with accent color). */
  title: string;
  /** Ordered sections. */
  sections: PanelSection[];
}

// ---------------------------------------------------------------------------
// Convenience constructors
// ---------------------------------------------------------------------------

/** Create a key-value row. */
export function kv(key: string, value: string): KvRow {
  return { kind: "kv", key, value };
}

/** Create a raw text row. */
export function text(line: string): TextRow {
  return { kind: "text", text: line };
}

/** Create a blank separator row. */
export function blank(): BlankRow {
  return { kind: "blank" };
}

// ---------------------------------------------------------------------------
// Body formatting (no borders)
// ---------------------------------------------------------------------------

/**
 * Format the body of a PanelSpec into plain text lines without borders.
 *
 * Handles KV column alignment, section headings, and row indentation.
 * The output is suitable for sending through the PANEL message renderer,
 * which adds its own border and 2-space line indent.
 */
export function formatPanelBody(spec: PanelSpec): string[] {
  const lines: string[] = [];

  for (let si = 0; si < spec.sections.length; si++) {
    const sect = spec.sections[si];

    // Blank line between sections (not before the first)
    if (si > 0) lines.push("");

    // Section heading at body level (no section indent applied)
    if (sect.heading) {
      lines.push(sect.heading);
    }

    // Compute max key width for KV alignment within this section
    const kvRows = sect.rows.filter((r): r is KvRow => r.kind === "kv");
    const maxKeyLen = kvRows.reduce((max, r) => Math.max(max, r.key.length), 0);
    const pad = " ".repeat(sect.indent ?? 0);

    for (const row of sect.rows) {
      switch (row.kind) {
        case "kv": {
          const paddedKey = sect.keyAlign === "right" ? row.key.padStart(maxKeyLen) : row.key.padEnd(maxKeyLen);
          lines.push(`${pad}${paddedKey}  ${row.value}`);
          break;
        }
        case "text":
          lines.push(`${pad}${row.text}`);
          break;
        case "blank":
          lines.push("");
          break;
      }
    }
  }

  return lines;
}

// ---------------------------------------------------------------------------
// Full bordered rendering
// ---------------------------------------------------------------------------

/**
 * Render a complete bordered panel with title and theme coloring.
 *
 * Uses rounded corners consistent with the PanCode TUI style.
 * Title is rendered with accent color and bold in the top border.
 * Body lines receive a 2-space indent inside the border.
 */
export function renderPanel(spec: PanelSpec, width: number, colorizer: TuiColorizer): string[] {
  const body = formatPanelBody(spec);
  const result: string[] = [];
  const innerWidth = Math.max(1, width - 2);

  // Top border: ╭─ Title ──────────╮ (truncates long titles at narrow widths)
  const maxTitleWidth = Math.max(0, width - 6);
  const displayTitle = spec.title.length > maxTitleWidth ? spec.title.slice(0, maxTitleWidth) : spec.title;
  const titleLen = displayTitle.length;
  const topFillLen = Math.max(0, width - 5 - titleLen);
  result.push(
    `${colorizer.dim("\u256D\u2500")} ${colorizer.bold(colorizer.accent(displayTitle))} ${colorizer.dim(`${"\u2500".repeat(topFillLen)}\u256E`)}`,
  );

  // Body lines with 2-space indent, truncated to fit border
  for (const line of body) {
    result.push(`  ${truncateToWidth(line, innerWidth)}`);
  }

  // Bottom border: ╰──────────────╯
  result.push(colorizer.dim(`\u2570${"\u2500".repeat(Math.max(0, width - 2))}\u256F`));

  return result;
}

// ---------------------------------------------------------------------------
// Message integration
// ---------------------------------------------------------------------------

/**
 * Send a PanelSpec through a PANEL message emitter.
 *
 * Formats the body using formatPanelBody and delegates border rendering
 * to the registered PANEL message renderer.
 */
export function sendPanelSpec(emitFn: (title: string, body: string) => void, spec: PanelSpec): void {
  const body = formatPanelBody(spec);
  emitFn(spec.title, body.join("\n"));
}
