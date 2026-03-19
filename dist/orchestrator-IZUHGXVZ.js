import {
  PANCODE_PRODUCT_NAME,
  formatShellCommandLines
} from "./chunk-WNATMMYV.js";
import {
  DEFAULT_REASONING_PREFERENCE,
  THINKING_LEVELS,
  atomicWriteJsonSync,
  ensureProjectRuntime,
  getModelReasoningControl,
  loadConfig,
  parseReasoningPreference,
  parseThinkingLevel,
  resolveThinkingLevelForPreference,
  updatePanCodeSettings
} from "./chunk-EN4IKIU3.js";
import {
  resolvePackageRoot
} from "./chunk-RRR3VFYK.js";
import {
  __require
} from "./chunk-DGUM43GV.js";

// src/entry/orchestrator.ts
import { join as join15 } from "path";

// src/engine/session.ts
import {
  AuthStorage as PiAuthStorage,
  DefaultResourceLoader as PiDefaultResourceLoader,
  InteractiveMode as PiInteractiveMode,
  ModelRegistry as PiModelRegistry,
  SessionManager as PiSessionManager,
  SettingsManager as PiSettingsManager,
  codingTools as piCodingTools,
  createAgentSession as piCreateAgentSession,
  createEventBus as piCreateEventBus,
  readOnlyTools as piReadOnlyTools
} from "@pancode/pi-coding-agent";
var AuthStorage = PiAuthStorage;
var InteractiveMode = PiInteractiveMode;
var ModelRegistry = PiModelRegistry;
var codingTools = piCodingTools;
var readOnlyTools = piReadOnlyTools;
function createEventBus() {
  return piCreateEventBus();
}
async function createAgentSession(options) {
  return piCreateAgentSession(options);
}

// src/core/event-bus.ts
function reportListenerError(channel, error) {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  console.error(`[pancode:event-bus] Listener crashed on ${channel}: ${message}`);
}
function emitSafe(bus, channel, payload) {
  for (const listener of bus.listeners(channel)) {
    queueMicrotask(() => {
      void Promise.resolve().then(() => listener(payload)).catch((error) => reportListenerError(channel, error));
    });
  }
}
function createSafeEventBus() {
  const baseBus = createEventBus();
  const registry = /* @__PURE__ */ new Map();
  const bus = {
    emit(channel, payload) {
      emitSafe(bus, channel, payload);
    },
    emitSafe(channel, payload) {
      emitSafe(bus, channel, payload);
    },
    on(channel, listener) {
      const listeners = registry.get(channel) ?? /* @__PURE__ */ new Set();
      listeners.add(listener);
      registry.set(channel, listeners);
      return () => {
        const current = registry.get(channel);
        if (!current) return;
        current.delete(listener);
        if (current.size === 0) registry.delete(channel);
      };
    },
    listeners(channel) {
      return [...registry.get(channel) ?? []];
    },
    clear() {
      registry.clear();
      baseBus.clear();
    }
  };
  return bus;
}

// src/core/domain-loader.ts
function uniqueInOrder(values) {
  const seen = /* @__PURE__ */ new Set();
  const result = [];
  for (const value of values) {
    if (seen.has(value)) continue;
    seen.add(value);
    result.push(value);
  }
  return result;
}
function getRegistryEntry(name, registry) {
  const entry = registry[name];
  if (!entry) {
    const available = Object.keys(registry).sort().join(", ");
    throw new Error(`Unknown domain "${name}". Available domains: ${available}`);
  }
  if (entry.manifest.name !== name) {
    throw new Error(`Domain registry key "${name}" does not match manifest name "${entry.manifest.name}".`);
  }
  return entry;
}
function resolveDomainOrder(enabledDomains, registry) {
  const enabled = uniqueInOrder(enabledDomains);
  if (enabled.length === 0) return [];
  const priority = new Map(enabled.map((name, index) => [name, index]));
  const enabledSet = new Set(enabled);
  const inDegree = /* @__PURE__ */ new Map();
  const dependents = /* @__PURE__ */ new Map();
  for (const name of enabled) {
    const entry = getRegistryEntry(name, registry);
    const dependencies = [...entry.manifest.dependsOn ?? []];
    inDegree.set(name, dependencies.length);
    for (const dependency of dependencies) {
      getRegistryEntry(dependency, registry);
      if (!enabledSet.has(dependency)) {
        throw new Error(`Domain "${name}" depends on "${dependency}", but "${dependency}" is not enabled.`);
      }
      const listeners = dependents.get(dependency) ?? [];
      listeners.push(name);
      dependents.set(dependency, listeners);
    }
  }
  const ready = enabled.filter((name) => (inDegree.get(name) ?? 0) === 0);
  const ordered = [];
  while (ready.length > 0) {
    ready.sort((left, right) => {
      const leftPriority = priority.get(left) ?? Number.MAX_SAFE_INTEGER;
      const rightPriority = priority.get(right) ?? Number.MAX_SAFE_INTEGER;
      return leftPriority === rightPriority ? left.localeCompare(right) : leftPriority - rightPriority;
    });
    const name = ready.shift();
    ordered.push(name);
    for (const dependent of dependents.get(name) ?? []) {
      const nextDegree = (inDegree.get(dependent) ?? 0) - 1;
      inDegree.set(dependent, nextDegree);
      if (nextDegree === 0) ready.push(dependent);
    }
  }
  if (ordered.length !== enabled.length) {
    const remaining = enabled.filter((name) => !ordered.includes(name)).join(", ");
    throw new Error(`Domain dependency cycle detected: ${remaining}`);
  }
  return ordered.map((name) => registry[name]);
}
function collectDomainExtensions(enabledDomains, registry) {
  return resolveDomainOrder(enabledDomains, registry).map((entry) => entry.extension);
}

// src/core/termination.ts
var ShutdownCoordinator = class {
  phase = "idle";
  drainHandlers = [];
  terminateHandlers = [];
  persistHandlers = [];
  exitHandlers = [];
  onDrain(handler) {
    this.drainHandlers.push(handler);
  }
  onTerminate(handler) {
    this.terminateHandlers.push(handler);
  }
  onPersist(handler) {
    this.persistHandlers.push(handler);
  }
  onExit(handler) {
    this.exitHandlers.push(handler);
  }
  getPhase() {
    return this.phase;
  }
  isDraining() {
    return this.phase !== "idle";
  }
  async execute() {
    if (this.phase !== "idle") return;
    this.phase = "draining";
    await this.runHandlers(this.drainHandlers, "drain");
    this.phase = "terminating";
    await this.runHandlers(this.terminateHandlers, "terminate");
    this.phase = "persisting";
    await this.runHandlers(this.persistHandlers, "persist");
    this.phase = "exiting";
    await this.runHandlers(this.exitHandlers, "exit");
  }
  async runHandlers(handlers, phase) {
    for (const handler of handlers) {
      try {
        await handler();
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[pancode:shutdown:${phase}] Handler error: ${msg}`);
      }
    }
  }
};
var shutdownCoordinator = new ShutdownCoordinator();

// src/engine/extensions.ts
function defineExtension(factory) {
  return factory;
}

// src/domains/providers/api-providers.ts
function registerApiProvidersOnRegistry(_modelRegistry, _projectRoot) {
  return [];
}

// src/domains/providers/discovery.ts
import { writeFileSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import YAML from "yaml";

// src/domains/providers/engines/lmstudio.ts
import { LMStudioClient } from "@lmstudio/sdk";

// src/domains/providers/engines/types.ts
function emptyCapabilities() {
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
    family: null
  };
}

// src/domains/providers/engines/parse-params.ts
function parseParamCount(raw) {
  const match = raw.match(/^([\d.]+)\s*([BKMGT])/i);
  if (!match) return null;
  const value = parseFloat(match[1]);
  if (!Number.isFinite(value)) return null;
  const unit = match[2].toUpperCase();
  const multipliers = {
    K: 1e3,
    M: 1e6,
    B: 1e9,
    G: 1e9,
    T: 1e12
  };
  return value * (multipliers[unit] ?? 1);
}

// src/domains/providers/engines/lmstudio.ts
var DEFAULT_PORT = 1234;
var PROBE_TIMEOUT_MS = 3e3;
function createLmStudioConnection(baseUrl, providerId) {
  let client = null;
  function parseHost() {
    try {
      const url = new URL(baseUrl);
      return {
        host: url.hostname,
        port: url.port ? Number.parseInt(url.port, 10) : DEFAULT_PORT
      };
    } catch {
      return { host: "127.0.0.1", port: DEFAULT_PORT };
    }
  }
  function ensureClient() {
    if (!client) {
      const { host, port } = parseHost();
      client = new LMStudioClient({ baseUrl: `ws://${host}:${port}` });
    }
    return client;
  }
  return {
    type: "lmstudio",
    baseUrl,
    async connect() {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
      try {
        const response = await fetch(`${baseUrl}/v1/models`, {
          signal: controller.signal
        });
        clearTimeout(timeout);
        return response.ok;
      } catch {
        clearTimeout(timeout);
        return false;
      }
    },
    async listModels() {
      try {
        const sdk = ensureClient();
        const loaded = await sdk.llm.listLoaded();
        const models = [];
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
          }
          models.push({
            id: model.identifier,
            engine: "lmstudio",
            providerId,
            baseUrl,
            capabilities: caps
          });
        }
        return models;
      } catch {
        return this.listModelsViaRest();
      }
    },
    async listModelsViaRest() {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
      try {
        const response = await fetch(`${baseUrl}/v1/models`, {
          signal: controller.signal
        });
        clearTimeout(timeout);
        if (!response.ok) return [];
        const body = await response.json();
        if (!Array.isArray(body.data)) return [];
        return body.data.filter(
          (entry) => typeof entry.id === "string" && entry.id.trim().length > 0
        ).map((entry) => ({
          id: entry.id,
          engine: "lmstudio",
          providerId,
          baseUrl,
          capabilities: emptyCapabilities()
        }));
      } catch {
        clearTimeout(timeout);
        return [];
      }
    },
    async getModelCapabilities(modelId) {
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
      }
      return caps;
    },
    async health() {
      const start = Date.now();
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
      try {
        const response = await fetch(`${baseUrl}/v1/models`, {
          signal: controller.signal
        });
        clearTimeout(timeout);
        return {
          reachable: response.ok,
          latencyMs: Date.now() - start,
          error: response.ok ? null : `HTTP ${response.status}`
        };
      } catch (err) {
        clearTimeout(timeout);
        return {
          reachable: false,
          latencyMs: null,
          error: err instanceof Error ? err.message : String(err)
        };
      }
    },
    disconnect() {
      if (client) {
        client[Symbol.asyncDispose]().catch((err) => {
          console.error(
            `[pancode:lmstudio] Disconnect error: ${err instanceof Error ? err.message : String(err)}`
          );
        });
        client = null;
      }
    }
  };
}

// src/domains/providers/engines/ollama.ts
import { Ollama } from "ollama";
var PROBE_TIMEOUT_MS2 = 3e3;
function createOllamaConnection(baseUrl, providerId) {
  let client = null;
  function ensureClient() {
    if (!client) {
      client = new Ollama({ host: baseUrl });
    }
    return client;
  }
  return {
    type: "ollama",
    baseUrl,
    async connect() {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS2);
      try {
        const response = await fetch(`${baseUrl}/api/tags`, {
          signal: controller.signal
        });
        clearTimeout(timeout);
        return response.ok;
      } catch {
        clearTimeout(timeout);
        return false;
      }
    },
    async listModels() {
      try {
        const ollama = ensureClient();
        const response = await ollama.list();
        if (!response.models) return [];
        const models = [];
        for (const entry of response.models) {
          if (!entry.name) continue;
          const capabilities = await this.getModelCapabilities(entry.name);
          models.push({
            id: entry.name,
            engine: "ollama",
            providerId,
            baseUrl,
            capabilities
          });
        }
        return models;
      } catch {
        return [];
      }
    },
    async getModelCapabilities(modelId) {
      const caps = emptyCapabilities();
      try {
        const ollama = ensureClient();
        const info = await ollama.show({ model: modelId });
        const rawModelInfo = "model_info" in info ? info.model_info : null;
        if (rawModelInfo && typeof rawModelInfo === "object" && rawModelInfo !== null) {
          const modelInfo = rawModelInfo;
          for (const [key, value] of Object.entries(modelInfo)) {
            if (key.endsWith(".context_length") && typeof value === "number") {
              caps.contextWindow = value;
            }
            if (key.endsWith(".parameter_count") && typeof value === "number") {
              caps.parameterCount = value;
            }
          }
          if (typeof modelInfo.context_length === "number") {
            caps.contextWindow = modelInfo.context_length;
          }
        }
        const rawDetails = "details" in info ? info.details : null;
        if (rawDetails && typeof rawDetails === "object" && rawDetails !== null) {
          const details = rawDetails;
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
      }
      return caps;
    },
    async health() {
      const start = Date.now();
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS2);
      try {
        const response = await fetch(`${baseUrl}/api/tags`, {
          signal: controller.signal
        });
        clearTimeout(timeout);
        return {
          reachable: response.ok,
          latencyMs: Date.now() - start,
          error: response.ok ? null : `HTTP ${response.status}`
        };
      } catch (err) {
        clearTimeout(timeout);
        return {
          reachable: false,
          latencyMs: null,
          error: err instanceof Error ? err.message : String(err)
        };
      }
    },
    disconnect() {
      client = null;
    }
  };
}

// src/domains/providers/engines/llamacpp.ts
var PROBE_TIMEOUT_MS3 = 3e3;
function createLlamaCppConnection(baseUrl, providerId) {
  return {
    type: "llamacpp",
    baseUrl,
    async connect() {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS3);
      try {
        const response = await fetch(`${baseUrl}/v1/models`, {
          signal: controller.signal
        });
        clearTimeout(timeout);
        return response.ok;
      } catch {
        clearTimeout(timeout);
        return false;
      }
    },
    async listModels() {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS3);
      try {
        const response = await fetch(`${baseUrl}/v1/models`, {
          signal: controller.signal
        });
        clearTimeout(timeout);
        if (!response.ok) return [];
        const body = await response.json();
        if (!Array.isArray(body.data)) return [];
        const models = [];
        for (const entry of body.data) {
          if (typeof entry.id !== "string" || !entry.id.trim()) continue;
          if (/^default$/i.test(entry.id)) continue;
          const capabilities = parseCapabilitiesFromEntry(entry);
          models.push({
            id: entry.id,
            engine: "llamacpp",
            providerId,
            baseUrl,
            capabilities
          });
        }
        return models;
      } catch {
        clearTimeout(timeout);
        return [];
      }
    },
    async getModelCapabilities(modelId) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS3);
      try {
        const response = await fetch(`${baseUrl}/v1/models`, {
          signal: controller.signal
        });
        clearTimeout(timeout);
        if (!response.ok) return emptyCapabilities();
        const body = await response.json();
        if (!Array.isArray(body.data)) return emptyCapabilities();
        const entry = body.data.find((m) => m.id === modelId);
        if (!entry) return emptyCapabilities();
        return parseCapabilitiesFromEntry(entry);
      } catch {
        clearTimeout(timeout);
        return emptyCapabilities();
      }
    },
    async health() {
      const start = Date.now();
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS3);
      try {
        const response = await fetch(`${baseUrl}/v1/models`, {
          signal: controller.signal
        });
        clearTimeout(timeout);
        return {
          reachable: response.ok,
          latencyMs: Date.now() - start,
          error: response.ok ? null : `HTTP ${response.status}`
        };
      } catch (err) {
        clearTimeout(timeout);
        return {
          reachable: false,
          latencyMs: null,
          error: err instanceof Error ? err.message : String(err)
        };
      }
    },
    disconnect() {
    }
  };
}
function parseCapabilitiesFromEntry(entry) {
  const caps = emptyCapabilities();
  const args = entry.status?.args;
  if (!Array.isArray(args)) return caps;
  caps.contextWindow = parseArgValue(args, "--ctx-size", "-c");
  caps.temperature = parseArgFloat(args, "--temperature", "--temp");
  caps.topK = parseArgValue(args, "--top-k");
  caps.topP = parseArgFloat(args, "--top-p");
  return caps;
}
function parseArgValue(args, ...flags) {
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
function parseArgFloat(args, ...flags) {
  for (let i = 0; i < args.length; i++) {
    const value = String(args[i]);
    for (const flag of flags) {
      if (value.startsWith(`${flag}=`)) {
        const parsed = parseFloat(value.split("=", 2)[1] ?? "");
        if (Number.isFinite(parsed)) return parsed;
      }
      if (value === flag && i + 1 < args.length) {
        const parsed = parseFloat(String(args[i + 1]));
        if (Number.isFinite(parsed)) return parsed;
      }
    }
  }
  return null;
}

// src/domains/providers/discovery.ts
var KNOWN_SERVICES = [
  {
    type: "lmstudio",
    name: "LM Studio",
    defaultPort: 1234,
    factory: createLmStudioConnection
  },
  {
    type: "ollama",
    name: "Ollama",
    defaultPort: 11434,
    factory: createOllamaConnection
  },
  {
    type: "llamacpp",
    name: "llama.cpp",
    defaultPort: 8080,
    factory: createLlamaCppConnection
  }
];
function parseLocalMachinesEnv() {
  const raw = process.env.PANCODE_LOCAL_MACHINES?.trim();
  if (!raw) return [];
  const seen = /* @__PURE__ */ new Set();
  const machines = [];
  for (const entry of raw.split(",")) {
    const [namePart, addressPart] = entry.split("=", 2).map((v) => v?.trim() ?? "");
    if (!namePart || !addressPart || seen.has(namePart)) continue;
    seen.add(namePart);
    machines.push({ name: namePart, address: addressPart });
  }
  return machines;
}
function getLocalMachines() {
  const builtin = { name: "localhost", address: "localhost" };
  const additional = parseLocalMachinesEnv().filter((m) => m.name !== builtin.name);
  return [builtin, ...additional];
}
function normalizeProviderFragment(value) {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "local";
}
function buildProviderId(machine, service) {
  const machineName = normalizeProviderFragment(machine.name);
  return machineName === "localhost" ? `local-${service.type}` : `${machineName}-${service.type}`;
}
function buildServiceUrl(address, port) {
  if (address === "localhost" || address === "127.0.0.1") {
    return `http://127.0.0.1:${port}`;
  }
  return `http://${address}:${port}`;
}
async function discoverEngines() {
  const machines = getLocalMachines();
  const results = [];
  const tasks = machines.flatMap(
    (machine) => KNOWN_SERVICES.map(async (service) => {
      const baseUrl = buildServiceUrl(machine.address, service.defaultPort);
      const providerId = buildProviderId(machine, service);
      const connection = service.factory(baseUrl, providerId);
      const reachable = await connection.connect();
      if (!reachable) {
        connection.disconnect();
        return null;
      }
      const models = await connection.listModels();
      if (models.length === 0) {
        connection.disconnect();
        return null;
      }
      return { providerId, engine: service.type, baseUrl, models, connection };
    })
  );
  const settled = await Promise.allSettled(tasks);
  for (const outcome of settled) {
    if (outcome.status === "fulfilled" && outcome.value) {
      results.push(outcome.value);
    }
  }
  return results;
}
function writeProvidersYaml(results, pancodeHome) {
  const providers = results.map((r) => ({
    providerId: r.providerId,
    engine: r.engine,
    baseUrl: r.baseUrl,
    modelCount: r.models.length,
    models: r.models.map((m) => m.id),
    discoveredAt: (/* @__PURE__ */ new Date()).toISOString()
  }));
  const filePath = join(pancodeHome, "providers.yaml");
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, YAML.stringify({ providers }), "utf8");
}

