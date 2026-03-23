/**
 * Provider-first onboarding flow for first-run experience.
 *
 * When PanCode boots with no provider configuration, this module
 * runs auto-detection of local inference services and presents
 * discovered capabilities to the user.
 *
 * Steps:
 * 1. Auto-detect local services (Ollama, LM Studio, llama-server)
 * 2. Show what was found
 * 3. Offer cloud provider setup
 * 4. Select default model from discovered models
 */

import { existsSync } from "node:fs";
import { join } from "node:path";

export interface OnboardingResult {
  /** Whether onboarding was completed. */
  completed: boolean;
  /** Whether this is a first run (no prior config). */
  isFirstRun: boolean;
  /** Discovered local endpoints. */
  localEndpoints: LocalEndpoint[];
  /** Whether any providers were configured. */
  hasProviders: boolean;
}

export interface LocalEndpoint {
  name: string;
  host: string;
  port: number;
  available: boolean;
  modelCount: number;
}

/** Well-known local inference endpoints to probe. */
const KNOWN_ENDPOINTS: Array<{ name: string; host: string; port: number; healthPath: string }> = [
  { name: "Ollama", host: "localhost", port: 11434, healthPath: "/api/tags" },
  { name: "LM Studio", host: "localhost", port: 1234, healthPath: "/v1/models" },
  { name: "llama-server", host: "localhost", port: 8080, healthPath: "/health" },
];

/**
 * Check if this is a first-run scenario (no PanCode home directory exists
 * or no providers are configured).
 */
export function isFirstRun(pancodeHome: string): boolean {
  if (!existsSync(pancodeHome)) return true;

  const presets = join(pancodeHome, "panpresets.yaml");
  const providers = join(pancodeHome, "panproviders.yaml");

  return !existsSync(presets) && !existsSync(providers);
}

/**
 * Probe a local HTTP endpoint to check if it is responding.
 * Uses a short timeout to avoid blocking boot.
 */
export async function probeEndpoint(host: string, port: number, path: string, timeoutMs = 2000): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    const response = await fetch(`http://${host}:${port}${path}`, {
      signal: controller.signal,
      method: "GET",
    });

    clearTimeout(timer);
    return response.ok;
  } catch {
    return false;
  }
}

/**
 * Discover available local inference endpoints.
 * Probes all known endpoints in parallel with short timeouts.
 */
export async function discoverLocalEndpoints(): Promise<LocalEndpoint[]> {
  const results = await Promise.all(
    KNOWN_ENDPOINTS.map(async (ep) => {
      const available = await probeEndpoint(ep.host, ep.port, ep.healthPath);
      return {
        name: ep.name,
        host: ep.host,
        port: ep.port,
        available,
        modelCount: 0, // Populated by engine discovery
      };
    }),
  );

  return results;
}

/**
 * Generate a summary of discovered endpoints for display.
 */
export function formatDiscoverySummary(endpoints: LocalEndpoint[]): string {
  const available = endpoints.filter((ep) => ep.available);
  const unavailable = endpoints.filter((ep) => !ep.available);

  const lines: string[] = [];

  if (available.length > 0) {
    lines.push("Discovered local inference services:");
    for (const ep of available) {
      const modelInfo = ep.modelCount > 0 ? ` (${ep.modelCount} models)` : "";
      lines.push(`  ${ep.name} on ${ep.host}:${ep.port}${modelInfo}`);
    }
  }

  if (unavailable.length > 0 && available.length > 0) {
    lines.push("");
    lines.push("Not responding:");
    for (const ep of unavailable) {
      lines.push(`  ${ep.name} on ${ep.host}:${ep.port}`);
    }
  }

  if (available.length === 0) {
    lines.push("No local inference services detected.");
    lines.push("Start Ollama, LM Studio, or llama-server, or configure a cloud provider.");
  }

  return lines.join("\n");
}
