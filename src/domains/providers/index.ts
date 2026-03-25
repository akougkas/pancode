export { detectAnthropicAuth, registerAnthropicModels, getAnthropicModelCatalog } from "./anthropic-catalog";
export { detectOpenAICodexAuth, registerOpenAICodexModels, getOpenAICodexModelCatalog } from "./openai-codex-catalog";
export { registerApiProvidersOnRegistry } from "./api-providers";
export {
  discoverEngines,
  writeProvidersYaml,
  type DiscoveryResult,
} from "./discovery";
export {
  loadModelKnowledgeBase,
  loadRegistryMetadata,
  matchAllModels,
  readModelCacheYaml,
  writeModelCacheYaml,
  setModelProfileCache,
  getModelProfileCache,
  setRegistryMetadata,
  getRegistryMetadata,
  checkModelAvoided,
  getRecommendedModels,
  findModelProfile,
  getSamplingPreset,
  isEmbeddingModel,
  type MergedModelProfile,
  type SamplingPreset,
  type RegistryMetadata,
  type AvoidEntry,
} from "./model-matcher";
export {
  readModelPerfStore,
  writeModelPerfStore,
  recordModelRun,
  getModelPerf,
  getAllModelPerf,
  type ModelPerfEntry,
  type ModelPerfStore,
} from "./model-perf";
export { registerDiscoveredModels } from "./registry";
export {
  buildModelArgs,
  createSharedAuth,
  resolveConfiguredModel,
  resolveModel,
} from "./shared";