// src/domains/providers/model-matcher.ts
import { readFileSync, readdirSync, writeFileSync as writeFileSync2, mkdirSync as mkdirSync2 } from "fs";
import { join as join2, dirname as dirname2 } from "path";
import YAML2 from "yaml";
function loadModelKnowledgeBase(modelsDir) {
  let files;
  try {
    files = readdirSync(modelsDir).filter((f) => f.endsWith(".yaml") || f.endsWith(".yml"));
  } catch {
    return [];
  }
  const profiles = [];
  for (const file of files) {
    const filePath = join2(modelsDir, file);
    try {
      const content = readFileSync(filePath, "utf8");
      const parsed = YAML2.parse(content);
      if (parsed && parsed.family) profiles.push(parsed);
    } catch (err) {
      console.error(
        `[pancode:models] Failed to load ${file}: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }
  return profiles;
}
function matchModel(discovered, knowledgeBase) {
  const modelIdLower = discovered.id.toLowerCase();
  for (const profile of knowledgeBase) {
    for (const variant of profile.variants ?? []) {
      const variantId = variant.id.toLowerCase();
      if (modelIdLower.includes(variantId)) {
        return mergeProfile(discovered, profile, "variant");
      }
    }
  }
  for (const profile of knowledgeBase) {
    const familyLower = profile.family.toLowerCase().replace(/[.\s]/g, "");
    const normalizedModelId = modelIdLower.replace(/[.\-_\s]/g, "");
    if (normalizedModelId.includes(familyLower)) {
      return mergeProfile(discovered, profile, "family");
    }
  }
  return {
    modelId: discovered.id,
    providerId: discovered.providerId,
    engine: discovered.engine,
    baseUrl: discovered.baseUrl,
    family: discovered.capabilities.family,
    matchType: "unmatched",
    capabilities: { ...discovered.capabilities },
    sampling: null,
    thinkingFormat: discovered.capabilities.thinkingFormat,
    compat: buildCompat(discovered.engine, null)
  };
}
function mergeProfile(discovered, profile, matchType) {
  const caps = discovered.capabilities;
  const merged = {
    contextWindow: caps.contextWindow ?? profile.architecture.context_native ?? null,
    maxOutputTokens: caps.maxOutputTokens,
    temperature: caps.temperature,
    topK: caps.topK,
    topP: caps.topP,
    toolCalling: caps.toolCalling ?? profile.capabilities.tool_calling ?? null,
    reasoning: caps.reasoning ?? profile.capabilities.reasoning ?? null,
    thinkingFormat: caps.thinkingFormat ?? profile.capabilities.thinking_format ?? null,
    vision: caps.vision ?? profile.capabilities.vision ?? null,
    parameterCount: caps.parameterCount,
    quantization: caps.quantization,
    family: profile.family
  };
  return {
    modelId: discovered.id,
    providerId: discovered.providerId,
    engine: discovered.engine,
    baseUrl: discovered.baseUrl,
    family: profile.family,
    matchType,
    capabilities: merged,
    sampling: profile.sampling ?? null,
    thinkingFormat: merged.thinkingFormat,
    compat: buildCompat(discovered.engine, merged.thinkingFormat)
  };
}
function buildCompat(engine, thinkingFormat) {
  return {
    supportsDeveloperRole: false,
    supportsReasoningEffort: false,
    supportsUsageInStreaming: engine !== "llamacpp",
    maxTokensField: "max_tokens",
    thinkingFormat
  };
}
function matchAllModels(discovered, knowledgeBase) {
  return discovered.map((model) => matchModel(model, knowledgeBase));
}
function writeModelCacheYaml(profiles, pancodeHome) {
  const serializable = profiles.map((p) => ({
    modelId: p.modelId,
    providerId: p.providerId,
    engine: p.engine,
    baseUrl: p.baseUrl,
    family: p.family,
    matchType: p.matchType,
    contextWindow: p.capabilities.contextWindow,
    toolCalling: p.capabilities.toolCalling,
    reasoning: p.capabilities.reasoning,
    vision: p.capabilities.vision,
    thinkingFormat: p.thinkingFormat,
    sampling: p.sampling
  }));
  const filePath = join2(pancodeHome, "model-cache.yaml");
  mkdirSync2(dirname2(filePath), { recursive: true });
  writeFileSync2(filePath, YAML2.stringify({ models: serializable }), "utf8");
}
var cachedProfiles = [];
function setModelProfileCache(profiles) {
  cachedProfiles = profiles;
}
function getModelProfileCache() {
  return cachedProfiles;
}
function findModelProfile(providerId, modelId) {
  return cachedProfiles.find(
    (p) => p.providerId === providerId && p.modelId === modelId
  );
}
function getSamplingPreset(providerId, modelId, presetName) {
  const profile = findModelProfile(providerId, modelId);
  return profile?.sampling?.[presetName];
}

// src/domains/providers/registry.ts
function deriveMaxTokens(contextWindow2) {
  const envCap = parseInt(process.env.PANCODE_MAX_OUTPUT_TOKENS ?? "", 10);
  const cap = Number.isFinite(envCap) && envCap > 0 ? envCap : 131072;
  return Math.max(4096, Math.min(Math.floor(contextWindow2 / 2), cap));
}
function registerDiscoveredModels(modelRegistry, profiles) {
  const registered = /* @__PURE__ */ new Set();
  const byProvider = /* @__PURE__ */ new Map();
  for (const profile of profiles) {
    const existing = byProvider.get(profile.providerId) ?? [];
    existing.push(profile);
    byProvider.set(profile.providerId, existing);
  }
  for (const [providerId, providerProfiles] of byProvider.entries()) {
    const firstProfile = providerProfiles[0];
    if (providerProfiles.some((p) => p.baseUrl !== firstProfile.baseUrl)) {
      console.warn(
        `[pancode:providers] Provider "${providerId}" has models with different baseUrls. Using first: ${firstProfile.baseUrl}`
      );
    }
    const baseUrl = `${firstProfile.baseUrl}/v1`;
    modelRegistry.registerProvider(providerId, {
      baseUrl,
      apiKey: "local",
      api: "openai-completions",
      models: providerProfiles.map((profile) => {
        const rawContextWindow = profile.capabilities.contextWindow;
        if (!rawContextWindow && profile.matchType === "unmatched") {
          console.warn(
            `[pancode:providers] Model "${profile.modelId}" has no context window. Defaulting to 8192 tokens. Add a models/ YAML entry to fix this.`
          );
        }
        const contextWindow2 = rawContextWindow ?? 8192;
        const maxTokens = deriveMaxTokens(contextWindow2);
        const reasoning = profile.capabilities.reasoning ?? false;
        const vision = profile.capabilities.vision ?? false;
        return {
          id: profile.modelId,
          name: profile.modelId,
          reasoning,
          input: vision ? ["text", "image"] : ["text"],
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
          contextWindow: contextWindow2,
          maxTokens,
          compat: profile.compat
        };
      })
    });
    registered.add(providerId);
  }
  return [...registered];
}

// src/domains/providers/shared.ts
import { copyFileSync, existsSync, mkdirSync as mkdirSync3 } from "fs";
import { homedir } from "os";
import { join as join3 } from "path";
var PANCODE_HOME = process.env.PANCODE_HOME;
var PANCODE_AGENT_DIR = join3(PANCODE_HOME, "agent-engine");
function copyLegacyFileIfMissing(fileName) {
  const legacyPiDir = join3(homedir(), ".pi", "agent");
  const sourcePath = join3(legacyPiDir, fileName);
  const targetPath = join3(PANCODE_AGENT_DIR, fileName);
  if (existsSync(sourcePath) && !existsSync(targetPath)) {
    copyFileSync(sourcePath, targetPath);
  }
}
async function createSharedAuth() {
  mkdirSync3(PANCODE_AGENT_DIR, { recursive: true });
  copyLegacyFileIfMissing("auth.json");
  copyLegacyFileIfMissing("models.json");
  copyLegacyFileIfMissing("settings.json");
  process.env.PI_CODING_AGENT_DIR = PANCODE_AGENT_DIR;
  const authStorage = AuthStorage.create(join3(PANCODE_AGENT_DIR, "auth.json"));
  const modelRegistry = new ModelRegistry(authStorage, join3(PANCODE_AGENT_DIR, "models.json"));
  return {
    agentDir: PANCODE_AGENT_DIR,
    authStorage,
    modelRegistry
  };
}
var TIER1_HINTS = [/\bopus\b/i, /\bo[3-9]\b/i];
var TIER2_HINTS = [/\b(pro|max|ultra|sonnet|reasoning|large|turbo)\b/i, /\bgpt-(5|4\.1)\b/i, /\bo[1-2]\b/i];
var LOW_CAPABILITY_HINTS = [/\b(flash|haiku|mini|nano|lite|small|fast|economy|instant|quick)\b/i];
var UNSTABLE_HINTS = [/\b(preview|beta|experimental|exp)\b/i];
var PREFERRED_PROVIDERS = ["anthropic", "openai", "openai-responses", "openai-codex"];
function normalizeModelRef(model, provider) {
  if (!model) return void 0;
  if (model.includes("/")) return model;
  return provider ? `${provider}/${model}` : void 0;
}
function modelCapabilityScore(provider, id) {
  const label = `${provider}/${id}`;
  let score = 0;
  if (TIER1_HINTS.some((hint) => hint.test(label))) score = 30;
  else if (TIER2_HINTS.some((hint) => hint.test(label))) score = 20;
  for (const hint of LOW_CAPABILITY_HINTS) {
    if (hint.test(label)) score -= 25;
  }
  for (const hint of UNSTABLE_HINTS) {
    if (hint.test(label)) score -= 6;
  }
  if (PREFERRED_PROVIDERS.includes(provider)) score += 2;
  return score;
}
function modelVersionVector(id) {
  const matches = id.match(/\d+/g);
  if (!matches) return [];
  return matches.map((value) => Number.parseInt(value, 10)).filter((value) => Number.isFinite(value)).slice(0, 6);
}
function compareVersionVectorsDesc(a, b) {
  const maxLength = Math.max(a.length, b.length);
  for (let index = 0; index < maxLength; index += 1) {
    const left = a[index] ?? -1;
    const right = b[index] ?? -1;
    if (left !== right) return right - left;
  }
  return 0;
}
function comparePreferredModels(a, b) {
  const capabilityDiff = modelCapabilityScore(b.provider, b.id) - modelCapabilityScore(a.provider, a.id);
  if (capabilityDiff !== 0) return capabilityDiff;
  const versionDiff = compareVersionVectorsDesc(modelVersionVector(a.id), modelVersionVector(b.id));
  if (versionDiff !== 0) return versionDiff;
  return `${a.provider}/${a.id}`.localeCompare(`${b.provider}/${b.id}`);
}
function selectPreferredModel(available) {
  if (available.length === 0) {
    throw new Error("No authenticated models are available. Authenticate a provider or set an explicit model.");
  }
  return [...available].sort(comparePreferredModels)[0];
}
function resolveModel(modelRegistry, options = {}) {
  const modelRef2 = normalizeModelRef(options.model, options.provider);
  if (modelRef2) {
    const slashIndex = modelRef2.indexOf("/");
    if (slashIndex === -1) {
      throw new Error(`Invalid model "${modelRef2}". Expected "provider/model-id".`);
    }
    const provider = modelRef2.slice(0, slashIndex);
    const modelId = modelRef2.slice(slashIndex + 1);
    const allModels = modelRegistry.getAll();
    const exists = allModels.some((model) => model.provider === provider && model.id === modelId);
    if (!exists) {
      throw new Error(`Model "${modelRef2}" was not found in the registry.`);
    }
    const resolved = modelRegistry.find(provider, modelId);
    if (resolved) return resolved;
    const providerHasAuth = modelRegistry.getAvailable().some((model) => model.provider === provider);
    if (!providerHasAuth) {
      throw new Error(`Model "${modelRef2}" exists but provider "${provider}" has no authentication.`);
    }
    throw new Error(`Model "${modelRef2}" exists but is not currently available.`);
  }
  if (options.provider) {
    const providerModels = modelRegistry.getAvailable().filter((model) => model.provider === options.provider);
    if (providerModels.length > 0) return selectPreferredModel(providerModels);
    const providerExists = modelRegistry.getAll().some((model) => model.provider === options.provider);
    if (!providerExists) {
      throw new Error(`Provider "${options.provider}" is not registered.`);
    }
    throw new Error(`Provider "${options.provider}" has no authenticated models.`);
  }
  return selectPreferredModel(modelRegistry.getAvailable());
}
function resolveConfiguredModel(modelRegistry, options = {}) {
  if (options.provider || options.model) {
    return resolveModel(modelRegistry, {
      provider: options.provider,
      model: options.model
    });
  }
  if (options.preferredProvider || options.preferredModel) {
    try {
      return resolveModel(modelRegistry, {
        provider: options.preferredProvider,
        model: options.preferredModel
      });
    } catch {
    }
  }
  return resolveModel(modelRegistry, {});
}

// src/domains/agents/spec-registry.ts
import { existsSync as existsSync2, readFileSync as readFileSync2, writeFileSync as writeFileSync3, mkdirSync as mkdirSync4 } from "fs";
import { join as join4, dirname as dirname3 } from "path";
import YAML3 from "yaml";
var AgentSpecRegistry = class {
  specs = /* @__PURE__ */ new Map();
  register(spec) {
    this.specs.set(spec.name, spec);
  }
  get(name) {
    return this.specs.get(name);
  }
  getAll() {
    return [...this.specs.values()];
  }
  has(name) {
    return this.specs.has(name);
  }
  names() {
    return [...this.specs.keys()];
  }
  clear() {
    this.specs.clear();
  }
};
var agentRegistry = new AgentSpecRegistry();
var DEFAULT_AGENTS_YAML = `# PanCode Agent Definitions
# Each agent specifies tools, sampling preset, and readonly mode.
# The model field supports \${ENV_VAR} expansion.

agents:
  dev:
    description: "General-purpose coding agent"
    model: \${PANCODE_WORKER_MODEL}
    tools: [read, bash, grep, find, ls, write, edit]
    sampling: coding
    readonly: false
    system_prompt: "You are a skilled software developer. Complete the task efficiently. Use tools to read, understand, and modify code. Be concise in responses."
  reviewer:
    description: "Code review with read-only tools"
    model: \${PANCODE_WORKER_MODEL}
    tools: [read, grep, find, ls]
    sampling: general
    readonly: true
    system_prompt: "You are a code reviewer. Analyze the code for bugs, security issues, and improvements. Do not modify any files. Report findings clearly."
  # PANCODE_SCOUT_MODEL: fast small model for exploration (default: falls back to PANCODE_WORKER_MODEL)
  scout:
    description: "Research and exploration"
    model: \${PANCODE_SCOUT_MODEL}
    tools: [read, grep, find, ls]
    sampling: general
    readonly: true
    system_prompt: "You are a research scout. Explore the codebase to answer questions and gather information. Do not modify any files. Summarize findings concisely."
`;
function expandEnvVars(value) {
  return value.replace(/\$\{([^}]+)\}/g, (_match, varName) => {
    return process.env[varName.trim()] ?? "";
  });
}
function ensureAgentsYaml(pancodeHome) {
  const filePath = join4(pancodeHome, "agents.yaml");
  if (!existsSync2(filePath)) {
    mkdirSync4(dirname3(filePath), { recursive: true });
    writeFileSync3(filePath, DEFAULT_AGENTS_YAML, "utf8");
  }
  return filePath;
}
function loadAgentsFromYaml(pancodeHome) {
  const filePath = ensureAgentsYaml(pancodeHome);
  let content;
  try {
    content = readFileSync2(filePath, "utf8");
  } catch {
    return [];
  }
  let parsed;
  try {
    parsed = YAML3.parse(content);
  } catch {
    console.error(`[pancode:agents] Failed to parse ${filePath}`);
    return [];
  }
  if (!parsed?.agents) return [];
  const specs = [];
  for (const [name, entry] of Object.entries(parsed.agents)) {
    if (!entry) continue;
    const model = entry.model ? expandEnvVars(entry.model) : void 0;
    const tools = Array.isArray(entry.tools) ? entry.tools.join(",") : "read,grep,find,ls";
    specs.push({
      name,
      description: entry.description ?? name,
      tools,
      systemPrompt: entry.system_prompt ?? "",
      model: model && model.length > 0 ? model : void 0,
      sampling: entry.sampling,
      readonly: entry.readonly ?? false
    });
  }
  return specs;
}

// src/domains/agents/extension.ts
var extension = defineExtension((pi) => {
  pi.on("session_start", (_event, _ctx) => {
    const specs = loadAgentsFromYaml(PANCODE_HOME);
    for (const spec of specs) {
      if (!agentRegistry.has(spec.name)) {
        agentRegistry.register(spec);
      }
    }
  });
  pi.registerCommand("agents", {
    description: "List registered PanCode agent specs",
    async handler(_args, _ctx) {
      const specs = agentRegistry.getAll();
      const lines = specs.map((spec) => {
        const readonlyTag = spec.readonly ? " [readonly]" : "";
        const samplingTag = spec.sampling ? ` (sampling: ${spec.sampling})` : "";
        return `- ${spec.name}: ${spec.description}${readonlyTag}${samplingTag} (tools: ${spec.tools})`;
      });
      pi.sendMessage({
        customType: "pancode-panel",
        content: lines.length > 0 ? lines.join("\n") : "No agents registered.",
        display: true,
        details: { title: "PanCode Agents" }
      });
    }
  });
});

// src/domains/agents/manifest.ts
var manifest = {
  name: "agents",
  dependsOn: []
};

// src/domains/dispatch/extension.ts
import { Type } from "@sinclair/typebox";

// src/core/shared-bus.ts
var sharedBus = createSafeEventBus();

// src/domains/dispatch/state.ts
import { existsSync as existsSync3, mkdirSync as mkdirSync5, readFileSync as readFileSync3, writeFileSync as writeFileSync4 } from "fs";
import { dirname as dirname4, join as join5 } from "path";
import { randomUUID } from "crypto";
function createRunEnvelope(task, agent, cwd, batchId) {
  return {
    id: randomUUID().slice(0, 8),
    task,
    agent,
    model: null,
    status: "pending",
    result: "",
    error: "",
    usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, cost: 0, turns: 0 },
    startedAt: (/* @__PURE__ */ new Date()).toISOString(),
    completedAt: null,
    batchId: batchId ?? null,
    cwd
  };
}
var RunLedger = class {
  runs = [];
  persistPath;
  constructor(runtimeRoot) {
    this.persistPath = join5(runtimeRoot, "runs.json");
    this.load();
  }
  load() {
    if (!existsSync3(this.persistPath)) return;
    try {
      const raw = readFileSync3(this.persistPath, "utf8");
      this.runs = JSON.parse(raw);
    } catch {
      this.runs = [];
    }
  }
  persist() {
    const dir = dirname4(this.persistPath);
    try {
      mkdirSync5(dir, { recursive: true });
      writeFileSync4(this.persistPath, JSON.stringify(this.runs, null, 2), "utf8");
    } catch (err) {
      console.error(
        `[pancode:dispatch] Failed to persist run ledger: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }
  add(run) {
    this.runs.push(run);
    this.persist();
  }
  update(id, patch) {
    const run = this.runs.find((r) => r.id === id);
    if (run) {
      Object.assign(run, patch);
      this.persist();
    }
  }
  get(id) {
    return this.runs.find((r) => r.id === id);
  }
  getAll() {
    return [...this.runs];
  }
  getActive() {
    return this.runs.filter((r) => r.status === "running" || r.status === "pending");
  }
  getRecent(count) {
    return this.runs.slice(-count);
  }
  markInterrupted() {
    for (const run of this.runs) {
      if (run.status === "running" || run.status === "pending") {
        run.status = "cancelled";
        run.completedAt = (/* @__PURE__ */ new Date()).toISOString();
      }
    }
    this.persist();
  }
  toJSON() {
    return this.runs;
  }
  fromJSON(data) {
    this.runs = data;
  }
};

// src/domains/dispatch/rules.ts
var DEFAULT_DISPATCH_RULES = [
  {
    name: "empty-task-guard",
    match: (ctx) => {
      if (!ctx.task.trim()) return { action: "stop", reason: "Empty task" };
      return null;
    }
  },
  {
    name: "agent-fallback",
    match: (ctx) => {
      return { action: "dispatch", agent: ctx.agent || "dev", task: ctx.task };
    }
  }
];
function evaluateRules(rules, ctx) {
  for (const rule of rules) {
    const result = rule.match(ctx);
    if (result) return result;
  }
  return { action: "dispatch", agent: ctx.agent || "dev", task: ctx.task };
}

// src/domains/dispatch/routing.ts
function getWorkerModel() {
  return process.env.PANCODE_WORKER_MODEL?.trim() || null;
}
function resolveModelSampling(model, presetName) {
  if (!model || !presetName) return null;
  const slashIndex = model.indexOf("/");
  if (slashIndex === -1) return null;
  const providerId = model.slice(0, slashIndex);
  const modelId = model.slice(slashIndex + 1);
  const sampling = getSamplingPreset(providerId, modelId, presetName) ?? null;
  if (!sampling) {
    const message = `Sampling preset "${presetName}" not found for ${providerId}/${modelId}. Worker will use model defaults.`;
    console.error(`[pancode:routing] ${message}`);
    sharedBus.emit("pancode:warning", { source: "dispatch", message });
  }
  return sampling;
}
function resolveWorkerRouting(agentName) {
  const spec = agentRegistry.get(agentName);
  const workerModel = getWorkerModel();
  if (!spec) {
    return {
      model: workerModel,
      tools: "read,bash,grep,find,ls,write,edit",
      systemPrompt: "",
      sampling: null
    };
  }
  const model = spec.model ?? workerModel;
  const sampling = resolveModelSampling(model, spec.sampling);
  if (model && spec.tools) {
    const slashIdx = model.indexOf("/");
    if (slashIdx !== -1) {
      const profile = findModelProfile(model.slice(0, slashIdx), model.slice(slashIdx + 1));
      if (profile && profile.capabilities.toolCalling === false) {
        const message = `Model ${model} may not support tool calling. Agent "${agentName}" requires tools: ${spec.tools}`;
        console.error(`[pancode:dispatch] ${message}`);
        sharedBus.emit("pancode:warning", { source: "dispatch", message });
      }
    }
  }
  return {
    model,
    tools: spec.tools,
    systemPrompt: spec.systemPrompt,
    sampling
  };
}

// src/domains/dispatch/worker-spawn.ts
import { spawn } from "child_process";
import { existsSync as existsSync4, readFileSync as readFileSync4 } from "fs";
import { join as join6 } from "path";
import { randomUUID as randomUUID2 } from "crypto";
var liveWorkerProcesses = /* @__PURE__ */ new Set();
async function stopAllWorkers() {
  const active = Array.from(liveWorkerProcesses);
  if (active.length === 0) return;
  for (const proc of active) {
    try {
      proc.kill("SIGTERM");
    } catch {
    }
  }
  await Promise.all(
    active.map(
      (proc) => new Promise((resolve) => {
        const timer = setTimeout(resolve, 3e3);
        proc.once("exit", () => {
          clearTimeout(timer);
          resolve();
        });
      })
    )
  );
  for (const proc of active) {
    if (proc.exitCode === null) {
      try {
        proc.kill("SIGKILL");
      } catch {
      }
    }
  }
  liveWorkerProcesses.clear();
}
function resolveWorkerEntryPath() {
  const packageRoot = process.env.PANCODE_PACKAGE_ROOT ?? process.cwd();
  const distPath = join6(packageRoot, "dist", "worker", "entry.js");
  if (existsSync4(distPath)) return distPath;
  return join6(packageRoot, "src", "worker", "entry.ts");
}
function emptyUsage() {
  return { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, cost: 0, turns: 0 };
}
function spawnWorker(options) {
  const entryPath = resolveWorkerEntryPath();
  const runtimeRoot = process.env.PANCODE_RUNTIME_ROOT ?? join6(process.env.PANCODE_PACKAGE_ROOT ?? process.cwd(), ".pancode", "runtime");
  const runId = randomUUID2().slice(0, 8);
  const resultFile = join6(runtimeRoot, `worker-${runId}.result.json`);
  const isDev = entryPath.endsWith(".ts");
  const workerArgs = [
    "--prompt",
    `Task: ${options.task}`,
    "--result-file",
    resultFile,
    "--tools",
    options.tools
  ];
  const args = isDev ? ["--import", "tsx", entryPath, ...workerArgs] : [entryPath, ...workerArgs];
  if (options.model) {
    args.push("--model", options.model);
  }
  if (options.systemPrompt.trim()) {
    args.push("--system-prompt", options.systemPrompt);
  }
  const pancodeHome = process.env.PANCODE_HOME;
  const agentDir = join6(pancodeHome, "agent-engine");
  const samplingEnv = {};
  if (options.sampling) {
    samplingEnv.PANCODE_SAMPLING_TEMPERATURE = String(options.sampling.temperature);
    samplingEnv.PANCODE_SAMPLING_TOP_P = String(options.sampling.top_p);
    samplingEnv.PANCODE_SAMPLING_TOP_K = String(options.sampling.top_k);
    samplingEnv.PANCODE_SAMPLING_PRESENCE_PENALTY = String(options.sampling.presence_penalty);
  }
  return new Promise((resolve) => {
    const proc = spawn(process.execPath, args, {
      cwd: options.cwd,
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        ...samplingEnv,
        PANCODE_PARENT_PID: String(process.pid),
        PANCODE_SAFETY: process.env.PANCODE_SAFETY ?? "auto-edit",
        PANCODE_BOARD_FILE: join6(runtimeRoot, "board.json"),
        PANCODE_CONTEXT_FILE: join6(runtimeRoot, "context.json"),
        PANCODE_AGENT_NAME: options.agentName ?? "worker",
        PI_CODING_AGENT_DIR: process.env.PI_CODING_AGENT_DIR ?? agentDir,
        PI_SKIP_VERSION_CHECK: "1"
      }
    });
    liveWorkerProcesses.add(proc);
    const result = {
      exitCode: 0,
      result: "",
      error: "",
      usage: emptyUsage(),
      model: null
    };
    let buffer = "";
    let stderr = "";
    const processLine = (line) => {
      const trimmed = line.trim();
      if (!trimmed || trimmed[0] !== "{" && trimmed[0] !== "[") return;
      let event;
      try {
        event = JSON.parse(trimmed);
      } catch {
        return;
      }
      if (event.type !== "message_end" || !event.message) return;
      const msg = event.message;
      if (msg.role === "assistant") {
        if (Array.isArray(msg.content)) {
          const textParts = msg.content.filter((part) => part?.type === "text" && typeof part.text === "string").map((part) => part.text);
          if (textParts.length > 0) {
            result.result = textParts.join("");
          }
        }
        result.usage.turns++;
        const usage = msg.usage;
        if (usage) {
          result.usage.inputTokens += usage.input ?? 0;
          result.usage.outputTokens += usage.output ?? 0;
          result.usage.cacheReadTokens += usage.cacheRead ?? 0;
          result.usage.cacheWriteTokens += usage.cacheWrite ?? 0;
          result.usage.cost += usage.cost?.total ?? 0;
        }
        if (options.runId) {
          sharedBus.emit("pancode:worker-progress", {
            runId: options.runId,
            inputTokens: result.usage.inputTokens,
            outputTokens: result.usage.outputTokens,
            turns: result.usage.turns
          });
        }
        if (!result.model && msg.model) {
          result.model = msg.model;
        }
        if (msg.stopReason === "error" && typeof msg.errorMessage === "string") {
          result.error = msg.errorMessage;
        }
      }
    };
    proc.stdout.on("data", (data) => {
      buffer += data.toString();
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";
      for (const line of lines) processLine(line);
    });
    proc.stderr.on("data", (data) => {
      stderr += data.toString();
    });
    proc.on("close", (code) => {
      liveWorkerProcesses.delete(proc);
      if (buffer.trim()) processLine(buffer);
      result.exitCode = code ?? 0;
      if (existsSync4(resultFile)) {
        try {
          const resultData = JSON.parse(readFileSync4(resultFile, "utf8"));
          if (typeof resultData.assistantText === "string" && resultData.assistantText) {
            result.result = resultData.assistantText;
          }
          if (typeof resultData.assistantError === "string" && resultData.assistantError) {
            result.error = resultData.assistantError;
          }
        } catch {
        }
      }
      if (result.exitCode !== 0 && !result.error) {
        result.error = stderr.trim() ? `Worker exited with code ${result.exitCode}: ${stderr.trim().slice(0, 500)}` : `Worker exited with code ${result.exitCode}`;
      }
      resolve(result);
    });
    proc.on("error", (err) => {
      liveWorkerProcesses.delete(proc);
      result.exitCode = 1;
      result.error = err.message;
      resolve(result);
    });
    if (options.signal) {
      const killProc = () => {
        proc.kill("SIGTERM");
        setTimeout(() => {
          if (!proc.killed) proc.kill("SIGKILL");
        }, 5e3);
      };
      if (options.signal.aborted) killProc();
      else options.signal.addEventListener("abort", killProc, { once: true });
    }
  });
}

// src/domains/dispatch/primitives.ts
var DEFAULT_CONCURRENCY = 4;
async function runParallel(tasks, concurrency = DEFAULT_CONCURRENCY, signal) {
  const results = [];
  const queue = [...tasks];
  const active = [];
  const runNext = async () => {
    while (queue.length > 0) {
      if (signal?.aborted) break;
      const task = queue.shift();
      const workerResult = await spawnWorker({
        task: task.task,
        tools: task.tools,
        model: task.model,
        systemPrompt: task.systemPrompt,
        cwd: task.cwd,
        sampling: task.sampling,
        signal,
        runId: task.runId
      });
      results.push({ task: task.task, result: workerResult });
    }
  };
  const effectiveConcurrency = Math.min(concurrency, tasks.length);
  for (let i = 0; i < effectiveConcurrency; i++) {
    active.push(runNext());
  }
  await Promise.all(active);
  return results;
}

// src/domains/dispatch/batch-tracker.ts
import { randomUUID as randomUUID3 } from "crypto";
var BatchTracker = class {
  batches = /* @__PURE__ */ new Map();
  create(taskCount) {
    const batch = {
      id: randomUUID3().slice(0, 8),
      taskCount,
      completedCount: 0,
      failedCount: 0,
      runIds: [],
      startedAt: (/* @__PURE__ */ new Date()).toISOString(),
      completedAt: null
    };
    this.batches.set(batch.id, batch);
    return batch;
  }
  addRun(batchId, runId) {
    const batch = this.batches.get(batchId);
    if (batch) batch.runIds.push(runId);
  }
  markCompleted(batchId, success) {
    const batch = this.batches.get(batchId);
    if (!batch) return;
    if (success) batch.completedCount++;
    else batch.failedCount++;
    if (batch.completedCount + batch.failedCount >= batch.taskCount) {
      batch.completedAt = (/* @__PURE__ */ new Date()).toISOString();
    }
  }
  get(batchId) {
    return this.batches.get(batchId);
  }
  getAll() {
    return [...this.batches.values()];
  }
  getRecent(count) {
    return [...this.batches.values()].slice(-count);
  }
};
var batchTracker = new BatchTracker();

// src/domains/dispatch/isolation.ts
import { execFile as execFileCb } from "child_process";
import { mkdirSync as mkdirSync6, readFileSync as readFileSync5, rmSync, statSync, writeFileSync as writeFileSync5, unlinkSync } from "fs";
import { dirname as dirname5, join as join7 } from "path";
import { tmpdir } from "os";
import { promisify } from "util";
var execFile = promisify(execFileCb);
async function git(args, cwd) {
  const { stdout } = await execFile("git", args, { cwd, maxBuffer: 50 * 1024 * 1024 });
  return stdout;
}
async function gitSilent(args, cwd) {
  try {
    return await git(args, cwd);
  } catch {
    return "";
  }
}
async function captureBaseline(repoRoot) {
  const stagedDiff = await gitSilent(["diff", "--cached", "--binary"], repoRoot);
  const unstagedDiff = await gitSilent(["diff", "--binary"], repoRoot);
  const untrackedOutput = await gitSilent(
    ["ls-files", "--others", "--exclude-standard", "-z"],
    repoRoot
  );
  const untrackedPaths = untrackedOutput.split("\0").filter((p) => p.length > 0);
  const untrackedFiles = [];
  for (const relativePath of untrackedPaths) {
    const fullPath = join7(repoRoot, relativePath);
    try {
      const stat = statSync(fullPath);
      if (stat.isFile() && stat.size < 10 * 1024 * 1024) {
        untrackedFiles.push({ relativePath, content: readFileSync5(fullPath) });
      }
    } catch {
    }
  }
  return { stagedDiff, unstagedDiff, untrackedFiles };
}
async function applyBaseline(worktreeDir, baseline) {
  if (baseline.stagedDiff.trim()) {
    const patchPath = join7(worktreeDir, ".pancode-staged.patch");
    writeFileSync5(patchPath, baseline.stagedDiff);
    try {
      await git(["apply", "--binary", patchPath], worktreeDir);
      await git(["add", "-A"], worktreeDir);
    } catch (err) {
      console.warn(
        `[pancode:dispatch] Staged baseline apply failed for worktree (worker may start with partial state): ${err instanceof Error ? err.message : String(err)}`
      );
    } finally {
      unlinkSync(patchPath);
    }
  }
  if (baseline.unstagedDiff.trim()) {
    const patchPath = join7(worktreeDir, ".pancode-unstaged.patch");
    writeFileSync5(patchPath, baseline.unstagedDiff);
    try {
      await git(["apply", "--binary", patchPath], worktreeDir);
    } catch (err) {
      console.warn(
        `[pancode:dispatch] Unstaged baseline apply failed for worktree (worker may start with partial state): ${err instanceof Error ? err.message : String(err)}`
      );
    } finally {
      unlinkSync(patchPath);
    }
  }
  for (const file of baseline.untrackedFiles) {
    const dest = join7(worktreeDir, file.relativePath);
    mkdirSync6(dirname5(dest), { recursive: true });
    writeFileSync5(dest, file.content);
  }
  await gitSilent(["add", "-A"], worktreeDir);
  await gitSilent(["commit", "--allow-empty", "-m", "pancode: baseline snapshot"], worktreeDir);
}
var activeWorktrees = /* @__PURE__ */ new Set();
async function createWorktreeIsolation(repoRoot, taskId) {
  const worktreeDir = join7(repoRoot, ".pancode", "worktrees", taskId);
  mkdirSync6(dirname5(worktreeDir), { recursive: true });
  try {
    await git(["worktree", "remove", "--force", worktreeDir], repoRoot);
  } catch {
  }
  rmSync(worktreeDir, { recursive: true, force: true });
  await git(["worktree", "add", "--detach", worktreeDir, "HEAD"], repoRoot);
  const baseline = await captureBaseline(repoRoot);
  await applyBaseline(worktreeDir, baseline);
  activeWorktrees.add(worktreeDir);
  return {
    workDir: worktreeDir,
    async captureDelta() {
      const patches = [];
      await gitSilent(["add", "-A"], worktreeDir);
      const diff = await gitSilent(["diff", "--cached", "--binary", "HEAD"], worktreeDir);
      if (diff.trim()) {
        patches.push({ path: join7(worktreeDir, "delta.patch"), content: diff });
      }
      return patches;
    },
    async cleanup() {
      activeWorktrees.delete(worktreeDir);
      try {
        await Promise.race([
          git(["worktree", "remove", "--force", worktreeDir], repoRoot),
          new Promise(
            (_, reject) => setTimeout(() => reject(new Error("Worktree cleanup timed out")), 1e4)
          )
        ]);
      } catch {
        rmSync(worktreeDir, { recursive: true, force: true });
      }
    }
  };
}
async function mergeDeltaPatches(repoRoot, patches) {
  if (patches.length === 0) {
    return { success: true, appliedPatches: [], failedPatches: [] };
  }
  const combined = patches.map((p) => p.content).join("\n");
  const patchFile = join7(tmpdir(), `pancode-merge-${Date.now()}.patch`);
  const appliedPatches = [];
  const failedPatches = [];
  try {
    writeFileSync5(patchFile, combined);
    try {
      await git(["apply", "--check", "--binary", patchFile], repoRoot);
    } catch (err) {
      for (const p of patches) failedPatches.push(p.path);
      return {
        success: false,
        appliedPatches,
        failedPatches,
        error: `Patch conflict: ${err instanceof Error ? err.message : String(err)}`
      };
    }
    await git(["apply", "--binary", patchFile], repoRoot);
    for (const p of patches) appliedPatches.push(p.path);
    return { success: true, appliedPatches, failedPatches };
  } finally {
    try {
      unlinkSync(patchFile);
    } catch {
    }
  }
}
async function cleanupAllWorktrees() {
  for (const dir of activeWorktrees) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
    }
  }
  activeWorktrees.clear();
}

