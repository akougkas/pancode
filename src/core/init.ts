import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import type { PanCodeConfig } from "./config";

export function ensureProjectRuntime(config: Pick<PanCodeConfig, "runtimeRoot" | "resultsDir">): void {
  // runtimeRoot = .pancode/state/, resultsDir = .pancode/results/
  // Also create .pancode/config/ for project-level settings.
  const pancodeRoot = dirname(config.runtimeRoot);
  mkdirSync(join(pancodeRoot, "config"), { recursive: true });
  mkdirSync(config.runtimeRoot, { recursive: true });
  mkdirSync(config.resultsDir, { recursive: true });
}
