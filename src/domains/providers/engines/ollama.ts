import { Ollama } from "ollama";
import type {
  DiscoveredModel,
  EngineConnection,
  EngineHealth,
  ModelCapabilities,
} from "./types";
import { emptyCapabilities } from "./types";
import { parseParamCount } from "./parse-params";

const DEFAULT_PORT = 11434;
const PROBE_TIMEOUT_MS = 3000;

export function createOllamaConnection(
  baseUrl: string,
  providerId: string,
): EngineConnection {
  let client: Ollama | null = null;

  function ensureClient(): Ollama {
    if (!client) {
      client = new Ollama({ host: baseUrl });
    }
    return client;
  }

  return {
    type: "ollama",
    baseUrl,

    async connect(): Promise<boolean> {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);

      try {
        const response = await fetch(`${baseUrl}/api/tags`, {
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
      try {
        const ollama = ensureClient();
        const response = await ollama.list();
        if (!response.models) return [];

        const models: DiscoveredModel[] = [];
        for (const entry of response.models) {
          if (!entry.name) continue;

          const capabilities = await this.getModelCapabilities(entry.name);
          models.push({
            id: entry.name,
            engine: "ollama",
            providerId,
            baseUrl,
            capabilities,
          });
        }

        return models;
      } catch {
        return [];
      }
    },

    async getModelCapabilities(modelId: string): Promise<ModelCapabilities> {
      const caps = emptyCapabilities();

      try {
        const ollama = ensureClient();
        const info = await ollama.show({ model: modelId });

        // ollama.show() returns model_info with rich metadata
        const rawModelInfo = "model_info" in info ? info.model_info : null;
        if (rawModelInfo && typeof rawModelInfo === "object" && rawModelInfo !== null) {
          const modelInfo = rawModelInfo as unknown as Record<string, unknown>;
          // Context length is stored under various keys depending on architecture
          for (const [key, value] of Object.entries(modelInfo)) {
            if (key.endsWith(".context_length") && typeof value === "number") {
              caps.contextWindow = value;
            }
            if (key.endsWith(".parameter_count") && typeof value === "number") {
              caps.parameterCount = value;
            }
          }
          // Direct keys
          if (typeof modelInfo.context_length === "number") {
            caps.contextWindow = modelInfo.context_length;
          }
        }

        // Details field
        const rawDetails = "details" in info ? info.details : null;
        if (rawDetails && typeof rawDetails === "object" && rawDetails !== null) {
          const details = rawDetails as unknown as Record<string, unknown>;
          if (typeof details.family === "string") {
            caps.family = details.family;
          }
          if (typeof details.quantization_level === "string") {
            caps.quantization = details.quantization_level;
          }
          if (typeof details.parameter_size === "string") {
            const parsed = parseParamCount(details.parameter_size);
            if (parsed !== null) caps.parameterCount = parsed;
          }
        }
      } catch {
        // show() failed; capabilities stay null
      }

      return caps;
    },

    async health(): Promise<EngineHealth> {
      const start = Date.now();
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);

      try {
        const response = await fetch(`${baseUrl}/api/tags`, {
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
      client = null;
    },
  };
}

