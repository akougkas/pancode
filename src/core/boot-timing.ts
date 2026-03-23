/**
 * Boot timing shared state.
 *
 * The orchestrator records per-phase timing during boot and stores it here.
 * The UI domain reads it to render the /perf command output. Using a shared
 * module in core/ avoids any cross-domain or engine boundary violations.
 */

export interface BootPhaseRecord {
  name: string;
  label: string;
  durationMs: number;
}

export interface BootTimingData {
  mode: "warm" | "cold";
  phases: BootPhaseRecord[];
  totalMs: number;
  budgetMs: number;
  budgetExceeded: boolean;
}

let _bootTimings: BootTimingData | null = null;

export function setBootTimings(data: BootTimingData): void {
  _bootTimings = data;
}

export function getBootTimings(): BootTimingData | null {
  return _bootTimings;
}
