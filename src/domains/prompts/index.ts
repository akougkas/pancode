export { manifest } from "./manifest";
export { extension } from "./extension";

// Compilation engine
export { compilePrompt, estimateTokens, expandVariables } from "./compiler";

// Model tiering
export { classifyModelTier, deriveProviderHint } from "./tiering";
export type { TierableCapabilities, ProviderHint } from "./tiering";

// Pi SDK compatibility
export { detectSections, surgePiPrompt } from "./pi-compat";
export type { PiPromptSections } from "./pi-compat";

// Types
export type {
  CompilationContext,
  CompiledPrompt,
  Fragment,
  FragmentCategory,
  ModelTier,
  PromptManifest,
  PromptRole,
  WorkerPromptContext,
} from "./types";
export { CATEGORY_ORDER } from "./types";

// Orchestrator compiler
export { compileOrchestratorPrompt, getLastOrchestratorCompilation } from "./orchestrator-compiler";
export type { ModelProfileSlice } from "./orchestrator-compiler";

// Worker and scout compiler
export { compileWorkerPrompt, compileScoutPrompt, getRecentWorkerCompilations } from "./worker-compiler";
export type { AgentSpecSlice, WorkerModelProfileSlice } from "./worker-compiler";

// Versioning
export { persistPromptManifest, loadLatestManifest, appendToHistory, loadHistory, diffManifests } from "./versioning";

// Fragment library
export { ALL_FRAGMENTS } from "./fragments";
