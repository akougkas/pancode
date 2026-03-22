import { execSync } from "node:child_process";

export const EXIT_SUCCESS = 0;
export const EXIT_FAILURE = 1;

/** Base name for all PanCode tmux sessions. */
export const PANCODE_SESSION_PREFIX = "pancode";

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
 * Find the next available session name. First session is "pancode",
 * subsequent sessions are "pancode-2", "pancode-3", etc.
 */
export function nextSessionName(): string {
  const existing = listPancodeSessions();
  if (existing.length === 0) return PANCODE_SESSION_PREFIX;

  const usedNumbers = new Set<number>();
  usedNumbers.add(1); // "pancode" (no suffix) is implicitly slot 1
  for (const s of existing) {
    if (s.name === PANCODE_SESSION_PREFIX) {
      usedNumbers.add(1);
    } else {
      const suffix = s.name.slice(PANCODE_SESSION_PREFIX.length + 1);
      const num = Number.parseInt(suffix, 10);
      if (Number.isFinite(num)) usedNumbers.add(num);
    }
  }

  let next = 2;
  while (usedNumbers.has(next)) next++;
  return `${PANCODE_SESSION_PREFIX}-${next}`;
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
