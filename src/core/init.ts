import { mkdirSync } from "node:fs";
import type { PanCodeConfig } from "./config";

export function ensureProjectRuntime(config: Pick<PanCodeConfig, "runtimeRoot" | "resultsDir">): void {
  mkdirSync(config.runtimeRoot, { recursive: true });
  mkdirSync(config.resultsDir, { recursive: true });
}
