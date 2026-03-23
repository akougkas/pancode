import type { ActionClass, AutonomyMode } from "./scope";

/** Structured reason code for machine-parseable safety decisions. */
export type SafetyReasonCode = "MODE_GATE" | "SAFETY_POLICY" | "SCOPE_VIOLATION" | "YAML_RULE";

/** Machine-parseable safety decision emitted on every tool call evaluation. */
export interface SafetyDecision {
  action: string;
  decision: "allow" | "block";
  reasonCode: SafetyReasonCode;
  reasonDetail: string;
  correlationId?: string;
}

export interface AuditEntry {
  timestamp: string;
  toolName: string;
  actionClass: ActionClass;
  autonomyMode: AutonomyMode;
  allowed: boolean;
  reason?: string;
  /** Structured reason code for blocked actions. */
  reasonCode?: SafetyReasonCode;
  /** Dispatch runId for correlating events within a single dispatch lifecycle. */
  correlationId?: string;
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
