import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { PanCodeConfig } from "../core/config";

/**
 * Build Pi CLI --provider and --model arguments from config.
 * Handles compound "provider/model-id" format by splitting into separate flags.
 * Pi CLI requires --provider and --model as separate arguments.
 */
export function buildWorkerModelArgs(config: Pick<PanCodeConfig, "provider" | "model">): string[] {
  const args: string[] = [];
  let provider = config.provider;
  let model = config.model;

  // Split compound "provider/model-id" format if present.
  if (model && model.includes("/") && !provider) {
    const slashIdx = model.indexOf("/");
    provider = model.slice(0, slashIdx);
    model = model.slice(slashIdx + 1);
  }

  if (provider) args.push("--provider", provider);
  if (model) args.push("--model", model);
  return args;
}

// Set by loader.ts at boot
const pancodeHome = process.env.PANCODE_HOME;
if (!pancodeHome) {
  throw new Error("PANCODE_HOME must be set before loading provider-bridge");
}

export const PANCODE_HOME = pancodeHome;
export const PANCODE_AGENT_DIR = join(PANCODE_HOME, "agent-engine");

function copyLegacyFileIfMissing(fileName: string): void {
  const legacyPiDir = join(homedir(), ".pi", "agent");
  const sourcePath = join(legacyPiDir, fileName);
  const targetPath = join(PANCODE_AGENT_DIR, fileName);
  if (existsSync(sourcePath) && !existsSync(targetPath)) {
    copyFileSync(sourcePath, targetPath);
  }
}

export function ensureWorkerAgentDir(): string {
  mkdirSync(PANCODE_AGENT_DIR, { recursive: true });
  copyLegacyFileIfMissing("auth.json");
  copyLegacyFileIfMissing("models.json");
  copyLegacyFileIfMissing("settings.json");
  return PANCODE_AGENT_DIR;
}

export function createWorkerEnvironment(baseEnv: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  return {
    ...baseEnv,
    PI_CODING_AGENT_DIR: ensureWorkerAgentDir(),
  };
}
