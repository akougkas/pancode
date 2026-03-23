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
  PANCODE_AGENT_DIR,
  PANCODE_HOME,
  buildModelArgs,
  createSharedAuth,
  resolveConfiguredModel,
  resolveModel,
} from "./shared";
