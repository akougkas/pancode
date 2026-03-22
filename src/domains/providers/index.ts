export { registerApiProvidersOnRegistry } from "./api-providers";
export {
  discoverEngines,
  writeProvidersYaml,
  type DiscoveryResult,
} from "./discovery";
export {
  loadModelKnowledgeBase,
  matchAllModels,
  readModelCacheYaml,
  writeModelCacheYaml,
  setModelProfileCache,
  getModelProfileCache,
  findModelProfile,
  getSamplingPreset,
  type MergedModelProfile,
  type SamplingPreset,
} from "./model-matcher";
export { registerDiscoveredModels } from "./registry";
export {
  PANCODE_AGENT_DIR,
  PANCODE_HOME,
  buildModelArgs,
  createSharedAuth,
  resolveConfiguredModel,
  resolveModel,
} from "./shared";