// src/domains/dispatch/admission.ts
var checks = /* @__PURE__ */ new Map();
function registerPreFlightCheck(name, fn) {
  checks.set(name, fn);
}
function runPreFlightChecks(context) {
  for (const [name, check] of checks) {
    const result = check(context);
    if (!result.admit) {
      return { admit: false, reason: `[${name}] ${result.reason ?? "check failed with no reason"}` };
    }
  }
  return { admit: true };
}

// src/domains/dispatch/extension.ts
function textResult(text) {
  return { content: [{ type: "text", text }], details: void 0 };
}
var ledger = null;
var dispatchRules = [...DEFAULT_DISPATCH_RULES];
var draining = false;
function getRunLedger() {
  return ledger;
}
var extension2 = defineExtension((pi) => {
  pi.on("session_start", (_event, ctx) => {
    const packageRoot = process.env.PANCODE_PACKAGE_ROOT;
    if (!packageRoot) {
      console.error("[pancode:dispatch] PANCODE_PACKAGE_ROOT is not set. Domain state will not persist.");
    }
    const runtimeRoot = packageRoot ? `${packageRoot}/.pancode` : ".pancode";
    ledger = new RunLedger(runtimeRoot);
    draining = false;
    shutdownCoordinator.onDrain(() => {
      draining = true;
      sharedBus.emit("pancode:shutdown-draining", {});
    });
  });
  pi.on("session_shutdown", async () => {
    await stopAllWorkers();
    await cleanupAllWorktrees();
    if (ledger) {
      ledger.markInterrupted();
    }
  });
  pi.registerTool({
    name: "dispatch_agent",
    label: "Dispatch Agent",
    description: "Delegate a task to a specialized PanCode worker agent. The worker runs as a separate subprocess with its own context window. Use this to parallelize work or delegate to specialized agents (dev, reviewer, scout).",
    parameters: Type.Object({
      task: Type.String({ description: "The task description to send to the worker agent" }),
      agent: Type.Optional(Type.String({ description: "Agent spec name (default: dev)", default: "dev" })),
      isolate: Type.Optional(Type.Boolean({ description: "Run in a git worktree for filesystem isolation", default: false }))
    }),
    async execute(_toolCallId, params, signal, onUpdate, ctx) {
      const defaultAgent = process.env.PANCODE_DEFAULT_AGENT ?? "dev";
      const agentName = params.agent || defaultAgent;
      const task = params.task;
      const isolate = params.isolate ?? false;
      if (draining) {
        return textResult("Dispatch blocked: system is shutting down.");
      }
      if (!task?.trim()) {
        return textResult("Error: empty task");
      }
      const preflight = runPreFlightChecks({ task, agent: agentName, model: resolveWorkerRouting(agentName).model });
      if (!preflight.admit) {
        return textResult(`Dispatch blocked: ${preflight.reason}`);
      }
      if (!agentRegistry.has(agentName)) {
        const available = agentRegistry.names().join(", ");
        return textResult(`Unknown agent "${agentName}". Available: ${available}`);
      }
      const dispatchAction = evaluateRules(dispatchRules, { task, agent: agentName, cwd: ctx.cwd });
      if (dispatchAction.action === "stop") {
        return textResult(`Dispatch blocked: ${dispatchAction.reason}`);
      }
      if (dispatchAction.action === "skip") {
        return textResult(`Task skipped by dispatch rules: ${dispatchAction.reason ?? "no reason provided"}`);
      }
      const routing = resolveWorkerRouting(dispatchAction.agent);
      const run = createRunEnvelope(task, dispatchAction.agent, ctx.cwd);
      run.model = routing.model;
      run.status = "running";
      ledger?.add(run);
      sharedBus.emit("pancode:run-started", { runId: run.id, task, agent: dispatchAction.agent, model: routing.model });
      const isolateLabel = isolate ? " (isolated)" : "";
      if (onUpdate) {
        onUpdate(textResult(`Dispatching to ${dispatchAction.agent} worker${isolateLabel}...`));
      }
      let workerCwd = ctx.cwd;
      let isolation = null;
      if (isolate) {
        try {
          isolation = await createWorktreeIsolation(ctx.cwd, run.id);
          workerCwd = isolation.workDir;
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          run.status = "error";
          run.error = `Worktree creation failed: ${msg}`;
          run.completedAt = (/* @__PURE__ */ new Date()).toISOString();
          ledger?.update(run.id, run);
          return textResult(`Isolation failed: ${msg}`);
        }
      }
      const workerResult = await spawnWorker({
        task: dispatchAction.task,
        tools: routing.tools,
        model: routing.model,
        systemPrompt: routing.systemPrompt,
        cwd: workerCwd,
        sampling: routing.sampling,
        signal: signal ?? void 0,
        runId: run.id
      });
      if (isolation) {
        try {
          const patches = await isolation.captureDelta();
          if (patches.length > 0) {
            const mergeResult = await mergeDeltaPatches(ctx.cwd, patches);
            if (!mergeResult.success) {
              workerResult.error = (workerResult.error ? workerResult.error + "; " : "") + `Delta merge failed: ${mergeResult.error}`;
            }
          }
        } catch (err) {
          workerResult.error = (workerResult.error ? workerResult.error + "; " : "") + `Delta capture failed: ${err instanceof Error ? err.message : String(err)}`;
        } finally {
          await isolation.cleanup();
        }
      }
      run.status = workerResult.exitCode === 0 && !workerResult.error ? "done" : "error";
      run.result = workerResult.result;
      run.error = workerResult.error;
      run.usage = workerResult.usage;
      run.model = workerResult.model ?? run.model;
      run.completedAt = (/* @__PURE__ */ new Date()).toISOString();
      ledger?.update(run.id, run);
      sharedBus.emit("pancode:run-finished", {
        runId: run.id,
        agent: run.agent,
        status: run.status,
        usage: run.usage,
        startedAt: run.startedAt,
        completedAt: run.completedAt ?? (/* @__PURE__ */ new Date()).toISOString()
      });
      const usageStr = workerResult.usage.cost > 0 ? ` | cost: $${workerResult.usage.cost.toFixed(4)} | turns: ${workerResult.usage.turns}` : ` | turns: ${workerResult.usage.turns}`;
      const statusEmoji = run.status === "done" ? "completed" : "failed";
      const summary = `Worker ${statusEmoji} (${run.id})${usageStr}

Agent: ${run.agent}${run.model ? ` | Model: ${run.model}` : ""}`;
      if (run.status === "error") {
        return textResult(`${summary}

Error: ${run.error}`);
      }
      return textResult(`${summary}

Result:
${run.result}`);
    }
  });
  pi.registerTool({
    name: "batch_dispatch",
    label: "Batch Dispatch",
    description: "Dispatch multiple tasks in parallel to worker agents. Each task runs as a separate subprocess. Up to 4 workers run concurrently by default.",
    parameters: Type.Object({
      tasks: Type.Array(Type.String({ description: "Task descriptions" }), { description: "Array of task descriptions", minItems: 1, maxItems: 8 }),
      agent: Type.Optional(Type.String({ description: "Agent spec name for all tasks (default: dev)", default: "dev" })),
      concurrency: Type.Optional(Type.Number({ description: "Max parallel workers (default: 4)", default: 4, minimum: 1, maximum: 8 }))
    }),
    async execute(_toolCallId, params, signal, onUpdate, ctx) {
      const agentName = params.agent || "dev";
      const concurrency = params.concurrency || 4;
      const tasks = params.tasks;
      if (draining) {
        return textResult("Batch dispatch blocked: system is shutting down.");
      }
      const batchPreflight = runPreFlightChecks({ task: tasks[0], agent: agentName, model: resolveWorkerRouting(agentName).model });
      if (!batchPreflight.admit) {
        return textResult(`Batch dispatch blocked: ${batchPreflight.reason}`);
      }
      if (!agentRegistry.has(agentName)) {
        const available = agentRegistry.names().join(", ");
        return textResult(`Unknown agent "${agentName}". Available: ${available}`);
      }
      const routing = resolveWorkerRouting(agentName);
      const batch = batchTracker.create(tasks.length);
      const runs = tasks.map((task) => {
        const run = createRunEnvelope(task, agentName, ctx.cwd, batch.id);
        run.model = routing.model;
        run.status = "running";
        ledger?.add(run);
        batchTracker.addRun(batch.id, run.id);
        sharedBus.emit("pancode:run-started", { runId: run.id, task, agent: agentName, model: routing.model });
        return run;
      });
      if (onUpdate) {
        onUpdate(textResult(`Dispatching batch of ${tasks.length} tasks to ${agentName} workers (concurrency: ${concurrency})...`));
      }
      const parallelTasks = tasks.map((task, i) => ({
        task,
        tools: routing.tools,
        model: routing.model,
        systemPrompt: routing.systemPrompt,
        cwd: ctx.cwd,
        sampling: routing.sampling,
        runId: runs[i].id
      }));
      const results = await runParallel(parallelTasks, concurrency, signal ?? void 0);
      const summaryLines = [`Batch ${batch.id}: ${tasks.length} tasks`, ""];
      let totalCost = 0;
      for (let i = 0; i < results.length; i++) {
        const { result: workerResult } = results[i];
        const run = runs[i];
        run.status = workerResult.exitCode === 0 && !workerResult.error ? "done" : "error";
        run.result = workerResult.result;
        run.error = workerResult.error;
        run.usage = workerResult.usage;
        run.model = workerResult.model ?? run.model;
        run.completedAt = (/* @__PURE__ */ new Date()).toISOString();
        ledger?.update(run.id, run);
        batchTracker.markCompleted(batch.id, run.status === "done");
        totalCost += workerResult.usage.cost;
        sharedBus.emit("pancode:run-finished", {
          runId: run.id,
          agent: run.agent,
          status: run.status,
          usage: run.usage,
          startedAt: run.startedAt,
          completedAt: run.completedAt
        });
        const statusStr = run.status === "done" ? "OK" : "FAIL";
        const costStr = workerResult.usage.cost > 0 ? ` $${workerResult.usage.cost.toFixed(4)}` : "";
        const truncatedTask = run.task.length > 50 ? `${run.task.slice(0, 47)}...` : run.task;
        summaryLines.push(`  [${run.id}] ${statusStr} ${run.agent} ${truncatedTask}${costStr}`);
        if (run.status === "error" && run.error) {
          const errorText = run.error.length > 500 ? `${run.error.slice(0, 500)}...` : run.error;
          summaryLines.push(`    Error: ${errorText}`);
        } else if (run.result) {
          const resultText = run.result.length > 500 ? `${run.result.slice(0, 500)}...` : run.result;
          summaryLines.push(`    Result: ${resultText}`);
        }
      }
      const batchState = batchTracker.get(batch.id);
      summaryLines.push("");
      summaryLines.push(`Completed: ${batchState?.completedCount ?? 0}/${tasks.length} | Failed: ${batchState?.failedCount ?? 0} | Cost: $${totalCost.toFixed(4)}`);
      return textResult(summaryLines.join("\n"));
    }
  });
  pi.registerCommand("runs", {
    description: "Show dispatch run history",
    async handler(args, _ctx) {
      if (!ledger) {
        pi.sendMessage({
          customType: "pancode-panel",
          content: "Dispatch ledger not initialized.",
          display: true,
          details: { title: "PanCode Runs" }
        });
        return;
      }
      const count = parseInt(args.trim(), 10) || 10;
      const runs = ledger.getRecent(count);
      const active = ledger.getActive();
      const lines = [];
      if (active.length > 0) {
        lines.push(`Active: ${active.length}`);
        lines.push("");
      }
      if (runs.length === 0) {
        lines.push("No runs recorded.");
      } else {
        for (const run of runs) {
          const costStr = run.usage.cost > 0 ? ` $${run.usage.cost.toFixed(4)}` : "";
          const truncatedTask = run.task.length > 60 ? `${run.task.slice(0, 57)}...` : run.task;
          lines.push(`[${run.id}] ${run.status.padEnd(9)} ${run.agent.padEnd(10)} ${truncatedTask}${costStr}`);
        }
      }
      pi.sendMessage({
        customType: "pancode-panel",
        content: lines.join("\n"),
        display: true,
        details: { title: `PanCode Runs (last ${count})` }
      });
    }
  });
  pi.registerCommand("batches", {
    description: "Show batch dispatch history",
    async handler(_args, _ctx) {
      const batches = batchTracker.getRecent(10);
      if (batches.length === 0) {
        pi.sendMessage({
          customType: "pancode-panel",
          content: "No batches recorded.",
          display: true,
          details: { title: "PanCode Batches" }
        });
        return;
      }
      const lines = [];
      for (const batch of batches) {
        const statusStr = batch.completedAt ? "done" : "running";
        lines.push(`[${batch.id}] ${statusStr} ${batch.completedCount}/${batch.taskCount} ok, ${batch.failedCount} failed`);
      }
      pi.sendMessage({
        customType: "pancode-panel",
        content: lines.join("\n"),
        display: true,
        details: { title: "PanCode Batches" }
      });
    }
  });
});

