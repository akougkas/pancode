import type { ActionClass, AutonomyMode } from "./scope";

export interface AuditEntry {
  timestamp: string;
  toolName: string;
  actionClass: ActionClass;
  autonomyMode: AutonomyMode;
  allowed: boolean;
  reason?: string;
}

const auditLog: AuditEntry[] = [];

export function recordAuditEntry(entry: AuditEntry): void {
  auditLog.push(entry);
}

export function getAuditLog(): AuditEntry[] {
  return [...auditLog];
}

export function getRecentAuditEntries(count: number): AuditEntry[] {
  return auditLog.slice(-count);
}

export function clearAuditLog(): void {
  auditLog.length = 0;
}
