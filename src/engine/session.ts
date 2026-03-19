import {
  type CreateAgentSessionOptions,
  type CreateAgentSessionResult,
  type InteractiveModeOptions,
  AuthStorage as PiAuthStorage,
  DefaultResourceLoader as PiDefaultResourceLoader,
  InteractiveMode as PiInteractiveMode,
  ModelRegistry as PiModelRegistry,
  SessionManager as PiSessionManager,
  SettingsManager as PiSettingsManager,
  codingTools as piCodingTools,
  createAgentSession as piCreateAgentSession,
  createEventBus as piCreateEventBus,
  readOnlyTools as piReadOnlyTools,
} from "@pancode/pi-coding-agent";

export type { CreateAgentSessionOptions, CreateAgentSessionResult, InteractiveModeOptions };

export const AuthStorage = PiAuthStorage;
export const DefaultResourceLoader = PiDefaultResourceLoader;
export const InteractiveMode = PiInteractiveMode;
export const ModelRegistry = PiModelRegistry;
export const SessionManager = PiSessionManager;
export const SettingsManager = PiSettingsManager;
export const codingTools = piCodingTools;
export const readOnlyTools = piReadOnlyTools;

export function createEventBus() {
  return piCreateEventBus();
}

export async function createAgentSession(options?: CreateAgentSessionOptions): Promise<CreateAgentSessionResult> {
  return piCreateAgentSession(options);
}
