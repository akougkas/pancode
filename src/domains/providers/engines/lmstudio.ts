import { LMStudioClient } from "@lmstudio/sdk";
import type {
  DiscoveredModel,
  EngineConnection,
  EngineHealth,
  ModelCapabilities,
} from "./types";
import { emptyCapabilities } from "./types";
import { parseParamCount } from "./parse-params";

const DEFAULT_PORT = 1234;
const PROBE_TIMEOUT_MS = 3000;

export function createLmStudioConnection(
  baseUrl: string,
  providerId: string,
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

  return {
    type: "lmstudio",
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
      try {
        const sdk = ensureClient();
        const loaded = await sdk.llm.listLoaded();

        const models: DiscoveredModel[] = [];
        for (const model of loaded) {
          const caps = emptyCapabilities();

          try {
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
            // Model info unavailable; caps stay null
          }

          models.push({
            id: model.identifier,
            engine: "lmstudio",
            providerId,
            baseUrl,
            capabilities: caps,
          });
        }

        return models;
      } catch {
        // SDK connection failed; fall back to REST probe
        return this.listModelsViaRest();
      }
    },

    async listModelsViaRest(): Promise<DiscoveredModel[]> {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);

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
          .filter((entry): entry is { id: string } =>
            typeof entry.id === "string" && entry.id.trim().length > 0,
          )
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
      if (client) {
        // LMStudioClient uses Symbol.asyncDispose; fire and forget
        client[Symbol.asyncDispose]().catch((err) => {
          console.error(
            `[pancode:lmstudio] Disconnect error: ${err instanceof Error ? err.message : String(err)}`,
          );
        });
        client = null;
      }
    },
  } as EngineConnection & { listModelsViaRest(): Promise<DiscoveredModel[]> };
}