// src/domains/dispatch/manifest.ts
var manifest2 = {
  name: "dispatch",
  dependsOn: ["safety", "agents"]
};

// src/domains/observability/metrics.ts
import { existsSync as existsSync6, mkdirSync as mkdirSync7, readFileSync as readFileSync6, writeFileSync as writeFileSync6 } from "fs";
import { dirname as dirname6, join as join8 } from "path";
var MetricsLedger = class {
  metrics = [];
  persistPath;
  constructor(runtimeRoot) {
    this.persistPath = join8(runtimeRoot, "metrics.json");
    this.load();
  }
  load() {
    if (!existsSync6(this.persistPath)) return;
    try {
      const raw = readFileSync6(this.persistPath, "utf8");
      this.metrics = JSON.parse(raw);
    } catch {
      this.metrics = [];
    }
  }
  persist() {
    const dir = dirname6(this.persistPath);
    mkdirSync7(dir, { recursive: true });
    writeFileSync6(this.persistPath, JSON.stringify(this.metrics, null, 2), "utf8");
  }
  record(metric) {
    this.metrics.push(metric);
    this.persist();
  }
  getSummary() {
    let totalCost = 0;
    let totalInputTokens = 0;
    let totalOutputTokens = 0;
    for (const m of this.metrics) {
      totalCost += m.cost;
      totalInputTokens += m.inputTokens;
      totalOutputTokens += m.outputTokens;
    }
    return {
      totalRuns: this.metrics.length,
      totalCost,
      totalInputTokens,
      totalOutputTokens,
      runs: [...this.metrics]
    };
  }
  getRecent(count) {
    return this.metrics.slice(-count);
  }
  serialize() {
    return [...this.metrics];
  }
  deserialize(data) {
    this.metrics = data;
  }
};

// src/domains/observability/extension.ts
var metricsLedger = null;
function getMetricsLedger() {
  return metricsLedger;
}
var extension3 = defineExtension((pi) => {
  pi.on("session_start", (_event, _ctx) => {
    const packageRoot = process.env.PANCODE_PACKAGE_ROOT;
    if (!packageRoot) {
      console.error("[pancode:observability] PANCODE_PACKAGE_ROOT is not set. Domain state will not persist.");
    }
    const runtimeRoot = packageRoot ? `${packageRoot}/.pancode` : ".pancode";
    metricsLedger = new MetricsLedger(runtimeRoot);
    sharedBus.on("pancode:run-finished", (payload) => {
      const event = payload;
      const durationMs = new Date(event.completedAt).getTime() - new Date(event.startedAt).getTime();
      const metric = {
        runId: event.runId,
        agent: event.agent,
        status: event.status,
        inputTokens: event.usage.inputTokens,
        outputTokens: event.usage.outputTokens,
        cacheReadTokens: event.usage.cacheReadTokens,
        cacheWriteTokens: event.usage.cacheWriteTokens,
        cost: event.usage.cost,
        turns: event.usage.turns,
        durationMs: Math.max(0, durationMs),
        timestamp: event.completedAt
      };
      metricsLedger?.record(metric);
    });
  });
  pi.registerCommand("metrics", {
    description: "Show PanCode dispatch metrics",
    async handler(args, _ctx) {
      if (!metricsLedger) {
        pi.sendMessage({
          customType: "pancode-panel",
          content: "Metrics ledger not initialized.",
          display: true,
          details: { title: "PanCode Metrics" }
        });
        return;
      }
      const summary = metricsLedger.getSummary();
      const recent = metricsLedger.getRecent(parseInt(args.trim(), 10) || 10);
      const lines = [
        `Total runs: ${summary.totalRuns}`,
        `Total cost: $${summary.totalCost.toFixed(4)}`,
        `Total input tokens: ${summary.totalInputTokens}`,
        `Total output tokens: ${summary.totalOutputTokens}`,
        ""
      ];
      if (recent.length > 0) {
        lines.push("Recent:");
        for (const m of recent) {
          const costStr = m.cost > 0 ? ` $${m.cost.toFixed(4)}` : "";
          const durationStr = m.durationMs > 0 ? ` ${(m.durationMs / 1e3).toFixed(1)}s` : "";
          lines.push(`  [${m.runId}] ${m.status} ${m.agent}${costStr}${durationStr}`);
        }
      } else {
        lines.push("No metrics recorded yet.");
      }
      pi.sendMessage({
        customType: "pancode-panel",
        content: lines.join("\n"),
        display: true,
        details: { title: "PanCode Metrics" }
      });
    }
  });
});

// src/domains/observability/manifest.ts
var manifest3 = {
  name: "observability",
  dependsOn: ["dispatch"]
};

// src/domains/intelligence/rules-upgrade.ts
var RulesUpgrade = class {
  outcomes = [];
  enabled = false;
  recordOutcome(outcome) {
    this.outcomes.push(outcome);
  }
  suggest(_intent) {
    if (!this.enabled || this.outcomes.length < 10) return null;
    return null;
  }
  enable() {
    this.enabled = true;
  }
  disable() {
    this.enabled = false;
  }
  getOutcomeCount() {
    return this.outcomes.length;
  }
};
var rulesUpgrade = new RulesUpgrade();

// src/domains/intelligence/extension.ts
var extension4 = defineExtension((pi) => {
  if (process.env.PANCODE_INTELLIGENCE !== "enabled") return;
  pi.on("session_start", (_event, _ctx) => {
    rulesUpgrade.enable();
  });
  pi.on("tool_execution_end", (event, _ctx) => {
    if (event.toolName !== "dispatch_agent" && event.toolName !== "batch_dispatch") return;
  });
});

// src/domains/intelligence/manifest.ts
var manifest4 = {
  name: "intelligence",
  dependsOn: ["dispatch", "agents"]
};

// src/domains/safety/scope.ts
var DEFAULT_MODE_POLICIES = {
  suggest: {
    file_read: "allow",
    file_write: "block",
    file_delete: "block",
    bash_exec: "block",
    bash_destructive: "block",
    git_push: "block",
    git_destructive: "block",
    network: "allow",
    agent_dispatch: "block",
    system_modify: "block"
  },
  "auto-edit": {
    file_read: "allow",
    file_write: "allow",
    file_delete: "block",
    bash_exec: "allow",
    bash_destructive: "block",
    git_push: "block",
    git_destructive: "block",
    network: "allow",
    agent_dispatch: "allow",
    system_modify: "block"
  },
  "full-auto": {
    file_read: "allow",
    file_write: "allow",
    file_delete: "allow",
    bash_exec: "allow",
    bash_destructive: "allow",
    git_push: "allow",
    git_destructive: "block",
    network: "allow",
    agent_dispatch: "allow",
    system_modify: "block"
  }
};
function lookupTier(mode, action) {
  return DEFAULT_MODE_POLICIES[mode]?.[action] ?? "block";
}
function resolveEffectiveMode(...modes) {
  const order = ["suggest", "auto-edit", "full-auto"];
  let minIndex = order.length - 1;
  for (const mode of modes) {
    const idx = order.indexOf(mode);
    if (idx >= 0 && idx < minIndex) minIndex = idx;
  }
  return order[minIndex];
}
function parseAutonomyMode(value) {
  switch (value) {
    case "suggest":
      return "suggest";
    case "auto-edit":
      return "auto-edit";
    case "full-auto":
      return "full-auto";
    default:
      return "auto-edit";
  }
}

