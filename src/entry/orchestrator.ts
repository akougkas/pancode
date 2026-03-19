import { join } from "node:path";
import { type PanCodeConfig, type SafetyLevel, loadConfig } from "../core/config";
import { collectDomainExtensions, resolveDomainOrder } from "../core/domain-loader";
import { createSafeEventBus } from "../core/event-bus";
import { ensureProjectRuntime } from "../core/init";
import { resolvePackageRoot } from "../core/package-root";
import { shutdownCoordinator } from "../core/termination";
import { resolveThinkingLevelForPreference } from "../core/thinking";
import { DOMAIN_REGISTRY } from "../domains";
import { ensureAgentsYaml } from "../domains/agents/spec-registry";
import {
  PANCODE_HOME,
  createSharedAuth,
  discoverEngines,
  loadModelKnowledgeBase,
  matchAllModels,
  registerApiProvidersOnRegistry,
  registerDiscoveredModels,
  resolveConfiguredModel,
  setModelProfileCache,
  writeModelCacheYaml,
  writeProvidersYaml,
} from "../domains/providers";
import { DefaultResourceLoader, SessionManager, SettingsManager } from "../engine/resources";
import { codingTools, createAgentSession, readOnlyTools } from "../engine/session";
import { PanCodeInteractiveShell } from "../engine/shell";

interface ParsedArgs {
  cwd: string | null;
  model: string | null;
  provider: string | null;
  profile: string | null;
  safety: SafetyLevel | null;
  theme: string | null;
  help: boolean;
}

function printUsage(): void {
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

function parseSafetyLevel(value: string | undefined): SafetyLevel | null {
  switch (value) {
    case "suggest":
    case "auto-edit":
    case "full-auto":
      return value;
    default:
      return null;
  }
}

function parseArgs(argv: string[]): ParsedArgs {
  const parsed: ParsedArgs = {
    cwd: null,
    model: null,
    provider: null,
    profile: null,
    safety: null,
    theme: null,
    help: false,
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

function resolveToolset(config: PanCodeConfig) {
  return config.safety === "suggest" ? readOnlyTools : codingTools;
}

export async function runOrchestratorEntry(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printUsage();
    return;
  }

  process.env.PI_SKIP_VERSION_CHECK = "1";

  const config = loadConfig({
    cwd: args.cwd ?? undefined,
    provider: args.provider,
    model: args.model,
    profile: args.profile ?? undefined,
    safety: args.safety ?? undefined,
    theme: args.theme ?? undefined,
  });

  process.env.PANCODE_PROFILE = config.profile;
  process.env.PANCODE_SAFETY = config.safety;
  process.env.PANCODE_REASONING = config.reasoningPreference;
  process.env.PANCODE_THEME = config.theme;
  process.env.PANCODE_RUNTIME_ROOT = config.runtimeRoot;

  ensureProjectRuntime(config);

  // === Bootstrap Phase 1: Domain resolution ===
  const orderedDomains = resolveDomainOrder(config.domains, DOMAIN_REGISTRY);
  const extensionFactories = collectDomainExtensions(config.domains, DOMAIN_REGISTRY);
  process.env.PANCODE_ENABLED_DOMAINS = orderedDomains.map((domain) => domain.manifest.name).join(",");

  // === Bootstrap Phase 2: Auth & API providers ===
  const { agentDir, authStorage, modelRegistry } = await createSharedAuth();
  registerApiProvidersOnRegistry(modelRegistry, config.cwd);

  // === Bootstrap Phase 3: Engine discovery via native SDKs ===
  const discoveryResults = await discoverEngines();
  writeProvidersYaml(discoveryResults, PANCODE_HOME);

  // === Bootstrap Phase 4: Model matching against knowledge base ===
  const packageRoot = resolvePackageRoot(import.meta.url);
  const modelsDir = join(packageRoot, "models");
  const knowledgeBase = loadModelKnowledgeBase(modelsDir);

  const allDiscoveredModels = discoveryResults.flatMap((r) => r.models);
  const mergedProfiles = matchAllModels(allDiscoveredModels, knowledgeBase);
  setModelProfileCache(mergedProfiles);
  writeModelCacheYaml(mergedProfiles, PANCODE_HOME);

  // === Bootstrap Phase 5: Register with Pi AI ModelRegistry ===
  registerDiscoveredModels(modelRegistry, mergedProfiles);

  // === Bootstrap Phase 6: Agent config ===
  ensureAgentsYaml(PANCODE_HOME);

  // === Resolve model ===
  // Failure here is non-fatal: no local engines and no API keys means no models at boot.
  // PanCode starts in degraded mode and surfaces the issue in the shell rather than crashing.
  let model: Awaited<ReturnType<typeof resolveConfiguredModel>> | undefined;
  let bootFallbackMessage: string | undefined;
  try {
    model = resolveConfiguredModel(modelRegistry, {
      provider: config.provider,
      model: config.model,
      preferredProvider: config.preferredProvider,
      preferredModel: config.preferredModel,
    });
  } catch {
    bootFallbackMessage =
      "No models are available. Start a local engine (LM Studio :1234, Ollama :11434, " +
      "llama-server :8080) or set ANTHROPIC_API_KEY / OPENAI_API_KEY and restart PanCode.";
    console.warn("[pancode:orchestrator] No models resolved at boot. Starting in degraded mode.");
  }
  const effectiveThinkingLevel = resolveThinkingLevelForPreference(model ?? null, config.reasoningPreference);
  process.env.PANCODE_EFFECTIVE_THINKING = effectiveThinkingLevel;

  // === Session setup ===
  const settingsManager = SettingsManager.inMemory({
    quietStartup: true,
    theme: config.theme,
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
    noThemes: true,
  });
  await resourceLoader.reload();

  const sessionManager = SessionManager.create(config.cwd, join(agentDir, "sessions"));
  const { session, modelFallbackMessage: sessionFallback } = await createAgentSession({
    cwd: config.cwd,
    model,
    thinkingLevel: effectiveThinkingLevel,
    tools: resolveToolset(config),
    authStorage,
    modelRegistry,
    resourceLoader,
    sessionManager,
    settingsManager,
  });

  // Prefer the boot fallback message (no models at all) over any session-level fallback.
  const shell = new PanCodeInteractiveShell(session, { modelFallbackMessage: bootFallbackMessage ?? sessionFallback });

  shutdownCoordinator.onTerminate(async () => {
    // Disconnect engine connections after domain terminate handlers run.
    for (const result of discoveryResults) {
      result.connection.disconnect();
    }
  });

  shutdownCoordinator.onPersist(async () => {
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
