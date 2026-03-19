export type EngineType = "lmstudio" | "ollama" | "llamacpp";

export interface EngineHealth {
  reachable: boolean;
  latencyMs: number | null;
  error: string | null;
}

export interface ModelCapabilities {
  contextWindow: number | null;
  maxOutputTokens: number | null;
  temperature: number | null;
  topK: number | null;
  topP: number | null;
  toolCalling: boolean | null;
  reasoning: boolean | null;
  thinkingFormat: string | null;
  vision: boolean | null;
  parameterCount: number | null;
  quantization: string | null;
  family: string | null;
}

export interface DiscoveredModel {
  id: string;
  engine: EngineType;
  providerId: string;
  baseUrl: string;
  capabilities: ModelCapabilities;
}

export interface EngineConnection {
  readonly type: EngineType;
  readonly baseUrl: string;
  connect(): Promise<boolean>;
  listModels(): Promise<DiscoveredModel[]>;
  getModelCapabilities(modelId: string): Promise<ModelCapabilities>;
  health(): Promise<EngineHealth>;
  disconnect(): void;
}

export function emptyCapabilities(): ModelCapabilities {
  return {
    contextWindow: null,
    maxOutputTokens: null,
    temperature: null,
    topK: null,
    topP: null,
    toolCalling: null,
    reasoning: null,
    thinkingFormat: null,
    vision: null,
    parameterCount: null,
    quantization: null,
    family: null,
  };
}
