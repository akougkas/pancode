import { LMStudioClient } from "@lmstudio/sdk";
import { parseParamCount } from "./parse-params";
import type { DiscoveredModel, EngineConnection, EngineHealth, ModelCapabilities } from "./types";
import { emptyCapabilities } from "./types";

const DEFAULT_PORT = 1234;
const DEFAULT_PROBE_TIMEOUT_MS = 1000;
const RUNTIME_TIMEOUT_MS = 3000;

export function createLmStudioConnection(
  baseUrl: string,
  providerId: string,
  probeTimeoutMs = DEFAULT_PROBE_TIMEOUT_MS,
): EngineConnection {
  let client: LMStudioClient | null = null;

  function parseHost(): { host: string; port: number } {
    try {
      const url = new URL(baseUrl);
      return {
        host: url.hostname,
        port: url.port ? Number.parseInt(url.port, 10) : DEFAULT_PORT,
      };
    } catch {
      return { host: "127.0.0.1", port: DEFAULT_PORT };
    }
  }

  function ensureClient(): LMStudioClient {
    if (!client) {
      const { host, port } = parseHost();
      client = new LMStudioClient({ baseUrl: `ws://${host}:${port}` });
    }
    return client;
  }

  async function listModelsViaRest(): Promise<DiscoveredModel[]> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), probeTimeoutMs);

    try {
      const response = await fetch(`${baseUrl}/v1/models`, {
        signal: controller.signal,
      });
      clearTimeout(timeout);

      if (!response.ok) return [];

      const body = (await response.json()) as {
        data?: Array<{ id?: string }>;
      };
      if (!Array.isArray(body.data)) return [];

      return body.data
        .filter((entry): entry is { id: string } => typeof entry.id === "string" && entry.id.trim().length > 0)
        .map((entry) => ({
          id: entry.id,
          engine: "lmstudio" as const,
          providerId,
          baseUrl,
          capabilities: emptyCapabilities(),
        }));
    } catch {
      clearTimeout(timeout);
      return [];
    }
  }

  return {
    type: "lmstudio",
    baseUrl,

    async connect(): Promise<boolean> {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), probeTimeoutMs);

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
      // Use the native API (/api/v0/models) that returns context window, vision,
      // tool_use, quantization, and architecture in a single REST call (~40ms).
      // This replaces the previous approach of /v1/models + WebSocket SDK
      // enrichment which required a per-model getModelInfo() round trip.
      const controller = new AbortController();
      const nativeTimeout = setTimeout(() => controller.abort(), probeTimeoutMs);

      try {
        const response = await fetch(`${baseUrl}/api/v0/models`, {
          signal: controller.signal,
        });
        clearTimeout(nativeTimeout);

        if (!response.ok) return listModelsViaRest();

        const body = (await response.json()) as {
          data?: Array<{
            id?: string;
            type?: string;
            arch?: string;
            quantization?: string;
            max_context_length?: number;
            loaded_context_length?: number;
            capabilities?: string[];
            state?: string;
          }>;
        };
        if (!Array.isArray(body.data)) return listModelsViaRest();

        const models: DiscoveredModel[] = [];
        for (const entry of body.data) {
          if (typeof entry.id !== "string" || !entry.id.trim()) continue;
          const caps = emptyCapabilities();
          caps.contextWindow = entry.max_context_length ?? null;
          caps.vision = entry.type === "vlm";
          caps.toolCalling = entry.capabilities?.includes("tool_use") ?? null;
          caps.quantization = entry.quantization ?? null;
          caps.family = entry.arch ?? null;
          models.push({
            id: entry.id,
            engine: "lmstudio",
            providerId,
            baseUrl,
            capabilities: caps,
          });
        }
        return models;
      } catch {
        clearTimeout(nativeTimeout);
        // Native API unavailable (older LM Studio); fall back to REST
        return listModelsViaRest();
      }
    },

    async getModelCapabilities(modelId: string): Promise<ModelCapabilities> {
      const caps = emptyCapabilities();

      try {
        const sdk = ensureClient();
        const model = await sdk.llm.model(modelId);
        const info = await model.getModelInfo();
        caps.contextWindow = info.contextLength ?? null;
        caps.vision = info.vision ?? null;
        caps.toolCalling = info.trainedForToolUse ?? null;
        if (info.paramsString) {
          caps.parameterCount = parseParamCount(info.paramsString);
        }
        if (info.quantization) {
          caps.quantization = String(info.quantization);
        }
      } catch {
        // SDK enrichment failed
      }

      return caps;
    },

    async health(): Promise<EngineHealth> {
      const start = Date.now();
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), RUNTIME_TIMEOUT_MS);

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
      if (client) {
        // LMStudioClient uses Symbol.asyncDispose; fire and forget
        client[Symbol.asyncDispose]().catch((err) => {
          console.error(`[pancode:lmstudio] Disconnect error: ${err instanceof Error ? err.message : String(err)}`);
        });
        client = null;
      }
    },
  };
}
