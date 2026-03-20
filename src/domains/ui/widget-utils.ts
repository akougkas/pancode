/**
 * Widget utility functions for TUI rendering.
 */

export function padRight(text: string, width: number): string {
  return text.length >= width ? text.slice(0, width) : text + " ".repeat(width - text.length);
}

export function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength - 3)}...`;
}

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  const minutes = Math.floor(ms / 60000);
  const seconds = Math.round((ms % 60000) / 1000);
  return `${minutes}m${seconds}s`;
}

export function formatCost(cost: number): string {
  if (cost === 0) return "$0.00";
  if (cost < 0.001) return `$${cost.toFixed(6)}`;
  if (cost < 1) return `$${cost.toFixed(4)}`;
  return `$${cost.toFixed(2)}`;
}

export function formatTokenCount(count: number): string {
  if (count < 1000) return String(count);
  if (count < 10000) return `${(count / 1000).toFixed(1)}k`;
  if (count < 1000000) return `${Math.round(count / 1000)}k`;
  return `${(count / 1000000).toFixed(1)}M`;
}

/**
 * Extract a compact one-line summary from a worker result string.
 *
 * Workers return multi-line text. This extracts the first non-empty line,
 * strips common boilerplate prefixes, and returns a clean summary suitable
 * for display in the RECENT section of the dispatch board.
 *
 * Returns empty string if the input is empty or only whitespace.
 */
export function extractResultSummary(result: string): string {
  if (!result) return "";

  const lines = result.split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    // Strip common boilerplate prefixes from worker output.
    let cleaned = trimmed;
    for (const prefix of ["Worker completed:", "Result:", "Done.", "Done:"]) {
      if (cleaned.startsWith(prefix)) {
        cleaned = cleaned.slice(prefix.length).trim();
        break;
      }
    }

    if (cleaned) return cleaned;
  }

  return "";
}