// src/domains/safety/action-classifier.ts
var TOOL_TO_ACTION = {
  read: "file_read",
  grep: "file_read",
  find: "file_read",
  ls: "file_read",
  glob: "file_read",
  write: "file_write",
  edit: "file_write",
  notebook_edit: "file_write",
  bash: "bash_exec",
  shell: "bash_exec",
  web_fetch: "network",
  web_search: "network",
  dispatch_agent: "agent_dispatch",
  batch_dispatch: "agent_dispatch"
};
function classifyAction(toolName) {
  const normalized = toolName.toLowerCase().replace(/-/g, "_");
  return TOOL_TO_ACTION[normalized] ?? "file_read";
}
function isActionAllowed(mode, action) {
  return lookupTier(mode, action) === "allow";
}
var DESTRUCTIVE_BASH_PATTERNS = [
  /rm\s+(-rf|-fr|--force)/,
  /git\s+reset\s+--hard/,
  /git\s+push\s+.*--force/,
  /git\s+clean\s+-[dfx]/,
  /chmod\s+777/,
  /sudo\s/
];
function classifyBashCommand(command) {
  for (const pattern of DESTRUCTIVE_BASH_PATTERNS) {
    if (pattern.test(command)) return "bash_destructive";
  }
  if (/git\s+push/.test(command)) return "git_push";
  if (/git\s+(reset|rebase|cherry-pick|merge)/.test(command)) return "git_destructive";
  if (/rm\s/.test(command)) return "file_delete";
  return "bash_exec";
}

// src/domains/safety/scope-enforcement.ts
function checkDispatchAdmission(workerMode, orchestratorMode) {
  const effectiveMode = resolveEffectiveMode(workerMode, orchestratorMode);
  if (effectiveMode !== workerMode) {
    return {
      admitted: false,
      reason: `Worker mode ${workerMode} exceeds orchestrator mode ${orchestratorMode}. Effective: ${effectiveMode}`
    };
  }
  return { admitted: true };
}

// src/domains/safety/loop-detector.ts
var WARNING_THRESHOLD = 3;
var TRIPPED_THRESHOLD = 5;
var COOLDOWN_MS = 10 * 60 * 1e3;
var CASCADE_WINDOW_MS = 60 * 1e3;
var CASCADE_AGENT_THRESHOLD = 3;
function createLoopDetector() {
  const agents = /* @__PURE__ */ new Map();
  function getOrCreate(agent) {
    let state = agents.get(agent);
    if (!state) {
      state = { failures: 0, lastFailureAt: 0, status: "clear", trippedAt: null };
      agents.set(agent, state);
    }
    return state;
  }
  function checkCooldown(state) {
    if (state.status === "tripped" && state.trippedAt) {
      if (Date.now() - state.trippedAt > COOLDOWN_MS) {
        state.status = "clear";
        state.failures = 0;
        state.trippedAt = null;
      }
    }
  }
  function checkCascade() {
    const now = Date.now();
    let recentFailedAgents = 0;
    for (const [, state] of agents) {
      if (now - state.lastFailureAt < CASCADE_WINDOW_MS && state.failures > 0) {
        recentFailedAgents++;
      }
    }
    if (recentFailedAgents >= CASCADE_AGENT_THRESHOLD) {
      return {
        type: "cascade",
        agent: "*",
        failures: recentFailedAgents,
        message: `Cascade detected: ${recentFailedAgents} agents failed within ${CASCADE_WINDOW_MS / 1e3}s`
      };
    }
    return null;
  }
  return {
    recordFailure(agent) {
      const state = getOrCreate(agent);
      checkCooldown(state);
      state.failures++;
      state.lastFailureAt = Date.now();
      if (state.failures >= TRIPPED_THRESHOLD && state.status !== "tripped") {
        state.status = "tripped";
        state.trippedAt = Date.now();
        return {
          type: "tripped",
          agent,
          failures: state.failures,
          message: `Agent ${agent} tripped after ${state.failures} failures`
        };
      }
      if (state.failures >= WARNING_THRESHOLD && state.status === "clear") {
        state.status = "warning";
        return {
          type: "warning",
          agent,
          failures: state.failures,
          message: `Agent ${agent} warning: ${state.failures} consecutive failures`
        };
      }
      return checkCascade();
    },
    recordSuccess(agent) {
      const state = agents.get(agent);
      if (!state) return;
      state.failures = Math.floor(state.failures / 2);
      if (state.failures < WARNING_THRESHOLD) state.status = "clear";
    },
    isBlocked(agent) {
      const state = agents.get(agent);
      if (!state) return false;
      checkCooldown(state);
      return state.status === "tripped";
    },
    getStatus(agent) {
      const state = agents.get(agent);
      if (!state) return null;
      checkCooldown(state);
      return { ...state };
    },
    getAllAgents() {
      return [...agents.keys()];
    },
    reset(agent) {
      agents.delete(agent);
    },
    resetAll() {
      agents.clear();
    }
  };
}

// src/domains/safety/yaml-rules.ts
import { existsSync as existsSync7, readFileSync as readFileSync7 } from "fs";
import { join as join9 } from "path";
function loadSafetyRules(packageRoot) {
  const defaults = {
    bashPatterns: [],
    zeroAccessPaths: [],
    readOnlyPaths: [],
    noDeletePaths: []
  };
  const rulesPath = join9(packageRoot, ".pancode", "safety-rules.yaml");
  if (!existsSync7(rulesPath)) return defaults;
  try {
    const yamlText = readFileSync7(rulesPath, "utf8");
    const { parse } = __require("yaml");
    const doc = parse(yamlText);
    if (!doc || typeof doc !== "object") return defaults;
    if (Array.isArray(doc.bashToolPatterns)) {
      for (const entry of doc.bashToolPatterns) {
        if (typeof entry?.pattern === "string" && typeof entry?.reason === "string") {
          try {
            defaults.bashPatterns.push({ pattern: new RegExp(entry.pattern), reason: entry.reason });
          } catch {
          }
        }
      }
    }
    if (Array.isArray(doc.zeroAccessPaths)) {
      defaults.zeroAccessPaths = doc.zeroAccessPaths.filter((p) => typeof p === "string");
    }
    if (Array.isArray(doc.readOnlyPaths)) {
      defaults.readOnlyPaths = doc.readOnlyPaths.filter((p) => typeof p === "string");
    }
    if (Array.isArray(doc.noDeletePaths)) {
      defaults.noDeletePaths = doc.noDeletePaths.filter((p) => typeof p === "string");
    }
  } catch {
  }
  return defaults;
}
function matchesGlob(path, pattern) {
  const regexStr = pattern.replace(/\./g, "\\.").replace(/\*\*/g, "##DOUBLESTAR##").replace(/\*/g, "[^/]*").replace(/##DOUBLESTAR##/g, ".*");
  return new RegExp(`^${regexStr}$`).test(path);
}
function checkBashCommand(command, rules) {
  for (const { pattern, reason } of rules.bashPatterns) {
    if (pattern.test(command)) return { blocked: true, reason };
  }
  return { blocked: false };
}
function checkPathAccess(filePath, action, rules) {
  const expandedPath = filePath.replace(/^~/, process.env.HOME ?? "");
  for (const pattern of rules.zeroAccessPaths) {
    if (matchesGlob(expandedPath, pattern.replace(/^~/, process.env.HOME ?? ""))) {
      return { blocked: true, reason: `Zero-access path: ${pattern}` };
    }
  }
  if (action === "write" || action === "delete") {
    for (const pattern of rules.readOnlyPaths) {
      if (matchesGlob(expandedPath, pattern.replace(/^~/, process.env.HOME ?? ""))) {
        return { blocked: true, reason: `Read-only path: ${pattern}` };
      }
    }
  }
  if (action === "delete") {
    for (const pattern of rules.noDeletePaths) {
      if (matchesGlob(expandedPath, pattern.replace(/^~/, process.env.HOME ?? ""))) {
        return { blocked: true, reason: `No-delete path: ${pattern}` };
      }
    }
  }
  return { blocked: false };
}

// src/domains/safety/extension.ts
var extension5 = defineExtension((pi) => {
  let autonomyMode = "auto-edit";
  const loopDetector = createLoopDetector();
  let yamlRules = { bashPatterns: [], zeroAccessPaths: [], readOnlyPaths: [], noDeletePaths: [] };
  pi.on("session_start", (_event, _ctx) => {
    autonomyMode = parseAutonomyMode(process.env.PANCODE_SAFETY);
    const packageRoot = process.env.PANCODE_PACKAGE_ROOT ?? process.cwd();
    yamlRules = loadSafetyRules(packageRoot);
    console.error(
      `[pancode:safety] Mode: ${autonomyMode}. YAML rules: ${yamlRules.bashPatterns.length} bash patterns, ${yamlRules.zeroAccessPaths.length} zero-access, ${yamlRules.readOnlyPaths.length} read-only, ${yamlRules.noDeletePaths.length} no-delete paths.`
    );
    registerPreFlightCheck("scope-enforcement", (context) => {
      const admission = checkDispatchAdmission(autonomyMode, autonomyMode);
      if (!admission.admitted) {
        return { admit: false, reason: admission.reason };
      }
      if (loopDetector.isBlocked(context.agent)) {
        return { admit: false, reason: `Agent ${context.agent} is blocked by loop detector (too many failures)` };
      }
      return { admit: true };
    });
    sharedBus.on("pancode:run-finished", (raw) => {
      const payload = raw;
      const agent = typeof payload?.agent === "string" ? payload.agent : "unknown";
      if (payload?.status === "error") {
        const event = loopDetector.recordFailure(agent);
        if (event) {
          console.error(`[pancode:safety] Loop detector: ${event.message}`);
          sharedBus.emit("pancode:warning", { source: "safety", message: event.message });
        }
      } else if (payload?.status === "done") {
        loopDetector.recordSuccess(agent);
      }
    });
  });
  pi.on("tool_call", (event, _ctx) => {
    const actionClass = classifyAction(event.toolName);
    if (!isActionAllowed(autonomyMode, actionClass)) {
      return { block: true, reason: `[pancode:safety] ${actionClass} blocked in ${autonomyMode} mode` };
    }
    if ((event.toolName === "bash" || event.toolName === "shell") && "command" in event.input) {
      const command = event.input.command;
      const bashAction = classifyBashCommand(command);
      if (!isActionAllowed(autonomyMode, bashAction)) {
        return { block: true, reason: `[pancode:safety] ${bashAction} blocked in ${autonomyMode} mode` };
      }
      const yamlCheck = checkBashCommand(command, yamlRules);
      if (yamlCheck.blocked) {
        return { block: true, reason: `[pancode:safety] YAML rule: ${yamlCheck.reason}` };
      }
    }
    const input = event.input;
    const filePath = input.file_path ?? input.path ?? input.file;
    if (typeof filePath === "string") {
      const pathAction = actionClass === "file_delete" ? "delete" : actionClass === "file_write" ? "write" : "read";
      const pathCheck = checkPathAccess(filePath, pathAction, yamlRules);
      if (pathCheck.blocked) {
        return { block: true, reason: `[pancode:safety] YAML rule: ${pathCheck.reason}` };
      }
    }
    return void 0;
  });
});

// src/domains/safety/manifest.ts
var manifest5 = {
  name: "safety",
  dependsOn: []
};

// src/domains/scheduling/budget.ts
import { existsSync as existsSync8, mkdirSync as mkdirSync8, readFileSync as readFileSync8, writeFileSync as writeFileSync7 } from "fs";
import { dirname as dirname7, join as join10 } from "path";
var BudgetTracker = class {
  state;
  persistPath;
  constructor(runtimeRoot, ceiling = 10) {
    this.persistPath = join10(runtimeRoot, "budget.json");
    this.state = {
      totalCost: 0,
      totalInputTokens: 0,
      totalOutputTokens: 0,
      ceiling,
      runsCount: 0
    };
    this.load();
  }
  load() {
    if (!existsSync8(this.persistPath)) return;
    try {
      const raw = readFileSync8(this.persistPath, "utf8");
      const saved = JSON.parse(raw);
      this.state = { ...this.state, ...saved };
    } catch {
    }
  }
  persist() {
    const dir = dirname7(this.persistPath);
    mkdirSync8(dir, { recursive: true });
    writeFileSync7(this.persistPath, JSON.stringify(this.state, null, 2), "utf8");
  }
  recordCost(cost, inputTokens, outputTokens) {
    this.state.totalCost += cost;
    this.state.totalInputTokens += inputTokens;
    this.state.totalOutputTokens += outputTokens;
    this.state.runsCount += 1;
    this.persist();
  }
  canAdmit(estimatedCost = 0) {
    return this.state.totalCost + estimatedCost <= this.state.ceiling;
  }
  getState() {
    return { ...this.state };
  }
  setCeiling(ceiling) {
    this.state.ceiling = ceiling;
    this.persist();
  }
  remaining() {
    return Math.max(0, this.state.ceiling - this.state.totalCost);
  }
  resetSession() {
    this.state.totalCost = 0;
    this.state.totalInputTokens = 0;
    this.state.totalOutputTokens = 0;
    this.state.runsCount = 0;
    this.persist();
  }
  serialize() {
    return { ...this.state };
  }
  deserialize(data) {
    this.state = { ...this.state, ...data };
  }
};

// src/domains/scheduling/extension.ts
var budgetTracker = null;
function getBudgetTracker() {
  return budgetTracker;
}
var extension6 = defineExtension((pi) => {
  pi.on("session_start", (_event, _ctx) => {
    const packageRoot = process.env.PANCODE_PACKAGE_ROOT;
    if (!packageRoot) {
      console.error("[pancode:scheduling] PANCODE_PACKAGE_ROOT is not set. Domain state will not persist.");
    }
    const runtimeRoot = packageRoot ? `${packageRoot}/.pancode` : ".pancode";
    const ceiling = parseFloat(process.env.PANCODE_BUDGET_CEILING ?? "10.0") || 10;
    budgetTracker = new BudgetTracker(runtimeRoot, ceiling);
    budgetTracker.resetSession();
    registerPreFlightCheck("budget", () => {
      if (!budgetTracker) return { admit: true };
      if (budgetTracker.canAdmit()) return { admit: true };
      const state = budgetTracker.getState();
      return {
        admit: false,
        reason: `Budget ceiling reached ($${state.totalCost.toFixed(2)} / $${state.ceiling.toFixed(2)})`
      };
    });
    sharedBus.on("pancode:run-finished", (payload) => {
      if (!budgetTracker) return;
      const event = payload;
      if (event.status === "done") {
        budgetTracker.recordCost(event.usage.cost, event.usage.inputTokens, event.usage.outputTokens);
      }
    });
  });
  pi.registerCommand("budget", {
    description: "Show PanCode dispatch budget status",
    async handler(args, _ctx) {
      if (!budgetTracker) {
        pi.sendMessage({
          customType: "pancode-panel",
          content: "Budget tracker not initialized.",
          display: true,
          details: { title: "PanCode Budget" }
        });
        return;
      }
      const subcommand = args.trim().split(/\s+/);
      if (subcommand[0] === "set" && subcommand[1]) {
        const newCeiling = parseFloat(subcommand[1]);
        if (!Number.isFinite(newCeiling) || newCeiling <= 0) {
          pi.sendMessage({
            customType: "pancode-panel",
            content: "Invalid ceiling value. Use: /budget set <amount>",
            display: true,
            details: { title: "PanCode Budget" }
          });
          return;
        }
        budgetTracker.setCeiling(newCeiling);
        pi.sendMessage({
          customType: "pancode-panel",
          content: `Budget ceiling set to $${newCeiling.toFixed(2)}`,
          display: true,
          details: { title: "PanCode Budget" }
        });
        return;
      }
      const state = budgetTracker.getState();
      const lines = [
        `Spent: $${state.totalCost.toFixed(4)} / $${state.ceiling.toFixed(2)}`,
        `Remaining: $${budgetTracker.remaining().toFixed(4)}`,
        `Runs: ${state.runsCount}`,
        `Input tokens: ${state.totalInputTokens}`,
        `Output tokens: ${state.totalOutputTokens}`,
        "",
        "Use /budget set <amount> to adjust ceiling."
      ];
      pi.sendMessage({
        customType: "pancode-panel",
        content: lines.join("\n"),
        display: true,
        details: { title: "PanCode Budget" }
      });
    }
  });
});

// src/domains/scheduling/manifest.ts
var manifest6 = {
  name: "scheduling",
  dependsOn: ["dispatch", "agents"]
};

// src/domains/session/extension.ts
import { join as join14 } from "path";

// src/domains/session/context-registry.ts
import { existsSync as existsSync9, readFileSync as readFileSync9 } from "fs";
import { join as join11 } from "path";
var MAX_ENTRIES = 500;
function createContextRegistry(runtimeRoot) {
  const filePath = join11(runtimeRoot, "context.json");
  let store = /* @__PURE__ */ new Map();
  if (existsSync9(filePath)) {
    try {
      const raw = readFileSync9(filePath, "utf-8");
      const data = JSON.parse(raw);
      for (const [key, entry] of Object.entries(data)) {
        store.set(key, entry);
      }
    } catch {
    }
  }
  function persist() {
    const data = {};
    for (const [key, entry] of store) {
      data[key] = entry;
    }
    atomicWriteJsonSync(filePath, data);
  }
  function evictOldest() {
    if (store.size <= MAX_ENTRIES) return;
    const sorted = [...store.entries()].sort((a, b) => a[1].timestamp.localeCompare(b[1].timestamp));
    const toRemove = store.size - MAX_ENTRIES;
    for (let i = 0; i < toRemove; i++) {
      store.delete(sorted[i][0]);
    }
  }
  return {
    set(key, value, source) {
      store.set(key, {
        key,
        value,
        source,
        timestamp: (/* @__PURE__ */ new Date()).toISOString()
      });
      evictOldest();
      persist();
    },
    get(key) {
      return store.get(key) ?? null;
    },
    getBySource(source) {
      const result = [];
      for (const entry of store.values()) {
        if (entry.source === source) result.push(entry);
      }
      return result;
    },
    getAll() {
      return [...store.values()];
    },
    delete(key) {
      const existed = store.delete(key);
      if (existed) persist();
      return existed;
    },
    clear() {
      store.clear();
      persist();
    },
    size() {
      return store.size;
    }
  };
}

// src/domains/session/shared-board.ts
import { existsSync as existsSync10, readFileSync as readFileSync10 } from "fs";
import { join as join12 } from "path";
var MAX_ENTRIES2 = 1e3;
function createSharedBoard(runtimeRoot) {
  const filePath = join12(runtimeRoot, "board.json");
  let store = /* @__PURE__ */ new Map();
  function loadFromDisk() {
    if (!existsSync10(filePath)) return;
    try {
      const raw = readFileSync10(filePath, "utf-8");
      const data = JSON.parse(raw);
      store = /* @__PURE__ */ new Map();
      for (const [ns, entries] of Object.entries(data)) {
        const nsMap = /* @__PURE__ */ new Map();
        for (const [key, entry] of Object.entries(entries)) {
          nsMap.set(key, entry);
        }
        store.set(ns, nsMap);
      }
    } catch {
    }
  }
  function saveToDisk() {
    const data = {};
    for (const [ns, entries] of store) {
      data[ns] = {};
      for (const [key, entry] of entries) {
        data[ns][key] = entry;
      }
    }
    atomicWriteJsonSync(filePath, data);
  }
  function isExpired(entry) {
    if (!entry.ttlMs) return false;
    const created = new Date(entry.createdAt).getTime();
    return Date.now() > created + entry.ttlMs;
  }
  function totalSize() {
    let count = 0;
    for (const ns of store.values()) {
      count += ns.size;
    }
    return count;
  }
  function evictToLimit() {
    if (totalSize() <= MAX_ENTRIES2) return;
    for (const [, nsMap] of store) {
      for (const [key, entry] of nsMap) {
        if (isExpired(entry)) nsMap.delete(key);
      }
    }
    if (totalSize() <= MAX_ENTRIES2) return;
    const all = [];
    for (const [ns, nsMap] of store) {
      for (const [key, entry] of nsMap) {
        all.push({ ns, key, timestamp: entry.timestamp });
      }
    }
    all.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
    const toRemove = totalSize() - MAX_ENTRIES2;
    for (let i = 0; i < toRemove; i++) {
      const target = all[i];
      store.get(target.ns)?.delete(target.key);
    }
  }
  loadFromDisk();
  return {
    set(namespace, key, value, source, options) {
      let nsMap = store.get(namespace);
      if (!nsMap) {
        nsMap = /* @__PURE__ */ new Map();
        store.set(namespace, nsMap);
      }
      const merge = options?.merge ?? "last-write-wins";
      const now = (/* @__PURE__ */ new Date()).toISOString();
      let finalValue = value;
      if (merge === "append") {
        const existing = nsMap.get(key);
        if (existing && !isExpired(existing)) {
          finalValue = `${existing.value}
${value}`;
        }
      }
      const entry = {
        value: finalValue,
        source,
        timestamp: now,
        createdAt: now,
        ttlMs: options?.ttlMs
      };
      nsMap.set(key, entry);
      evictToLimit();
      saveToDisk();
    },
    get(namespace, key) {
      const nsMap = store.get(namespace);
      if (!nsMap) return null;
      const entry = nsMap.get(key);
      if (!entry) return null;
      if (isExpired(entry)) {
        nsMap.delete(key);
        return null;
      }
      return { value: entry.value, source: entry.source, timestamp: entry.timestamp, ttlMs: entry.ttlMs };
    },
    getNamespace(namespace) {
      const nsMap = store.get(namespace);
      if (!nsMap) return {};
      const result = {};
      for (const [key, entry] of nsMap) {
        if (isExpired(entry)) {
          nsMap.delete(key);
          continue;
        }
        result[key] = { value: entry.value, source: entry.source, timestamp: entry.timestamp, ttlMs: entry.ttlMs };
      }
      return result;
    },
    getAll() {
      const result = {};
      for (const [ns, nsMap] of store) {
        const nsEntries = {};
        let hasEntries = false;
        for (const [key, entry] of nsMap) {
          if (isExpired(entry)) {
            nsMap.delete(key);
            continue;
          }
          nsEntries[key] = { value: entry.value, source: entry.source, timestamp: entry.timestamp, ttlMs: entry.ttlMs };
          hasEntries = true;
        }
        if (hasEntries) result[ns] = nsEntries;
      }
      return result;
    },
    delete(namespace, key) {
      const nsMap = store.get(namespace);
      if (!nsMap) return false;
      const existed = nsMap.delete(key);
      if (existed) saveToDisk();
      return existed;
    },
    clearNamespace(namespace) {
      store.delete(namespace);
      saveToDisk();
    },
    clear() {
      store.clear();
      saveToDisk();
    },
    size() {
      return totalSize();
    },
    persist() {
      saveToDisk();
    },
    sync() {
      loadFromDisk();
    }
  };
}

// src/domains/session/memory.ts
import { existsSync as existsSync11, readFileSync as readFileSync11 } from "fs";
import { join as join13 } from "path";
var MAX_ENTRIES_PER_TIER = 200;
function createTemporalTier() {
  const store = /* @__PURE__ */ new Map();
  function evictOldest() {
    if (store.size <= MAX_ENTRIES_PER_TIER) return;
    const sorted = [...store.entries()].sort((a, b) => a[1].timestamp.localeCompare(b[1].timestamp));
    const toRemove = store.size - MAX_ENTRIES_PER_TIER;
    for (let i = 0; i < toRemove; i++) {
      store.delete(sorted[i][0]);
    }
  }
  return {
    set(key, value, source) {
      store.set(key, { key, value, source, timestamp: (/* @__PURE__ */ new Date()).toISOString() });
      evictOldest();
    },
    get(key) {
      return store.get(key) ?? null;
    },
    getAll() {
      return [...store.values()];
    },
    delete(key) {
      return store.delete(key);
    },
    clear() {
      store.clear();
    },
    size() {
      return store.size;
    }
  };
}
function createPersistentTier(runtimeRoot) {
  const filePath = join13(runtimeRoot, "memory.json");
  const store = /* @__PURE__ */ new Map();
  if (existsSync11(filePath)) {
    try {
      const raw = readFileSync11(filePath, "utf-8");
      const data = JSON.parse(raw);
      for (const [key, entry] of Object.entries(data)) {
        store.set(key, entry);
      }
    } catch {
    }
  }
  function persist() {
    const data = {};
    for (const [key, entry] of store) {
      data[key] = entry;
    }
    atomicWriteJsonSync(filePath, data);
  }
  function evictOldest() {
    if (store.size <= MAX_ENTRIES_PER_TIER) return;
    const sorted = [...store.entries()].sort((a, b) => a[1].timestamp.localeCompare(b[1].timestamp));
    const toRemove = store.size - MAX_ENTRIES_PER_TIER;
    for (let i = 0; i < toRemove; i++) {
      store.delete(sorted[i][0]);
    }
  }
  return {
    set(key, value, source) {
      store.set(key, { key, value, source, timestamp: (/* @__PURE__ */ new Date()).toISOString() });
      evictOldest();
      persist();
    },
    get(key) {
      return store.get(key) ?? null;
    },
    getAll() {
      return [...store.values()];
    },
    delete(key) {
      const existed = store.delete(key);
      if (existed) persist();
      return existed;
    },
    clear() {
      store.clear();
      persist();
    },
    size() {
      return store.size;
    }
  };
}
function createSharedTier(registry) {
  return {
    set(key, value, source) {
      registry.set(key, value, source);
    },
    get(key) {
      const entry = registry.get(key);
      if (!entry) return null;
      return { key: entry.key, value: entry.value, source: entry.source, timestamp: entry.timestamp };
    },
    getAll() {
      return registry.getAll().map((e) => ({
        key: e.key,
        value: e.value,
        source: e.source,
        timestamp: e.timestamp
      }));
    },
    delete(key) {
      return registry.delete(key);
    },
    clear() {
      registry.clear();
    },
    size() {
      return registry.size();
    }
  };
}
function createSessionMemory(runtimeRoot, contextRegistry2) {
  return {
    temporal: createTemporalTier(),
    persistent: createPersistentTier(runtimeRoot),
    shared: createSharedTier(contextRegistry2)
  };
}

// src/domains/session/extension.ts
var contextRegistry = null;
var sharedBoard = null;
var sessionMemory = null;
var extension7 = defineExtension((pi) => {
  pi.on("session_start", (_event, _ctx) => {
    const runtimeRoot = process.env.PANCODE_RUNTIME_ROOT ?? join14(process.env.PANCODE_PACKAGE_ROOT ?? process.cwd(), ".pancode", "runtime");
    contextRegistry = createContextRegistry(runtimeRoot);
    sharedBoard = createSharedBoard(runtimeRoot);
    sessionMemory = createSessionMemory(runtimeRoot, contextRegistry);
    console.error(
      `[pancode:session] Coordination ready. Context: ${contextRegistry.size()} entries, Board: ${sharedBoard.size()} entries`
    );
  });
  pi.on("session_shutdown", async () => {
    if (sharedBoard) sharedBoard.persist();
    console.error("[pancode:session] Session shutdown. Board persisted.");
  });
});

// src/domains/session/manifest.ts
var manifest7 = {
  name: "session",
  dependsOn: []
};

// src/engine/tui.ts
import { Theme } from "@pancode/pi-coding-agent";
import { Box, Container, Text, truncateToWidth, visibleWidth } from "@pancode/pi-tui";

// src/domains/ui/widget-utils.ts
function padRight(text, width) {
  return text.length >= width ? text.slice(0, width) : text + " ".repeat(width - text.length);
}
function truncate(text, maxLength) {
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength - 3) + "...";
}
function formatDuration(ms) {
  if (ms < 1e3) return `${ms}ms`;
  if (ms < 6e4) return `${(ms / 1e3).toFixed(1)}s`;
  const minutes = Math.floor(ms / 6e4);
  const seconds = Math.round(ms % 6e4 / 1e3);
  return `${minutes}m${seconds}s`;
}
function formatCost(cost) {
  if (cost === 0) return "$0.00";
  if (cost < 1e-3) return `$${cost.toFixed(6)}`;
  if (cost < 1) return `$${cost.toFixed(4)}`;
  return `$${cost.toFixed(2)}`;
}
function formatTokenCount(count) {
  if (count < 1e3) return String(count);
  if (count < 1e4) return `${(count / 1e3).toFixed(1)}k`;
  if (count < 1e6) return `${Math.round(count / 1e3)}k`;
  return `${(count / 1e6).toFixed(1)}M`;
}

