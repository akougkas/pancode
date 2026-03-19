/**
 * Structured audit trail for safety, dispatch, and session events.
 *
 * In-memory ring buffer, session-scoped. No file persistence.
 * Capped at maxEntries (default 1000) with oldest-first eviction.
 */

const DEFAULT_MAX_ENTRIES = 1000;

export interface AuditEntry {
  timestamp: string;
  domain: string;
  event: string;
  agent?: string;
  detail: string;
  severity: "info" | "warn" | "error";
}

export interface AuditTrail {
  record(entry: Omit<AuditEntry, "timestamp">): void;
  getRecent(count?: number): AuditEntry[];
  getByDomain(domain: string): AuditEntry[];
  getBySeverity(severity: AuditEntry["severity"]): AuditEntry[];
  size(): number;
  clear(): void;
}

export function createAuditTrail(maxEntries: number = DEFAULT_MAX_ENTRIES): AuditTrail {
  const entries: AuditEntry[] = [];

  return {
    record(entry: Omit<AuditEntry, "timestamp">): void {
      const full: AuditEntry = { ...entry, timestamp: new Date().toISOString() };
      entries.push(full);
      if (entries.length > maxEntries) {
        entries.shift();
      }
    },

    getRecent(count = 20): AuditEntry[] {
      return entries.slice(-count);
    },

    getByDomain(domain: string): AuditEntry[] {
      return entries.filter((e) => e.domain === domain);
    },

    getBySeverity(severity: AuditEntry["severity"]): AuditEntry[] {
      return entries.filter((e) => e.severity === severity);
    },

    size(): number {
      return entries.length;
    },

    clear(): void {
      entries.length = 0;
    },
  };
}
