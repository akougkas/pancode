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

import type { LogEntry, LogSeverity } from "./dashboard-theme";

// ---------------------------------------------------------------------------
// Module-level state
// ---------------------------------------------------------------------------

const logBuffer: LogEntry[] = [];
const MAX_LOGS = 100;

// ---------------------------------------------------------------------------
// Throttle state for high-frequency channels
// ---------------------------------------------------------------------------

/** Per-worker event counters for WORKER_PROGRESS throttling. */
const progressCounters = new Map<string, number>();

// ---------------------------------------------------------------------------
// State management
// ---------------------------------------------------------------------------

/**
 * Push a log entry into the buffer.
 * Oldest entries are evicted when the buffer exceeds MAX_LOGS.
 */
export function pushLog(time: string, message: string, severity: LogSeverity = "info", highlight?: boolean): void {
  logBuffer.push({ time, message, severity, highlight });
  if (logBuffer.length > MAX_LOGS) logBuffer.shift();
}

/**
 * Convenience: push a log entry timestamped to now.
 */
export function logNow(message: string, severity: LogSeverity = "info", highlight?: boolean): void {
  const now = new Date();
  const time = now.toLocaleTimeString("en-US", { hour12: false });
  pushLog(time, message, severity, highlight);
}

/**
 * Check whether a WORKER_PROGRESS event should be logged.
 * Returns true for every 10th event per worker to avoid log spam.
 */
export function shouldLogProgress(runId: string): boolean {
  const count = (progressCounters.get(runId) ?? 0) + 1;
  progressCounters.set(runId, count);
  return count % 10 === 1;
}

/**
 * Clear progress counters for a finished worker.
 */
export function clearProgressCounter(runId: string): void {
  progressCounters.delete(runId);
}

/**
 * Get the most recent log entries for display.
 */
export function getRecentLogs(count = 8): LogEntry[] {
  return logBuffer.slice(-count);
}

/**
 * Clear all log entries. Called on widget dispose or session reset.
 */
export function resetLogs(): void {
  logBuffer.length = 0;
  progressCounters.clear();
}