// src/domains/ui/dispatch-board.ts
var PLAIN = {
  accent: (t) => t,
  bold: (t) => t,
  muted: (t) => t,
  dim: (t) => t,
  success: (t) => t,
  error: (t) => t,
  warning: (t) => t
};
function colorizeStatusIcon(icon, status, c) {
  switch (status) {
    case "running":
      return c.accent(icon);
    case "done":
      return c.success(icon);
    case "error":
      return c.error(icon);
    case "pending":
      return c.dim(icon);
    default:
      return c.dim(icon);
  }
}
var STATUS_ICONS = {
  pending: "\u25CB",
  running: "\u25CF",
  done: "\u2713",
  error: "\u2717",
  cancelled: "\u2298",
  timeout: "\u2298"
};
var MIN_CARD_WIDTH = 24;
var CARD_GAP = 2;
var CARD_HEIGHT = 6;
var INDENT = "  ";
function calculateGridColumns(cardCount, terminalWidth) {
  const maxCols = Math.floor((terminalWidth + CARD_GAP) / (MIN_CARD_WIDTH + CARD_GAP));
  if (maxCols < 1) return 1;
  if (cardCount <= 3) return Math.min(cardCount, maxCols);
  if (cardCount <= 6) return Math.min(3, maxCols);
  return Math.min(4, maxCols);
}
function renderDispatchCard(card, cardWidth, c = PLAIN) {
  const inner = Math.max(1, cardWidth - 4);
  const statusIcon = STATUS_ICONS[card.status] ?? "\u25CB";
  const elapsed = formatDuration(card.elapsedMs);
  const statusText = card.status;
  const plainPrefix = `${statusIcon} ${statusText}`;
  const gap = Math.max(1, inner - plainPrefix.length - elapsed.length);
  const plainStatusLine = padRight(`${plainPrefix}${" ".repeat(gap)}${elapsed}`, inner);
  const trailingPad = plainStatusLine.length - `${plainPrefix}${" ".repeat(gap)}${elapsed}`.length;
  const statusLine = `${colorizeStatusIcon(statusIcon, card.status, c)} ${c.muted(statusText)}${" ".repeat(gap)}${c.dim(elapsed)}${" ".repeat(Math.max(0, trailingPad))}`;
  const modelLine = c.muted(padRight(card.model ? truncate(card.model, inner) : "", inner));
  const agentLine = c.bold(c.accent(padRight(card.agent, inner)));
  let taskLine;
  const totalTokens = (card.inputTokens ?? 0) + (card.outputTokens ?? 0);
  if (totalTokens > 0 && card.turns) {
    const tokStr = formatTokenCount(totalTokens) + " tok";
    const turnStr = `T${card.turns}`;
    const prefix = `${tokStr}  ${turnStr}  `;
    const remaining = Math.max(0, inner - prefix.length);
    const plainTask = padRight(prefix + truncate(card.taskPreview, remaining), inner);
    const taskPreviewPart = truncate(card.taskPreview, remaining);
    const paddedTaskPreview = padRight(taskPreviewPart, remaining);
    taskLine = c.dim(prefix) + paddedTaskPreview;
  } else {
    taskLine = padRight(truncate(card.taskPreview, inner), inner);
  }
  const hBar = c.dim("\u2500".repeat(cardWidth - 2));
  return [
    c.dim("\u250C") + hBar + c.dim("\u2510"),
    c.dim("\u2502 ") + agentLine + c.dim(" \u2502"),
    c.dim("\u2502 ") + statusLine + c.dim(" \u2502"),
    c.dim("\u2502 ") + modelLine + c.dim(" \u2502"),
    c.dim("\u2502 ") + taskLine + c.dim(" \u2502"),
    c.dim("\u2514") + hBar + c.dim("\u2518")
  ];
}
function renderCardGrid(cards, width, c = PLAIN) {
  if (cards.length === 0) return [];
  const usable = Math.max(MIN_CARD_WIDTH, width - INDENT.length);
  const cols = calculateGridColumns(cards.length, usable);
  const cardWidth = Math.max(MIN_CARD_WIDTH, Math.floor((usable - (cols - 1) * CARD_GAP) / cols));
  const rendered = cards.map((card) => renderDispatchCard(card, cardWidth, c));
  const lines = [];
  for (let rowStart = 0; rowStart < rendered.length; rowStart += cols) {
    const rowCards = rendered.slice(rowStart, rowStart + cols);
    for (let line = 0; line < CARD_HEIGHT; line++) {
      const parts = rowCards.map((card) => card[line]);
      lines.push(`${INDENT}${parts.join(" ".repeat(CARD_GAP))}`);
    }
  }
  return lines;
}
function renderRecentRun(card, width, c = PLAIN) {
  const icon = STATUS_ICONS[card.status] ?? "\u2298";
  const coloredIcon = colorizeStatusIcon(icon, card.status, c);
  const agent = c.accent(padRight(card.agent, 8));
  const elapsed = c.dim(formatDuration(card.elapsedMs).padStart(6));
  const costStr = card.cost && card.cost > 0 ? c.muted(formatCost(card.cost).padStart(8)) : "";
  const hasCost = card.cost !== void 0 && card.cost > 0;
  const fixedWidth = 20 + (hasCost ? 9 : 0);
  const maxTask = Math.max(10, width - fixedWidth);
  const task = padRight(truncate(card.taskPreview, maxTask), maxTask);
  return hasCost ? `${INDENT}${coloredIcon} ${agent} ${task} ${costStr} ${elapsed}` : `${INDENT}${coloredIcon} ${agent} ${task} ${elapsed}`;
}
function renderAgentStatLine(stat, c = PLAIN) {
  const agent = c.accent(padRight(stat.agent, 8));
  const runs = c.muted(`${stat.runs} runs`);
  const rateFn = stat.successRate >= 80 ? c.success : stat.successRate >= 50 ? c.warning : c.error;
  const rate = rateFn(`${stat.successRate}% ok`);
  const cost = stat.avgCostPerRun > 0 ? c.dim(`  ${formatCost(stat.avgCostPerRun)}/run`) : "";
  const dur = c.dim(`  avg ${formatDuration(stat.avgDurationMs)}`);
  return `${INDENT}${agent} ${runs}  ${rate}${cost}${dur}`;
}
function renderDispatchFooter(state, _width, c = PLAIN) {
  const budget = state.budgetCeiling !== null ? `$${state.totalCost.toFixed(2)} / $${state.budgetCeiling.toFixed(2)}` : `$${state.totalCost.toFixed(2)}`;
  const hasTokens = state.totalInputTokens > 0 || state.totalOutputTokens > 0;
  const tokens = hasTokens ? `  |  Tokens: ${formatTokenCount(state.totalInputTokens)} in / ${formatTokenCount(state.totalOutputTokens)} out` : "";
  const cacheRead = state.totalCacheReadTokens ?? 0;
  const cacheInput = state.totalInputTokens;
  const cacheStr = cacheRead > 0 && cacheInput > 0 ? `  |  Cache: ${Math.round(cacheRead / (cacheRead + cacheInput) * 100)}%` : "";
  return [
    `${INDENT}${c.muted("Budget:")} ${c.dim(budget)}  ${c.dim("|")}  ${c.muted("Runs:")} ${c.dim(String(state.totalRuns))}${c.dim(tokens)}${c.dim(cacheStr)}`
  ];
}
function renderDispatchBoard(state, width, c = PLAIN) {
  const lines = [];
  lines.push(c.bold(c.accent("DISPATCH BOARD")));
  if (state.active.length > 0) {
    lines.push("");
    lines.push(`${INDENT}${c.dim("ACTIVE")}`);
    lines.push(...renderCardGrid(state.active, width, c));
  }
  if (state.recent.length > 0) {
    lines.push("");
    lines.push(`${INDENT}${c.dim("RECENT")}`);
    for (const card of state.recent) {
      lines.push(renderRecentRun(card, width, c));
    }
  }
  if (state.agentStats && state.agentStats.length > 0) {
    lines.push("");
    lines.push(`${INDENT}${c.dim("AGENTS")}`);
    for (const stat of state.agentStats) {
      lines.push(renderAgentStatLine(stat, c));
    }
  }
  if (state.totalRuns > 0) {
    lines.push("");
    lines.push(...renderDispatchFooter(state, width, c));
  }
  return lines;
}

// src/domains/ui/renderers.ts
function renderRunBoard(runs) {
  if (runs.length === 0) return ["No runs recorded."];
  const lines = [];
  for (const run of runs) {
    const status = run.status.padEnd(9);
    const agent = run.agent.padEnd(10);
    const costStr = run.usage.cost > 0 ? ` $${run.usage.cost.toFixed(4)}` : "";
    const task = run.task.length > 50 ? `${run.task.slice(0, 47)}...` : run.task;
    lines.push(`[${run.id}] ${status} ${agent} ${task}${costStr}`);
  }
  return lines;
}

// src/domains/ui/context-tracker.ts
var contextTokens = 0;
var contextWindow = 0;
function recordContextUsage(inputTokens, modelContextWindow) {
  contextTokens = inputTokens;
  if (modelContextWindow > 0) {
    contextWindow = modelContextWindow;
  }
}
function getContextPercent() {
  if (contextWindow <= 0) return 0;
  return Math.min(100, Math.round(contextTokens / contextWindow * 100));
}

