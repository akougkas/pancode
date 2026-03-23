/**
 * Orchestration log collector for the dashboard.
 *
 * Module-level ring buffer that stores recent orchestration events.
 * Extension.ts subscribes to sharedBus channels and Pi events,
 * calling pushLog() for each. The dashboard widget reads via
 * getRecentLogs() on each render.
 *
 * Same pattern as worker-widgets.ts: no timers, no subscriptions here,
 * just state management. The extension owns the event wiring.
 */

import type { LogEntry } from "./dashboard-theme";

// ---------------------------------------------------------------------------
// Module-level state
// ---------------------------------------------------------------------------

const logBuffer: LogEntry[] = [];
const MAX_LOGS = 50;

// ---------------------------------------------------------------------------
// State management
// ---------------------------------------------------------------------------

/**
 * Push a log entry into the buffer.
 * Oldest entries are evicted when the buffer exceeds MAX_LOGS.
 */
export function pushLog(time: string, message: string, highlight?: boolean): void {
  logBuffer.push({ time, message, highlight });
  if (logBuffer.length > MAX_LOGS) logBuffer.shift();
}

/**
 * Convenience: push a log entry timestamped to now.
 */
export function logNow(message: string, highlight?: boolean): void {
  const now = new Date();
  const time = now.toLocaleTimeString("en-US", { hour12: false });
  pushLog(time, message, highlight);
}

/**
 * Get the most recent log entries for display.
 */
export function getRecentLogs(count: number = 8): LogEntry[] {
  return logBuffer.slice(-count);
}

/**
 * Clear all log entries. Called on widget dispose or session reset.
 */
export function resetLogs(): void {
  logBuffer.length = 0;
}
