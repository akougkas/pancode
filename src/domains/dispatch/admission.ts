export interface PreFlightContext {
  task: string;
  agent: string;
  model: string | null;
}

export interface PreFlightResult {
  admit: boolean;
  reason?: string;
}

type PreFlightCheck = (context: PreFlightContext) => PreFlightResult;

const checks = new Map<string, PreFlightCheck>();

export function registerPreFlightCheck(name: string, fn: PreFlightCheck): void {
  checks.set(name, fn);
}

export function runPreFlightChecks(context: PreFlightContext): PreFlightResult {
  for (const [name, check] of checks) {
    const result = check(context);
    if (!result.admit) {
      return { admit: false, reason: `[${name}] ${result.reason ?? "check failed with no reason"}` };
    }
  }
  return { admit: true };
}