// src/domains/ui/worker-widgets.ts
var liveWorkers = /* @__PURE__ */ new Map();
var pendingCleanups = /* @__PURE__ */ new Set();
function trackWorkerStart(runId, agent, task, model) {
  pendingCleanups.delete(runId);
  liveWorkers.set(runId, {
    runId,
    agent,
    task,
    model,
    status: "running",
    startedAt: Date.now(),
    inputTokens: 0,
    outputTokens: 0,
    turns: 0
  });
}
function updateWorkerProgress(runId, inputTokens, outputTokens, turns) {
  const worker = liveWorkers.get(runId);
  if (worker) {
    worker.inputTokens = inputTokens;
    worker.outputTokens = outputTokens;
    worker.turns = turns;
  }
}
function trackWorkerEnd(runId, status) {
  const worker = liveWorkers.get(runId);
  if (worker) worker.status = status;
  if (pendingCleanups.has(runId)) return;
  pendingCleanups.add(runId);
  setTimeout(() => {
    liveWorkers.delete(runId);
    pendingCleanups.delete(runId);
  }, 5e3);
}
function getLiveWorkers() {
  return [...liveWorkers.values()];
}
function resetAll() {
  liveWorkers.clear();
  pendingCleanups.clear();
}

// src/domains/ui/tasks.ts
function buildTaskWidget(runs) {
  const activeRuns = runs.filter((r) => r.status === "running" || r.status === "pending");
  const completedRuns = runs.filter((r) => r.status === "done").length;
  const failedRuns = runs.filter((r) => r.status === "error").length;
  return { activeRuns, completedRuns, failedRuns };
}
function renderTaskWidget(widget) {
  const lines = [];
  if (widget.activeRuns.length > 0) {
    lines.push(`Active: ${widget.activeRuns.length}`);
    for (const run of widget.activeRuns) {
      const task = run.task.length > 40 ? `${run.task.slice(0, 37)}...` : run.task;
      lines.push(`  [${run.id}] ${run.agent} ${task}`);
    }
  }
  if (widget.completedRuns > 0 || widget.failedRuns > 0) {
    lines.push(`Completed: ${widget.completedRuns} | Failed: ${widget.failedRuns}`);
  }
  return lines.length > 0 ? lines : ["No dispatched tasks."];
}

// src/domains/ui/extension.ts
function composeSingleLine(left, right, width) {
  const safeWidth = Math.max(0, width);
  const leftWidth = visibleWidth(left);
  const rightWidth = visibleWidth(right);
  if (leftWidth + rightWidth + 1 <= safeWidth) {
    return `${left}${" ".repeat(safeWidth - leftWidth - rightWidth)}${right}`;
  }
  return truncateToWidth(`${left} ${right}`.trim(), safeWidth);
}
function sendPanel(sendMessage, title, lines) {
  sendMessage(title, lines.join("\n"));
}
function buildDashboardLines(input) {
  return [
    `${PANCODE_PRODUCT_NAME} shell is active.`,
    `Model: ${input.modelLabel}`,
    `Reasoning: ${input.reasoningPreference} | capability: ${input.reasoningCapability} | applied: ${input.effectiveThinkingLevel}`,
    `Theme: ${input.themeName}`,
    `Working directory: ${input.workingDirectory}`,
    `Tools: ${input.tools.join(", ") || "(none)"}`,
    "",
    "Owned commands:",
    ...formatShellCommandLines()
  ];
}
function readReasoningPreference() {
  return parseReasoningPreference(process.env.PANCODE_REASONING) ?? DEFAULT_REASONING_PREFERENCE;
}
function describeReasoningCapability(model) {
  const control = getModelReasoningControl(model);
  if (control === "none") return "unsupported";
  if (control === "levels") return `levels (${THINKING_LEVELS.join(", ")})`;
  switch (model?.compat?.thinkingFormat) {
    case "qwen":
      return "toggle (enable_thinking)";
    case "qwen-chat-template":
      return "toggle (chat_template_kwargs.enable_thinking)";
    case "zai":
      return "toggle (provider enable_thinking)";
    default:
      return "toggle";
  }
}
function persistSettings(patch, notify) {
  try {
    updatePanCodeSettings(patch);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    notify(`Failed to save PanCode settings: ${message}`, "error");
  }
}
function parseReasoningCommand(request) {
  const normalized = request.trim().toLowerCase();
  const preference = parseReasoningPreference(normalized);
  if (preference) {
    return { preference, note: null };
  }
  const legacyThinkingLevel = parseThinkingLevel(normalized);
  if (!legacyThinkingLevel) return null;
  return {
    preference: legacyThinkingLevel === "off" ? "off" : "on",
    note: legacyThinkingLevel === "off" ? null : `PanCode stores reasoning as off/on; mapped "${legacyThinkingLevel}" to "on".`
  };
}
function modelRef(model) {
  return `${model.provider}/${model.id}`;
}
function getRegisteredModels(ctx) {
  ctx.modelRegistry.refresh();
  const sortModels = (models) => [...models].sort((left, right) => {
    const providerDiff = left.provider.localeCompare(right.provider);
    if (providerDiff !== 0) return providerDiff;
    return left.id.localeCompare(right.id);
  });
  const all = sortModels(ctx.modelRegistry.getAll());
  const available = sortModels(ctx.modelRegistry.getAvailable());
  return {
    all,
    available,
    availableRefs: new Set(available.map((model) => modelRef(model)))
  };
}
function isChatModel(modelId) {
  const lower = modelId.toLowerCase();
  if (lower.includes("embedding") || lower.includes("reranker")) return false;
  if (/(?:^|[\/-])bge-/.test(lower)) return false;
  if (lower.includes("embed") && !lower.includes("instruct") && !lower.includes("chat")) return false;
  return true;
}
function formatContextWindow(tokens) {
  if (tokens === null) return null;
  if (tokens >= 1e3) return `${Math.round(tokens / 1e3)}K ctx`;
  return `${tokens} ctx`;
}
function formatProfileCapabilities(profile) {
  const parts = [];
  if (profile.capabilities.reasoning) parts.push("reasoning");
  const ctx = formatContextWindow(profile.capabilities.contextWindow);
  if (ctx) parts.push(ctx);
  return parts.length > 0 ? ` (${parts.join(", ")})` : "";
}
function formatRegistryModelCapabilities(model, profiles) {
  const profile = profiles.find((p) => p.providerId === model.provider && p.modelId === model.id);
  if (profile) return formatProfileCapabilities(profile);
  const parts = [];
  if (model.reasoning) parts.push("reasoning");
  const ctx = formatContextWindow(model.contextWindow ?? null);
  if (ctx) parts.push(ctx);
  return parts.length > 0 ? ` (${parts.join(", ")})` : "";
}
function formatActiveModelLines(currentRef, profiles) {
  const chatProfiles = profiles.filter((p) => isChatModel(p.modelId));
  if (chatProfiles.length === 0) return ["  (no active engines detected)"];
  const byProvider = /* @__PURE__ */ new Map();
  for (const p of chatProfiles) {
    const group = byProvider.get(p.providerId) ?? [];
    group.push(p);
    byProvider.set(p.providerId, group);
  }
  const lines = [];
  for (const [providerId, group] of byProvider) {
    lines.push(`  ${providerId}`);
    for (const profile of group) {
      const ref = `${profile.providerId}/${profile.modelId}`;
      const marker = ref === currentRef ? "*" : "-";
      const caps = formatProfileCapabilities(profile);
      lines.push(`    ${marker} ${profile.modelId}${caps}`);
    }
  }
  return lines;
}
function formatAvailableSummary(registryAvailable) {
  const chatModels = registryAvailable.filter((m) => isChatModel(m.id));
  if (chatModels.length === 0) return [];
  const providerSet = /* @__PURE__ */ new Set();
  for (const m of chatModels) providerSet.add(m.provider);
  const providerLabel = providerSet.size === 1 ? "1 provider" : `${providerSet.size} providers`;
  return [
    "",
    `Available: ${chatModels.length} models across ${providerLabel}. Use /models all to browse.`
  ];
}
function formatProviderModelLines(currentRef, providerName, models, profiles) {
  const sorted = [...models].sort((a, b) => a.id.localeCompare(b.id));
  const lines = [`${providerName} (${sorted.length} models):`];
  for (const model of sorted) {
    const ref = modelRef(model);
    const marker = ref === currentRef ? "*" : "-";
    const caps = formatRegistryModelCapabilities(model, profiles);
    lines.push(`  ${marker} ${model.id}${caps}`);
  }
  lines.push("", "Use /models <provider/model-id> to switch.");
  return lines;
}
function formatAllAvailableLines(currentRef, models, profiles) {
  const chatModels = models.filter((m) => isChatModel(m.id));
  if (chatModels.length === 0) return ["No available models found."];
  const sorted = [...chatModels].sort((a, b) => {
    const providerDiff = a.provider.localeCompare(b.provider);
    if (providerDiff !== 0) return providerDiff;
    return a.id.localeCompare(b.id);
  });
  const lines = [];
  let activeProvider = null;
  for (const model of sorted) {
    if (model.provider !== activeProvider) {
      activeProvider = model.provider;
      if (lines.length > 0) lines.push("");
      lines.push(model.provider);
    }
    const ref = modelRef(model);
    const marker = ref === currentRef ? "*" : "-";
    const caps = formatRegistryModelCapabilities(model, profiles);
    lines.push(`  ${marker} ${model.id}${caps}`);
  }
  lines.push("", "Use /models <provider/model-id> to switch.");
  return lines;
}
function computeAgentStats(runs) {
  if (runs.length < 3) return [];
  const byAgent = /* @__PURE__ */ new Map();
  for (const run of runs) {
    const group = byAgent.get(run.agent) ?? [];
    group.push(run);
    byAgent.set(run.agent, group);
  }
  return [...byAgent.entries()].map(([agent, agentRuns]) => ({
    agent,
    runs: agentRuns.length,
    successRate: Math.round(agentRuns.filter((r) => r.status === "done").length / agentRuns.length * 100),
    avgCostPerRun: agentRuns.reduce((s, r) => s + r.cost, 0) / agentRuns.length,
    avgDurationMs: agentRuns.reduce((s, r) => s + r.durationMs, 0) / agentRuns.length
  }));
}
function resolveModelSelection(request, models) {
  const trimmed = request.trim();
  if (!trimmed) {
    return { error: "Missing model reference. Use provider/model-id." };
  }
  if (trimmed.includes("/")) {
    const exactMatch = models.find((model) => modelRef(model) === trimmed);
    return exactMatch ? { model: exactMatch } : { error: `Model not found: ${trimmed}` };
  }
  const matchingIds = models.filter((model) => model.id === trimmed);
  if (matchingIds.length === 1) return { model: matchingIds[0] };
  if (matchingIds.length > 1) {
    return { error: `Model id "${trimmed}" is ambiguous. Use provider/model-id.` };
  }
  return { error: `Model not found: ${trimmed}` };
}
var extension8 = defineExtension((pi) => {
  let currentModelLabel = "no model";
  let currentThemeName = process.env.PANCODE_THEME?.trim() || "pancode-dark";
  let currentReasoningPreference = readReasoningPreference();
  let welcomeShown = false;
  const emitPanel = (title, body) => {
    pi.sendMessage({
      customType: "pancode-panel",
      content: body,
      display: true,
      details: { title }
    });
  };
  pi.registerMessageRenderer("pancode-panel", (message, _options, theme) => {
    const title = typeof message.details === "object" && message.details && "title" in message.details ? String(message.details.title ?? PANCODE_PRODUCT_NAME) : PANCODE_PRODUCT_NAME;
    const body = typeof message.content === "string" ? message.content : String(message.content ?? "");
    const text = `${theme.bold(theme.fg("accent", title))}
${body}`;
    return new Text(text, 1, 0);
  });
  const handleThemeCommand = async (args, ctx) => {
    const request = args.trim();
    const themes = ctx.ui.getAllThemes().map((themeInfo) => themeInfo.name).sort();
    if (!request || request === "list") {
      const lines = themes.map((name) => `${name === ctx.ui.theme.name ? "*" : "-"} ${name}`);
      sendPanel(emitPanel, `${PANCODE_PRODUCT_NAME} Themes`, lines);
      return;
    }
    const result = ctx.ui.setTheme(request);
    if (!result.success) {
      ctx.ui.notify(result.error ?? `Theme not found: ${request}`, "error");
      return;
    }
    currentThemeName = request;
    persistSettings({ theme: request }, (message, level) => ctx.ui.notify(message, level));
    ctx.ui.setStatus("theme", `Theme: ${request}`);
    ctx.ui.notify(`Theme set to ${request}`, "info");
  };
  const handleModelsCommand = async (args, ctx) => {
    const request = args.trim();
    const registry = getRegisteredModels(ctx);
    const profiles = getModelProfileCache();
    const currentRef = ctx.model ? modelRef(ctx.model) : "unresolved";
    if (!request || request === "list") {
      const lines = [
        `Current: ${currentRef}`,
        "",
        "Active (loaded on connected engines):",
        ...formatActiveModelLines(currentRef, profiles),
        ...formatAvailableSummary(registry.available)
      ];
      sendPanel(emitPanel, `${PANCODE_PRODUCT_NAME} Models`, lines);
      return;
    }
    if (request === "all") {
      const chatCount = registry.available.filter((m) => isChatModel(m.id)).length;
      sendPanel(emitPanel, `${PANCODE_PRODUCT_NAME} Models`, [
        `Current: ${currentRef}`,
        `Total available: ${chatCount}`,
        "",
        ...formatAllAvailableLines(currentRef, registry.available, profiles)
      ]);
      return;
    }
    const providerModels = registry.available.filter((m) => m.provider === request);
    if (providerModels.length > 0) {
      sendPanel(emitPanel, `${PANCODE_PRODUCT_NAME} Models`, [
        `Current: ${currentRef}`,
        "",
        ...formatProviderModelLines(currentRef, request, providerModels, profiles)
      ]);
      return;
    }
    const selection = resolveModelSelection(request, registry.available);
    if (!selection.model) {
      ctx.ui.notify(selection.error ?? `Model not found: ${request}`, "error");
      return;
    }
    const changed = await pi.setModel(selection.model);
    if (!changed) {
      ctx.ui.notify(`Could not switch to ${modelRef(selection.model)}. Provider credentials may be unavailable.`, "error");
      return;
    }
    currentModelLabel = modelRef(selection.model);
    ctx.ui.setStatus("model", `Model: ${currentModelLabel}`);
    ctx.ui.notify(`Model set to ${currentModelLabel}`, "info");
  };
  const handleReasoningCommand = async (args, ctx) => {
    const request = args.trim();
    if (!request) {
      sendPanel(emitPanel, `${PANCODE_PRODUCT_NAME} Reasoning`, [
        `Preference: ${currentReasoningPreference}`,
        `Applied engine setting: ${pi.getThinkingLevel()}`,
        `Model: ${ctx.model ? modelRef(ctx.model) : "unresolved"}`,
        `Capability: ${describeReasoningCapability(ctx.model)}`,
        "PanCode values: off, on"
      ]);
      return;
    }
    const parsed = parseReasoningCommand(request);
    if (!parsed) {
      ctx.ui.notify(`Invalid reasoning value: ${request}. Use "off" or "on".`, "error");
      return;
    }
    currentReasoningPreference = parsed.preference;
    process.env.PANCODE_REASONING = currentReasoningPreference;
    const effectiveThinkingLevel = resolveThinkingLevelForPreference(ctx.model, currentReasoningPreference);
    process.env.PANCODE_EFFECTIVE_THINKING = effectiveThinkingLevel;
    pi.setThinkingLevel(effectiveThinkingLevel);
    persistSettings(
      { reasoningPreference: currentReasoningPreference },
      (message, level) => ctx.ui.notify(message, level)
    );
    if (parsed.note) {
      ctx.ui.notify(parsed.note, "warning");
    }
    const capability = describeReasoningCapability(ctx.model);
    ctx.ui.setStatus("thinking", `Reasoning: ${currentReasoningPreference} (${effectiveThinkingLevel})`);
    if (capability === "unsupported" && currentReasoningPreference === "on") {
      ctx.ui.notify("Reasoning preference saved. The current model leaves the engine setting at off.", "warning");
      return;
    }
    ctx.ui.notify(
      `Reasoning preference: ${currentReasoningPreference} | capability: ${capability} | applied: ${effectiveThinkingLevel}`,
      "info"
    );
  };
  const handlePreferencesCommand = async (args, ctx) => {
    const request = args.trim();
    if (!request || request === "list") {
      sendPanel(emitPanel, `${PANCODE_PRODUCT_NAME} Preferences`, [
        `Theme: ${ctx.ui.theme.name ?? currentThemeName}`,
        `Reasoning: ${currentReasoningPreference}`,
        `Preferred model: ${ctx.model ? modelRef(ctx.model) : "unresolved"}`,
        `Safety: ${process.env.PANCODE_SAFETY ?? "auto-edit"}`,
        "",
        "Subcommands:",
        "/settings",
        "/settings theme <name>",
        "/settings reasoning <off|on>",
        "/settings model <provider/model-id>"
      ]);
      return;
    }
    const [subcommand, ...rest] = request.split(/\s+/);
    const value = rest.join(" ").trim();
    switch (subcommand) {
      case "theme":
        await handleThemeCommand(value, ctx);
        return;
      case "reasoning":
        await handleReasoningCommand(value, ctx);
        return;
      case "model":
        await handleModelsCommand(value, ctx);
        return;
      default:
        ctx.ui.notify(`Unknown settings subcommand: ${subcommand}`, "error");
    }
  };
  const showDashboard = async (_args, ctx) => {
    const modelLabel = ctx.model ? modelRef(ctx.model) : "unresolved";
    const lines = [
      ...buildDashboardLines({
        modelLabel,
        reasoningPreference: currentReasoningPreference,
        reasoningCapability: describeReasoningCapability(ctx.model),
        effectiveThinkingLevel: pi.getThinkingLevel(),
        themeName: ctx.ui.theme.name ?? currentThemeName,
        workingDirectory: ctx.cwd,
        tools: pi.getActiveTools()
      }),
      "",
      `Safety: ${process.env.PANCODE_SAFETY ?? "auto-edit"}`,
      `Domains: ${process.env.PANCODE_ENABLED_DOMAINS ?? "unknown"}`
    ];
    const ledger2 = getRunLedger();
    if (ledger2) {
      const recentRuns = ledger2.getRecent(5);
      if (recentRuns.length > 0) {
        lines.push("", "Recent runs:");
        lines.push(...renderRunBoard(recentRuns));
      }
      const widget = buildTaskWidget(ledger2.getAll());
      const widgetLines = renderTaskWidget(widget);
      if (widget.activeRuns.length > 0 || widget.completedRuns > 0) {
        lines.push("", "Tasks:");
        lines.push(...widgetLines);
      }
    }
    const metrics = getMetricsLedger();
    if (metrics) {
      const summary = metrics.getSummary();
      if (summary.totalRuns > 0) {
        lines.push("", `Session cost: $${summary.totalCost.toFixed(4)} across ${summary.totalRuns} dispatches`);
      }
    }
    const budget = getBudgetTracker();
    if (budget) {
      const state = budget.getState();
      lines.push(`Budget: $${state.totalCost.toFixed(4)} / $${state.ceiling.toFixed(2)}`);
    }
    sendPanel(emitPanel, `${PANCODE_PRODUCT_NAME} Dashboard`, lines);
  };
  pi.on("session_start", (_event, ctx) => {
    currentModelLabel = ctx.model ? modelRef(ctx.model) : "no model";
    currentThemeName = ctx.ui.theme.name ?? currentThemeName;
    currentReasoningPreference = readReasoningPreference();
    sharedBus.on("pancode:warning", (payload) => {
      const event = payload;
      ctx.ui.notify(`[${event.source}] ${event.message}`, "warning");
    });
    const effectiveThinkingLevel = resolveThinkingLevelForPreference(ctx.model, currentReasoningPreference);
    process.env.PANCODE_EFFECTIVE_THINKING = effectiveThinkingLevel;
    pi.setThinkingLevel(effectiveThinkingLevel);
    ctx.ui.setTitle(PANCODE_PRODUCT_NAME);
    ctx.ui.setHeader((_tui, theme) => ({
      invalidate() {
      },
      render(width) {
        const left = `${theme.fg("accent", PANCODE_PRODUCT_NAME)} ${theme.fg("muted", process.env.PANCODE_PROFILE ?? "standard")}`;
        const right = theme.fg("dim", process.env.PANCODE_SAFETY ?? "auto-edit");
        return [composeSingleLine(left, right, width)];
      }
    }));
    ctx.ui.setWidget("pancode-dispatch-board", (_tui, theme) => {
      const container = new Container();
      const content = new Text("", 0, 0);
      container.addChild(content);
      let refreshTimer = null;
      function startTimer() {
        if (!refreshTimer) {
          refreshTimer = setInterval(() => container.invalidate(), 1e3);
        }
      }
      function stopTimer() {
        if (refreshTimer) {
          clearInterval(refreshTimer);
          refreshTimer = null;
        }
      }
      return {
        dispose() {
          stopTimer();
          resetAll();
        },
        invalidate() {
          container.invalidate();
        },
        render(width) {
          const ledger2 = getRunLedger();
          if (!ledger2) return [];
          const allRuns = ledger2.getAll();
          const liveWorkers2 = getLiveWorkers();
          if (liveWorkers2.length === 0 && allRuns.length === 0) return [];
          const active = liveWorkers2.map((w) => ({
            agent: w.agent,
            status: w.status,
            elapsedMs: Date.now() - w.startedAt,
            model: w.model,
            taskPreview: w.task,
            runId: w.runId,
            batchId: null,
            inputTokens: w.inputTokens > 0 ? w.inputTokens : void 0,
            outputTokens: w.outputTokens > 0 ? w.outputTokens : void 0,
            turns: w.turns > 0 ? w.turns : void 0
          }));
          const recent = allRuns.filter((r) => r.status !== "running" && r.status !== "pending").slice(-5).map((r) => ({
            agent: r.agent,
            status: r.status,
            elapsedMs: r.completedAt ? new Date(r.completedAt).getTime() - new Date(r.startedAt).getTime() : 0,
            model: r.model,
            taskPreview: r.task,
            runId: r.id,
            batchId: r.batchId,
            cost: r.usage.cost > 0 ? r.usage.cost : void 0
          }));
          const budget = getBudgetTracker();
          const metrics = getMetricsLedger();
          const summary = metrics?.getSummary();
          const metricsRuns = summary?.runs ?? [];
          const agentStats = computeAgentStats(metricsRuns);
          let totalCacheRead = 0;
          let totalCacheWrite = 0;
          for (const m of metricsRuns) {
            totalCacheRead += m.cacheReadTokens;
            totalCacheWrite += m.cacheWriteTokens;
          }
          const colorizer = {
            accent: (t) => theme.fg("accent", t),
            bold: (t) => theme.bold(t),
            muted: (t) => theme.fg("muted", t),
            dim: (t) => theme.fg("dim", t),
            success: (t) => theme.fg("success", t),
            error: (t) => theme.fg("error", t),
            warning: (t) => theme.fg("warning", t)
          };
          const lines = renderDispatchBoard(
            {
              active,
              recent,
              totalRuns: allRuns.length,
              totalCost: budget ? budget.getState().totalCost : 0,
              budgetCeiling: budget ? budget.getState().ceiling : null,
              totalInputTokens: summary?.totalInputTokens ?? 0,
              totalOutputTokens: summary?.totalOutputTokens ?? 0,
              totalCacheReadTokens: totalCacheRead > 0 ? totalCacheRead : void 0,
              totalCacheWriteTokens: totalCacheWrite > 0 ? totalCacheWrite : void 0,
              agentStats: agentStats.length > 0 ? agentStats : void 0
            },
            width,
            colorizer
          );
          content.setText(lines.join("\n"));
          const hasRunning = liveWorkers2.some((w) => w.status === "running");
          if (hasRunning) {
            startTimer();
          } else {
            stopTimer();
          }
          return container.render(width);
        }
      };
    });
    ctx.ui.setFooter((_tui, theme, _footerData) => ({
      invalidate() {
      },
      render(width) {
        const liveWorkers2 = getLiveWorkers();
        const activeCount = liveWorkers2.filter((w) => w.status === "running").length;
        const budget = getBudgetTracker();
        const budgetState = budget?.getState();
        const ledger2 = getRunLedger();
        const contextPercent = getContextPercent();
        const totalRuns = ledger2?.getAll().length ?? 0;
        const totalCost = budgetState?.totalCost ?? 0;
        const ceiling = budgetState?.ceiling ?? null;
        const modelPart = theme.fg("accent", ` ${currentModelLabel}`);
        const activityIcon = activeCount > 0 ? theme.fg("accent", " \u25CF") : theme.fg("dim", " \u25CB");
        const activityText = activeCount > 0 ? theme.fg("muted", ` ${activeCount} active`) : theme.fg("dim", " idle");
        const left = modelPart + activityIcon + activityText;
        const ctxFilled = Math.round(contextPercent / 10);
        const ctxBar = theme.fg("accent", "#".repeat(ctxFilled)) + theme.fg("dim", "-".repeat(10 - ctxFilled));
        const budgetStr = ceiling !== null ? `$${totalCost.toFixed(2)}/$${ceiling.toFixed(2)}` : `$${totalCost.toFixed(2)}`;
        const right = theme.fg("muted", `Runs: ${totalRuns}  ${budgetStr}  `) + theme.fg("dim", "[") + ctxBar + theme.fg("dim", "]") + theme.fg("muted", ` ${Math.round(contextPercent)}% `);
        const leftW = visibleWidth(left);
        const rightW = visibleWidth(right);
        const pad = " ".repeat(Math.max(1, width - leftW - rightW));
        return [truncateToWidth(left + pad + right, width)];
      }
    }));
    pi.on("message_end", (event, msgCtx) => {
      const msg = event.message;
      if (msg && "usage" in msg && msg.role === "assistant" && msgCtx.model?.contextWindow) {
        recordContextUsage(msg.usage.input ?? 0, msgCtx.model.contextWindow);
      }
    });
    sharedBus.on("pancode:run-started", (payload) => {
      const event = payload;
      trackWorkerStart(event.runId, event.agent, event.task, event.model);
    });
    sharedBus.on("pancode:worker-progress", (payload) => {
      const event = payload;
      updateWorkerProgress(event.runId, event.inputTokens, event.outputTokens, event.turns);
    });
    sharedBus.on("pancode:run-finished", (payload) => {
      const event = payload;
      trackWorkerEnd(event.runId, event.status);
    });
    if (!welcomeShown) {
      welcomeShown = true;
      sendPanel(emitPanel, `${PANCODE_PRODUCT_NAME} Dashboard`, buildDashboardLines({
        modelLabel: currentModelLabel,
        reasoningPreference: currentReasoningPreference,
        reasoningCapability: describeReasoningCapability(ctx.model),
        effectiveThinkingLevel,
        themeName: currentThemeName,
        workingDirectory: ctx.cwd,
        tools: pi.getActiveTools()
      }));
    }
  });
  pi.on("model_select", (event, ctx) => {
    currentModelLabel = modelRef(event.model);
    const effectiveThinkingLevel = resolveThinkingLevelForPreference(event.model, currentReasoningPreference);
    process.env.PANCODE_EFFECTIVE_THINKING = effectiveThinkingLevel;
    pi.setThinkingLevel(effectiveThinkingLevel);
    ctx.ui.setStatus("thinking", `Reasoning: ${currentReasoningPreference} (${pi.getThinkingLevel()})`);
    persistSettings(
      {
        preferredProvider: event.model.provider,
        preferredModel: event.model.id
      },
      (message, level) => ctx.ui.notify(message, level)
    );
  });
  pi.registerCommand("dashboard", {
    description: "Open the PanCode dashboard",
    handler: showDashboard
  });
  pi.registerCommand("status", {
    description: "Show the PanCode session summary",
    handler: showDashboard
  });
  pi.registerCommand("theme", {
    description: "Inspect or change the active PanCode theme",
    handler: handleThemeCommand
  });
  pi.registerCommand("models", {
    description: "List PanCode-visible models or switch by exact reference",
    handler: handleModelsCommand
  });
  pi.registerCommand("preferences", {
    description: "Show or change PanCode preferences",
    handler: handlePreferencesCommand
  });
  pi.registerCommand("reasoning", {
    description: "Inspect or change the PanCode reasoning preference",
    handler: handleReasoningCommand
  });
  pi.registerCommand("thinking", {
    description: "Backward-compatible alias for /reasoning",
    handler: handleReasoningCommand
  });
  pi.registerCommand("help", {
    description: "Show PanCode-owned commands",
    async handler(_args, _ctx) {
      sendPanel(emitPanel, `${PANCODE_PRODUCT_NAME} Commands`, formatShellCommandLines());
    }
  });
  pi.registerCommand("exit", {
    description: "Exit PanCode",
    async handler(_args, ctx) {
      ctx.shutdown();
    }
  });
});

