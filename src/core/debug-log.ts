import { appendFileSync } from "node:fs";
import { join } from "node:path";
import { getDataDir } from "./xdg";

let initialized = false;

/** Returns the path to the debug log file. */
export function getDebugLogPath(): string {
  return join(getDataDir(), "debug.log");
}

function formatLine(level: string, args: unknown[]): string {
  const ts = new Date().toISOString();
  const pad = level.length < 5 ? " " : "";
  const message = args.map((a) => (typeof a === "string" ? a : String(a))).join(" ");
  return `[${level}]${pad} ${ts} ${message}\n`;
}

/**
 * Initialize debug logging by redirecting console.error and console.warn
 * to a persistent log file. Original stderr/stdout behavior is preserved.
 *
 * Skipped when running inside a worker subprocess (PANCODE_WORKER=1).
 * Safe to call multiple times; only the first call takes effect.
 */
export function initDebugLog(): void {
  if (initialized) return;
  if (process.env.PANCODE_WORKER === "1") return;

  const logPath = getDebugLogPath();

  // Capture original methods before patching.
  const originalError = console.error;
  const originalWarn = console.warn;

  console.error = (...args: unknown[]) => {
    try {
      appendFileSync(logPath, formatLine("ERROR", args));
    } catch {
      // Silently ignore write failures to avoid recursive error loops.
    }
    originalError.apply(console, args);
  };

  console.warn = (...args: unknown[]) => {
    try {
      appendFileSync(logPath, formatLine("WARN", args));
    } catch {
      // Silently ignore write failures to avoid recursive error loops.
    }
    originalWarn.apply(console, args);
  };

  // Write startup marker.
  try {
    appendFileSync(logPath, formatLine("INFO", ["PanCode debug log initialized"]));
  } catch {
    // If the initial write fails, still mark as initialized to prevent retry loops.
  }

  initialized = true;
}
