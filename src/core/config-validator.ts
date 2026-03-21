import type { PanCodeConfig, SafetyLevel } from "./config";
import { parseReasoningPreference } from "./thinking";

export interface ConfigValidationError {
  path: string;
  message: string;
}

export interface ConfigValidationResult<T> {
  ok: boolean;
  errors: ConfigValidationError[];
  value?: T;
}

export function isSafetyLevel(value: unknown): value is SafetyLevel {
  return value === "suggest" || value === "auto-edit" || value === "full-auto";
}

export function validateConfigShape(config: Partial<PanCodeConfig>): ConfigValidationResult<Partial<PanCodeConfig>> {
  const errors: ConfigValidationError[] = [];

  if (config.profile != null && typeof config.profile !== "string") {
    errors.push({ path: "profile", message: "must be a string" });
  }
  if (config.theme != null && typeof config.theme !== "string") {
    errors.push({ path: "theme", message: "must be a string" });
  }
  if (config.prompt != null && typeof config.prompt !== "string") {
    errors.push({ path: "prompt", message: "must be a string" });
  }
  if (config.provider != null && typeof config.provider !== "string") {
    errors.push({ path: "provider", message: "must be a string or null" });
  }
  if (config.model != null && typeof config.model !== "string") {
    errors.push({ path: "model", message: "must be a string or null" });
  }
  if (config.preferredProvider != null && typeof config.preferredProvider !== "string") {
    errors.push({ path: "preferredProvider", message: "must be a string or null" });
  }
  if (config.preferredModel != null && typeof config.preferredModel !== "string") {
    errors.push({ path: "preferredModel", message: "must be a string or null" });
  }
  if (config.safety != null && !isSafetyLevel(config.safety)) {
    errors.push({ path: "safety", message: "must be suggest, auto-edit, or full-auto" });
  }
  if (config.reasoningPreference != null && !parseReasoningPreference(config.reasoningPreference)) {
    errors.push({ path: "reasoningPreference", message: "must be off, on, minimal, low, medium, high, or xhigh" });
  }
  if (config.domains != null && !Array.isArray(config.domains)) {
    errors.push({ path: "domains", message: "must be an array of strings" });
  }
  if (Array.isArray(config.domains) && config.domains.some((entry) => typeof entry !== "string")) {
    errors.push({ path: "domains", message: "must contain only strings" });
  }
  if (config.extensions != null && !Array.isArray(config.extensions)) {
    errors.push({ path: "extensions", message: "must be an array of strings" });
  }
  if (Array.isArray(config.extensions) && config.extensions.some((entry) => typeof entry !== "string")) {
    errors.push({ path: "extensions", message: "must contain only strings" });
  }
  if (config.timeoutMs != null && (!Number.isFinite(config.timeoutMs) || config.timeoutMs <= 0)) {
    errors.push({ path: "timeoutMs", message: "must be a positive number" });
  }

  return errors.length === 0 ? { ok: true, errors, value: config } : { ok: false, errors };
}