// src/domains/ui/manifest.ts
var manifest8 = {
  name: "ui",
  dependsOn: ["dispatch", "agents", "session", "scheduling", "observability"]
};

// src/domains/index.ts
var DOMAIN_REGISTRY = {
  safety: {
    manifest: manifest5,
    extension: extension5
  },
  session: {
    manifest: manifest7,
    extension: extension7
  },
  agents: {
    manifest,
    extension
  },
  dispatch: {
    manifest: manifest2,
    extension: extension2
  },
  observability: {
    manifest: manifest3,
    extension: extension3
  },
  scheduling: {
    manifest: manifest6,
    extension: extension6
  },
  intelligence: {
    manifest: manifest4,
    extension: extension4
  },
  ui: {
    manifest: manifest8,
    extension: extension8
  }
};

// src/engine/shell-overrides.ts
import { BUILTIN_SLASH_COMMANDS } from "@pancode/pi-coding-agent/core/slash-commands.js";
var HIDDEN_BUILTIN_NAMES = /* @__PURE__ */ new Set(["model", "scoped-models"]);
var REBRANDED_DESCRIPTIONS = {
  settings: "Open PanCode preferences",
  quit: `Exit ${PANCODE_PRODUCT_NAME}`
};
function patchBuiltinCommands() {
  const commands = BUILTIN_SLASH_COMMANDS;
  for (let i = commands.length - 1; i >= 0; i--) {
    if (HIDDEN_BUILTIN_NAMES.has(commands[i].name)) {
      commands.splice(i, 1);
    }
  }
  for (const command of commands) {
    const description = REBRANDED_DESCRIPTIONS[command.name];
    if (description) {
      command.description = description;
    }
  }
}
async function routeToShellCommand(mode, command) {
  mode.editor.setText("");
  await mode.session.prompt(command);
  mode.updatePendingMessagesDisplay?.();
  mode.ui?.requestRender?.();
}
var installed = false;
function installPanCodeShellOverrides() {
  if (installed) return;
  installed = true;
  patchBuiltinCommands();
  const prototype = InteractiveMode.prototype;
  prototype.showSettingsSelector = function showSettingsSelector() {
    void routeToShellCommand(this, "/preferences");
  };
  prototype.handleModelCommand = async function handleModelCommand(searchTerm) {
    const suffix = searchTerm?.trim() ? ` ${searchTerm.trim()}` : "";
    await routeToShellCommand(this, `/models${suffix}`);
  };
  prototype.showModelsSelector = async function showModelsSelector() {
    await routeToShellCommand(this, "/models");
  };
}

// src/engine/shell.ts
var PanCodeInteractiveShell = class {
  productName = PANCODE_PRODUCT_NAME;
  mode;
  constructor(session, options = {}) {
    installPanCodeShellOverrides();
    this.mode = new InteractiveMode(session, {
      verbose: false,
      ...options
    });
  }
  async run() {
    await this.mode.run();
  }
  stop() {
    this.mode.stop();
  }
};

// src/engine/resources.ts
import {
  DefaultResourceLoader,
  SessionManager,
  SettingsManager
} from "@pancode/pi-coding-agent";

// src/entry/orchestrator.ts
function printUsage() {
  console.log(`Usage:
  npm start
  npm start -- --model anthropic/claude-opus-4-5

Options:
  --cwd <path>         Working directory for the session
  --provider <name>    Preferred provider for model resolution
  --model <id>         Model override, usually provider/model-id
  --profile <name>     Config profile name
  --safety <level>     suggest | auto-edit | full-auto
  --theme <name>       Pi TUI theme name
  --help               Show this help`);
}
function parseSafetyLevel(value) {
  switch (value) {
    case "suggest":
    case "auto-edit":
    case "full-auto":
      return value;
    default:
      return null;
  }
}
function parseArgs(argv) {
  const parsed = {
    cwd: null,
    model: null,
    provider: null,
    profile: null,
    safety: null,
    theme: null,
    help: false
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") {
      parsed.help = true;
      continue;
    }
    if (arg === "--cwd") {
      parsed.cwd = argv[++index] ?? null;
      continue;
    }
    if (arg === "--provider") {
      parsed.provider = argv[++index] ?? null;
      continue;
    }
    if (arg === "--model") {
      parsed.model = argv[++index] ?? null;
      continue;
    }
    if (arg === "--profile") {
      parsed.profile = argv[++index] ?? null;
      continue;
    }
    if (arg === "--theme") {
      parsed.theme = argv[++index] ?? null;
      continue;
    }
    if (arg === "--safety") {
      const value = parseSafetyLevel(argv[++index]);
      if (!value) throw new Error("Invalid --safety value. Use suggest, auto-edit, or full-auto.");
      parsed.safety = value;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }
  return parsed;
}
function resolveToolset(config) {
  return config.safety === "suggest" ? readOnlyTools : codingTools;
}
async function runOrchestratorEntry() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printUsage();
    return;
  }
  process.env.PI_SKIP_VERSION_CHECK = "1";
  const config = loadConfig({
    cwd: args.cwd ?? void 0,
    provider: args.provider,
    model: args.model,
    profile: args.profile ?? void 0,
    safety: args.safety ?? void 0,
    theme: args.theme ?? void 0
  });
  process.env.PANCODE_PROFILE = config.profile;
  process.env.PANCODE_SAFETY = config.safety;
  process.env.PANCODE_REASONING = config.reasoningPreference;
  process.env.PANCODE_THEME = config.theme;
  process.env.PANCODE_RUNTIME_ROOT = config.runtimeRoot;
  ensureProjectRuntime(config);
  const orderedDomains = resolveDomainOrder(config.domains, DOMAIN_REGISTRY);
  const extensionFactories = collectDomainExtensions(config.domains, DOMAIN_REGISTRY);
  process.env.PANCODE_ENABLED_DOMAINS = orderedDomains.map((domain) => domain.manifest.name).join(",");
  const { agentDir, authStorage, modelRegistry } = await createSharedAuth();
  registerApiProvidersOnRegistry(modelRegistry, config.cwd);
  const discoveryResults = await discoverEngines();
  writeProvidersYaml(discoveryResults, PANCODE_HOME);
  const packageRoot = resolvePackageRoot(import.meta.url);
  const modelsDir = join15(packageRoot, "models");
  const knowledgeBase = loadModelKnowledgeBase(modelsDir);
  const allDiscoveredModels = discoveryResults.flatMap((r) => r.models);
  const mergedProfiles = matchAllModels(allDiscoveredModels, knowledgeBase);
  setModelProfileCache(mergedProfiles);
  writeModelCacheYaml(mergedProfiles, PANCODE_HOME);
  registerDiscoveredModels(modelRegistry, mergedProfiles);
  ensureAgentsYaml(PANCODE_HOME);
  let model;
  let bootFallbackMessage;
  try {
    model = resolveConfiguredModel(modelRegistry, {
      provider: config.provider,
      model: config.model,
      preferredProvider: config.preferredProvider,
      preferredModel: config.preferredModel
    });
  } catch {
    bootFallbackMessage = "No models are available. Start a local engine (LM Studio :1234, Ollama :11434, llama-server :8080) or set ANTHROPIC_API_KEY / OPENAI_API_KEY and restart PanCode.";
    console.warn("[pancode:orchestrator] No models resolved at boot. Starting in degraded mode.");
  }
  const effectiveThinkingLevel = resolveThinkingLevelForPreference(model ?? null, config.reasoningPreference);
  process.env.PANCODE_EFFECTIVE_THINKING = effectiveThinkingLevel;
  const settingsManager = SettingsManager.inMemory({
    quietStartup: true,
    theme: config.theme
  });
  const eventBus = createSafeEventBus();
  const resourceLoader = new DefaultResourceLoader({
    cwd: config.cwd,
    agentDir,
    settingsManager,
    eventBus,
    extensionFactories,
    noExtensions: true,
    noSkills: true,
    noPromptTemplates: true,
    noThemes: true
  });
  await resourceLoader.reload();
  const sessionManager = SessionManager.create(config.cwd, join15(agentDir, "sessions"));
  const { session, modelFallbackMessage: sessionFallback } = await createAgentSession({
    cwd: config.cwd,
    model,
    thinkingLevel: effectiveThinkingLevel,
    tools: resolveToolset(config),
    authStorage,
    modelRegistry,
    resourceLoader,
    sessionManager,
    settingsManager
  });
  const shell = new PanCodeInteractiveShell(session, { modelFallbackMessage: bootFallbackMessage ?? sessionFallback });
  shutdownCoordinator.onTerminate(async () => {
    await stopAllWorkers();
    for (const result of discoveryResults) {
      result.connection.disconnect();
    }
    const runner = session.extensionRunner;
    if (runner?.hasHandlers("session_shutdown")) {
      await runner.emit({ type: "session_shutdown" });
    }
  });
  shutdownCoordinator.onExit(() => {
    shell.stop();
  });
  let sigTermHandled = false;
  const handleSigterm = async () => {
    if (sigTermHandled) return;
    sigTermHandled = true;
    await shutdownCoordinator.execute();
    process.exit(0);
  };
  process.on("SIGTERM", handleSigterm);
  try {
    await shell.run();
  } finally {
    process.off("SIGTERM", handleSigterm);
    if (!shutdownCoordinator.isDraining()) {
      await shutdownCoordinator.execute();
    }
  }
}
runOrchestratorEntry().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[pancode:orchestrator] ${message}`);
  process.exit(1);
});
export {
  runOrchestratorEntry
};
//# sourceMappingURL=orchestrator-IZUHGXVZ.js.map