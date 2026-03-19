import type { DiscoveredModel, EngineConnection, EngineHealth, ModelCapabilities } from "./types";
import { emptyCapabilities } from "./types";

const DEFAULT_PORT = 8080;
const PROBE_TIMEOUT_MS = 3000;

export function createLlamaCppConnection(baseUrl: string, providerId: string): EngineConnection {
  return {
    type: "llamacpp",
    baseUrl,

    async connect(): Promise<boolean> {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);

      try {
        const response = await fetch(`${baseUrl}/v1/models`, {
          signal: controller.signal,
        });
        clearTimeout(timeout);
        return response.ok;
      } catch {
        clearTimeout(timeout);
        return false;
      }
    },

    async listModels(): Promise<DiscoveredModel[]> {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);

      try {
        const response = await fetch(`${baseUrl}/v1/models`, {
          signal: controller.signal,
        });
        clearTimeout(timeout);

        if (!response.ok) return [];

        const body = (await response.json()) as {
          data?: Array<{
            id?: string;
            status?: { args?: unknown[] };
          }>;
        };
        if (!Array.isArray(body.data)) return [];

        const models: DiscoveredModel[] = [];
        for (const entry of body.data) {
          if (typeof entry.id !== "string" || !entry.id.trim()) continue;
          // Skip the generic "default" model id llama-server sometimes reports
          if (/^default$/i.test(entry.id)) continue;

          const capabilities = parseCapabilitiesFromEntry(entry);
          models.push({
            id: entry.id,
            engine: "llamacpp",
            providerId,
            baseUrl,
            capabilities,
          });
        }

        return models;
      } catch {
        clearTimeout(timeout);
        return [];
      }
    },

    async getModelCapabilities(modelId: string): Promise<ModelCapabilities> {
      // Re-fetch /v1/models and find the specific model's args
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);

      try {
        const response = await fetch(`${baseUrl}/v1/models`, {
          signal: controller.signal,
        });
        clearTimeout(timeout);

        if (!response.ok) return emptyCapabilities();

        const body = (await response.json()) as {
          data?: Array<{
            id?: string;
            status?: { args?: unknown[] };
          }>;
        };
        if (!Array.isArray(body.data)) return emptyCapabilities();

        const entry = body.data.find((m) => m.id === modelId);
        if (!entry) return emptyCapabilities();

        return parseCapabilitiesFromEntry(entry);
      } catch {
        clearTimeout(timeout);
        return emptyCapabilities();
      }
    },

    async health(): Promise<EngineHealth> {
      const start = Date.now();
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);

      try {
        const response = await fetch(`${baseUrl}/v1/models`, {
          signal: controller.signal,
        });
        clearTimeout(timeout);
        return {
          reachable: response.ok,
          latencyMs: Date.now() - start,
          error: response.ok ? null : `HTTP ${response.status}`,
        };
      } catch (err) {
        clearTimeout(timeout);
        return {
          reachable: false,
          latencyMs: null,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    },

    disconnect(): void {
      // llama-server is stateless REST; nothing to disconnect
    },
  };
}

function parseCapabilitiesFromEntry(entry: {
  id?: string;
  status?: { args?: unknown[] };
}): ModelCapabilities {
  const caps = emptyCapabilities();
  const args = entry.status?.args;

  if (!Array.isArray(args)) return caps;

  caps.contextWindow = parseArgValue(args, "--ctx-size", "-c");
  caps.temperature = parseArgFloat(args, "--temperature", "--temp");
  caps.topK = parseArgValue(args, "--top-k");
  caps.topP = parseArgFloat(args, "--top-p");

  return caps;
}

function parseArgValue(args: unknown[], ...flags: string[]): number | null {
  for (let i = 0; i < args.length; i++) {
    const value = String(args[i]);

    for (const flag of flags) {
      if (value.startsWith(`${flag}=`)) {
        const parsed = Number.parseInt(value.split("=", 2)[1] ?? "", 10);
        if (Number.isFinite(parsed) && parsed > 0) return parsed;
      }
      if (value === flag && i + 1 < args.length) {
        const parsed = Number.parseInt(String(args[i + 1]), 10);
        if (Number.isFinite(parsed) && parsed > 0) return parsed;
      }
    }
  }

  return null;
}

function parseArgFloat(args: unknown[], ...flags: string[]): number | null {
  for (let i = 0; i < args.length; i++) {
    const value = String(args[i]);

    for (const flag of flags) {
      if (value.startsWith(`${flag}=`)) {
        const parsed = Number.parseFloat(value.split("=", 2)[1] ?? "");
        if (Number.isFinite(parsed)) return parsed;
      }
      if (value === flag && i + 1 < args.length) {
        const parsed = Number.parseFloat(String(args[i + 1]));
        if (Number.isFinite(parsed)) return parsed;
      }
    }
  }

  return null;
}
