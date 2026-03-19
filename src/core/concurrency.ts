import { availableParallelism, cpus } from "node:os";

export function detectConcurrency(limit = 8): number {
  const cores = typeof availableParallelism === "function" ? availableParallelism() : cpus().length;
  return Math.max(1, Math.min(limit, cores));
}
