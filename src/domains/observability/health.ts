export interface HealthStatus {
  status: "healthy" | "degraded" | "unhealthy";
  uptime: number;
  activeWorkers: number;
  totalDispatches: number;
  lastError: string | null;
  memoryUsageMb: number;
}

const startTime = Date.now();
let lastError: string | null = null;

export function recordHealthError(error: string): void {
  lastError = error;
}

export function getHealthStatus(activeWorkers: number, totalDispatches: number): HealthStatus {
  const memUsage = process.memoryUsage();
  const memoryUsageMb = Math.round(memUsage.heapUsed / 1024 / 1024);

  let status: HealthStatus["status"] = "healthy";
  if (lastError) status = "degraded";
  if (memoryUsageMb > 2048) status = "unhealthy";

  return {
    status,
    uptime: Date.now() - startTime,
    activeWorkers,
    totalDispatches,
    lastError,
    memoryUsageMb,
  };
}
