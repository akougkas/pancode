import { execSync } from "node:child_process";
import { createHash } from "node:crypto";

export const EXIT_SUCCESS = 0;
export const EXIT_FAILURE = 1;

/** Base name for all PanCode tmux sessions. */
export const PANCODE_SESSION_PREFIX = "pancode";

/**
 * Generate a short hash suffix from a directory path.
 * Returns the first 6 hex characters of the SHA-256 digest.
 */
export function projectHash(cwd: string): string {
  return createHash("sha256").update(cwd).digest("hex").slice(0, 6);
}

export function isTmuxAvailable(): boolean {
  try {
    execSync("tmux -V", { stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}

export interface PancodeSession {
  name: string;
  attached: boolean;
  created: string;
}

/**
 * List all PanCode tmux sessions (names starting with "pancode").
 * Returns them sorted newest-first.
 */
export function listPancodeSessions(): PancodeSession[] {
  try {
    const raw = execSync("tmux list-sessions -F '#{session_name}|#{session_attached}|#{session_created}'", {
      stdio: "pipe",
      encoding: "utf8",
    });
    return raw
      .trim()
      .split("\n")
      .filter((line) => line.length > 0)
      .map((line) => {
        const [name, attached, created] = line.split("|");
        return { name, attached: attached === "1", created };
      })
      .filter((s) => s.name === PANCODE_SESSION_PREFIX || s.name.startsWith(`${PANCODE_SESSION_PREFIX}-`))
      .sort((a, b) => Number(b.created) - Number(a.created));
  } catch {
    return [];
  }
}

/**
 * Find the next available session name. Uses a per-project hash derived from
 * the working directory so each project gets its own tmux session namespace.
 *
 * First session for a project: `pancode-<hash>`.
 * Subsequent sessions: `pancode-<hash>-2`, `pancode-<hash>-3`, etc.
 *
 * When `cwd` is omitted, falls back to the legacy `pancode` / `pancode-N` scheme.
 */
export function nextSessionName(cwd?: string): string {
  const base = cwd ? `${PANCODE_SESSION_PREFIX}-${projectHash(cwd)}` : PANCODE_SESSION_PREFIX;
  const existing = listPancodeSessions();
  const matching = existing.filter((s) => s.name === base || s.name.startsWith(`${base}-`));

  if (matching.length === 0) return base;

  const usedNumbers = new Set<number>();
  usedNumbers.add(1); // The base name (no numeric suffix) is implicitly slot 1.
  for (const s of matching) {
    if (s.name === base) {
      usedNumbers.add(1);
    } else {
      const suffix = s.name.slice(base.length + 1);
      const num = Number.parseInt(suffix, 10);
      if (Number.isFinite(num)) usedNumbers.add(num);
    }
  }

  let next = 2;
  while (usedNumbers.has(next)) next++;
  return `${base}-${next}`;
}

/**
 * Returns true when the current process was launched inside a PanCode
 * tmux session by the loader's tmux-wrap logic. The loader sets this env
 * var before spawning the inner process so the inner invocation knows to
 * boot the orchestrator directly instead of wrapping again.
 */
export function isInsidePancodeTmux(): boolean {
  return process.env.PANCODE_INSIDE_TMUX === "1";
}
