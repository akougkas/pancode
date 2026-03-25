import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import { resetRuntimeState } from "../cli/reset";
import { type BootPhaseRecord, setBootTimings } from "../core/boot-timing";
import { type PanCodeConfig, type SafetyLevel, loadConfig } from "../core/config";
import { atomicWriteJsonSync } from "../core/config-writer";
import { DEFAULT_STARTUP_BUDGET_MS } from "../core/defaults";
import { collectDomainExtensions, filterValidDomains, resolveDomainOrder } from "../core/domain-loader";
import { createSafeEventBus } from "../core/event-bus";
import { ensureProjectRuntime } from "../core/init";
import { resolvePackageRoot } from "../core/package-root";
import { ensurePresetsFile, loadPreset } from "../core/presets";
import { installSigintDoubleTap, shutdownCoordinator } from "../core/termination";
import { type PanCodeReasoningPreference, resolveThinkingLevelForPreference } from "../core/thinking";
import { DOMAIN_REGISTRY } from "../domains";
import { ensureAgentsYaml } from "../domains/agents/spec-registry";
import {
  type MergedModelProfile,
  PANCODE_HOME,
  createSharedAuth,
  discoverEngines,
  loadModelKnowledgeBase,
  loadRegistryMetadata,
  matchAllModels,
  readModelCacheYaml,
  registerAnthropicModels,
  registerApiProvidersOnRegistry,
  registerDiscoveredModels,
  registerOpenAICodexModels,
  resolveConfiguredModel,
  setModelProfileCache,
  setRegistryMetadata,
  writeModelCacheYaml,
  writeProvidersYaml,
} from "../domains/providers";
import type { DiscoveryResult } from "../domains/providers";
import { DefaultResourceLoader, SessionManager, SettingsManager } from "../engine/resources";
import { codingTools, createAgentSession, readOnlyTools } from "../engine/session";
import { PanCodeInteractiveShell } from "../engine/shell";

interface ParsedArgs {
  cwd: string | null;
  model: string | null;
  provider: string | null;
  profile: string | null;
  preset: string | null;
  safety: SafetyLevel | null;
  theme: string | null;
  rediscover: boolean;
  fresh: boolean;
  help: boolean;
}

function printUsage(): void {
  console.log(`Usage:
  pancode
  pancode --preset openai
  pancode --model provider/model-id

Options:
  --preset <name>      Boot preset (local, openai, openai-max, hybrid)
  --cwd <path>         Working directory for the session
  --provider <name>    Preferred provider for model resolution
  --model <id>         Model override, usually provider/model-id
  --profile <name>     Config profile name
  --safety <level>     suggest | auto-edit | full-auto
  --theme <name>       Pi TUI theme name
  --rediscover         Force full engine discovery (ignore cache)
  --fresh              Clear runtime state (runs, metrics, sessions) before boot
  --help               Show this help

Presets are defined in ~/.pancode/panpresets.yaml. Edit freely.`);
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
    preset: null,
    safety: null,
    theme: null,
    rediscover: false,
    fresh: false,
    help: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--help" || arg === "-h") {
      parsed.help = true;
      continue;
    }
    if (arg === "--rediscover") {
      parsed.rediscover = true;
      continue;
    }
    if (arg === "--fresh") {
      parsed.fresh = true;
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
    if (arg === "--preset") {
      parsed.preset = argv[++index] ?? null;
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

function resolveToolset(config: PanCodeConfig): typeof codingTools {
  return config.safety === "suggest" ? readOnlyTools : codingTools;
}

// Boot performance instrumentation. Always-on to stderr.
//
// Measurements (2026-03-21, zbook, 3 machines x 3 services, 4 dead endpoints):
//   ORIGINAL:  avg 3183ms (PROBE_TIMEOUT_MS=3000, WebSocket SDK enrichment)
//   OPTIMIZED: avg 1150ms (tiered probes 500/1000ms, native API, parallel show)
//   CACHED:    avg  120ms (warm boot from model-cache.yaml, zero network I/O)
interface BootPhase {
  name: string;
  label: string;
  startMs: number;
  endMs: number;
}

function printBootTimingTable(mode: "warm" | "cold", phases: BootPhase[]): void {
  process.stderr.write(`[pancode:boot] mode: ${mode}\n`);
  const maxName = Math.max(...phases.map((p) => p.name.length));
  const maxLabel = Math.max(...phases.map((p) => p.label.length));
  let total = 0;
  for (const phase of phases) {
    const elapsed = phase.endMs - phase.startMs;
    total += elapsed;
    const namePad = phase.name.padEnd(maxName);
    const labelPad = " ".repeat(maxLabel - phase.label.length);
    const flag = elapsed > 500 ? "  <<<" : "";
    process.stderr.write(
      `[pancode:boot] ${namePad}  ${phase.label}:${labelPad} ${elapsed.toFixed(0).padStart(6)}ms${flag}\n`,
    );
  }
  process.stderr.write(`[pancode:boot] ${"TOTAL:".padEnd(maxName + maxLabel + 3)} ${total.toFixed(0).padStart(6)}ms\n`);
}

// Full discovery: probe endpoints, match against knowledge base, write cache.
// Used by cold boot and background refresh.
async function runFullDiscovery(): Promise<{ results: DiscoveryResult[]; profiles: MergedModelProfile[] }> {
  const results = await discoverEngines();
  writeProvidersYaml(results, PANCODE_HOME);

  const packageRoot = resolvePackageRoot(import.meta.url);
  const modelsDir = join(packageRoot, "models");
  const knowledgeBase = loadModelKnowledgeBase(modelsDir);
  const registry = loadRegistryMetadata(modelsDir);
  setRegistryMetadata(registry);

  const allModels = results.flatMap((r) => r.models);
  const profiles = matchAllModels(allModels, knowledgeBase, registry);
  writeModelCacheYaml(profiles, PANCODE_HOME);

  return { results, profiles };
}

/**
 * Scan the run ledger for entries left in "running" or "pending" status from a
 * previous session. Since we are booting fresh, those workers no longer exist.
 * Mark them "interrupted" so the ledger accurately reflects reality.
 *
 * Operates directly on the JSON file to avoid importing domain code.
 */
function reapOrphanRuns(runtimeRoot: string): void {
  const runsPath = join(runtimeRoot, "runs.json");
  if (!existsSync(runsPath)) return;

  let entries: unknown[];
  try {
    const raw = readFileSync(runsPath, "utf8");
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      console.error("[pancode:boot] Corrupt runs.json (not an array). Will be recreated on first dispatch.");
      return;
    }
    entries = parsed;
  } catch {
    console.error("[pancode:boot] Corrupt runs.json (parse failed). Will be recreated on first dispatch.");
    return;
  }

  const now = new Date().toISOString();
  let reaped = 0;

  for (const entry of entries) {
    if (typeof entry !== "object" || entry === null) continue;
    const record = entry as Record<string, unknown>;
    // Skip session boundary markers (they have type "session_start" / "session_end").
    if (record.type === "session_start" || record.type === "session_end") continue;
    if (record.status === "running" || record.status === "pending") {
      record.status = "interrupted";
      record.completedAt = now;
      reaped++;
    }
  }

  if (reaped > 0) {
    try {
      atomicWriteJsonSync(runsPath, entries);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[pancode:boot] Failed to persist orphan cleanup: ${msg}`);
    }
    console.error(`[pancode:boot] Reaped ${reaped} orphaned run(s) from previous session.`);
  }
}

export async function runOrchestratorEntry(): Promise<void> {
  // Top-level crash handlers: log the actual error and write to crash.log
  // before exiting. Prevents silent restarts under context pressure or API errors.
  const crashLogPath = join(process.env.PANCODE_HOME ?? "", "crash.log");

  process.on("uncaughtException", (err) => {
    const ts = new Date().toISOString();
    const msg = `[pancode:crash] Uncaught exception at ${ts}: ${err.message}\n${err.stack}`;
    process.stderr.write(`${msg}\n`);
    try {
      appendFileSync(crashLogPath, `\n${msg}\n`);
    } catch {
      /* ignore */
    }
    // Attempt graceful shutdown so workers are killed and state is persisted.
    // If the coordinator is already running or hangs, the 5-second fallback
    // forces an exit to avoid leaving the process in a broken state.
    const forceExitTimer = setTimeout(() => process.exit(1), 5000);
    forceExitTimer.unref();
    shutdownCoordinator
      .execute()
      .catch(() => {})
      .finally(() => process.exit(1));
  });

  process.on("unhandledRejection", (reason) => {
    const ts = new Date().toISOString();
    const detail = reason instanceof Error ? (reason.stack ?? reason.message) : String(reason);
    const msg = `[pancode:crash] Unhandled rejection at ${ts}: ${detail}`;
    process.stderr.write(`${msg}\n`);
    try {
      appendFileSync(crashLogPath, `\n${msg}\n`);
    } catch {
      /* ignore */
    }
    const forceExitTimer = setTimeout(() => process.exit(1), 5000);
    forceExitTimer.unref();
    shutdownCoordinator
      .execute()
      .catch(() => {})
      .finally(() => process.exit(1));
  });

  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printUsage();
    return;
  }

  // Pi SDK interop environment variables.
  // These control the vendored Pi SDK and must keep their PI_* prefix.
  // PanCode-owned env vars use the PANCODE_* prefix exclusively.
  process.env.PI_SKIP_VERSION_CHECK = "1";

  // Resolve preset before config so preset values feed into overrides.
  // CLI flags (--model, --safety) take precedence over preset values.
  let presetModel: string | null = null;
  let presetSafety: SafetyLevel | undefined;
  let presetReasoning: string | undefined;
  let presetWorkerModel: string | null = null;
  let presetScoutModel: string | null = null;

  // Ensure panpresets.yaml exists (seeds defaults on first run).
  // PANCODE_HOME is set by loader.ts before this entry point runs.
  const pancodeHomeForPresets = process.env.PANCODE_HOME;
  if (pancodeHomeForPresets) {
    ensurePresetsFile(pancodeHomeForPresets);
  }

  if (args.preset && pancodeHomeForPresets) {
    const preset = loadPreset(pancodeHomeForPresets, args.preset);
    if (!preset) {
      console.error(`[pancode] Unknown preset: ${args.preset}. Check ~/.pancode/panpresets.yaml`);
      process.exit(1);
    }
    presetModel = preset.model;
    presetSafety = preset.safety;
    presetReasoning = preset.reasoning;
    presetWorkerModel = preset.workerModel;
    presetScoutModel = preset.scoutModel;
    process.env.PANCODE_PRESET = args.preset;
    console.log(`[pancode] Preset: ${args.preset} (${preset.description})`);
  }

  const config = loadConfig({
    cwd: args.cwd ?? undefined,
    provider: args.provider,
    model: args.model ?? presetModel ?? undefined,
    profile: args.profile ?? undefined,
    safety: args.safety ?? presetSafety ?? undefined,
    reasoningPreference: presetReasoning as PanCodeReasoningPreference | undefined,
    theme: args.theme ?? undefined,
  });

  // Apply preset worker and scout models. When the user explicitly passes
  // --preset, preset values override any .env defaults.
  if (presetWorkerModel) {
    process.env.PANCODE_WORKER_MODEL = presetWorkerModel;
  }
  if (presetScoutModel) {
    process.env.PANCODE_SCOUT_MODEL = presetScoutModel;
  }

  process.env.PANCODE_PROFILE = config.profile;
  process.env.PANCODE_SAFETY = config.safety;
  process.env.PANCODE_REASONING = config.reasoningPreference;
  process.env.PANCODE_THEME = config.theme;
  process.env.PANCODE_RUNTIME_ROOT = config.runtimeRoot;

  // --fresh: wipe runtime state before boot so the dashboard starts clean.
  if (args.fresh) {
    console.log("[pancode] --fresh: clearing runtime state...");
    resetRuntimeState(config.packageRoot, { quiet: false });
  }

  ensureProjectRuntime(config);

  // Reap orphaned runs from a previous session before domains initialize.
  // Any runs left in "running" or "pending" from a crashed or killed session
  // are marked "interrupted" so the ledger is accurate at boot.
  // RunLedger stores runs.json in <packageRoot>/.pancode/ (not the runtime/ subdir).
  reapOrphanRuns(join(config.packageRoot, ".pancode"));

  const bootPhases: BootPhase[] = [];

  function phase(name: string, label: string): { end: () => void } {
    const startMs = performance.now();
    return {
      end() {
        bootPhases.push({ name, label, startMs, endMs: performance.now() });
      },
    };
  }

  // === Bootstrap Phase 1: Domain resolution ===
  const p1 = phase("Phase 1", "domains");
  const validDomains = filterValidDomains(config.domains, DOMAIN_REGISTRY);
  const orderedDomains = resolveDomainOrder(validDomains, DOMAIN_REGISTRY);
  const extensionFactories = collectDomainExtensions(validDomains, DOMAIN_REGISTRY);
  process.env.PANCODE_ENABLED_DOMAINS = orderedDomains.map((domain) => domain.manifest.name).join(",");
  p1.end();

  // === Bootstrap Phase 2: Auth & API providers ===
  const p2 = phase("Phase 2", "auth");
  const { agentDir, authStorage, modelRegistry } = await createSharedAuth();
  registerApiProvidersOnRegistry(modelRegistry, config.cwd);
  p2.end();

  // === Phase 3: Model loading (warm from cache or cold via discovery) ===
  // --rediscover forces cold boot regardless of cache state.
  let mergedProfiles: MergedModelProfile[];
  let discoveryConnections: DiscoveryResult[] = [];
  let bootMode: "warm" | "cold";

  const cachedProfiles = args.rediscover ? null : readModelCacheYaml(PANCODE_HOME);

  if (cachedProfiles) {
    bootMode = "warm";
    const p3 = phase("Phase 3", "cache-load");
    mergedProfiles = cachedProfiles;
    setModelProfileCache(mergedProfiles);
    registerDiscoveredModels(modelRegistry, mergedProfiles);
    p3.end();
  } else {
    bootMode = "cold";
    const p3 = phase("Phase 3", "discovery");
    const { results, profiles } = await runFullDiscovery();
    discoveryConnections = results;
    mergedProfiles = profiles;
    setModelProfileCache(mergedProfiles);
    registerDiscoveredModels(modelRegistry, mergedProfiles);
    p3.end();
  }

  // === Phase 3b: Anthropic catalog (Claude CLI auth detection) ===
  const anthropicResult = registerAnthropicModels(modelRegistry);
  if (anthropicResult.auth) {
    console.error(
      `[pancode:providers] Anthropic: ${anthropicResult.registered.length} models registered ` +
        `(${anthropicResult.auth.subscriptionType ?? "unknown"} via ${anthropicResult.auth.authMethod ?? "unknown"})`,
    );
  }

  // === Phase 3c: OpenAI Codex catalog (Codex CLI auth detection) ===
  const codexResult = registerOpenAICodexModels(modelRegistry);
  if (codexResult.auth?.authenticated) {
    console.error(`[pancode:providers] OpenAI Codex: ${codexResult.registered.length} models registered`);
  }

  // === Phase 4: Agent config ===
  const p4 = phase("Phase 4", "agents");
  ensureAgentsYaml(PANCODE_HOME);
  p4.end();

  // === Phase 5: Model resolution ===
  const p5 = phase("Phase 5", "model-resolve");
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
  } catch (primaryErr) {
    // The configured model failed to resolve. Before entering degraded mode,
    // check if the registry has any available models at all (e.g. API fallbacks).
    const anyAvailable = modelRegistry.getAvailable();
    if (anyAvailable.length > 0) {
      try {
        model = resolveConfiguredModel(modelRegistry, {});
        const ref = `${model.provider}/${model.id}`;
        bootFallbackMessage = `Configured model unavailable. Using API fallback: ${ref}. Run /models to see all available models.`;
        console.warn(`[pancode:orchestrator] No local models; using API fallback: ${ref}`);
      } catch {
        // Broader resolution also failed (e.g. auth issue). Fall through to degraded mode.
        model = undefined;
      }
    }

    if (!model) {
      bootFallbackMessage =
        "No models are available. Start a local engine (LM Studio :1234, Ollama :11434, " +
        "llama-server :8080) or set ANTHROPIC_API_KEY / OPENAI_API_KEY and restart PanCode.";
      console.warn("[pancode:orchestrator] No models resolved at boot. Starting in degraded mode.");
    }
  }
  // Defensive context window fallback: if the resolved model has no context window
  // (0 or missing), apply a conservative default so the Pi SDK's internal context
  // management does not operate blindly. This prevents crashes under context pressure
  // when the SDK cannot track usage against a known limit.
  const DEFAULT_API_CONTEXT_WINDOW = 128_000;
  if (model && (!model.contextWindow || model.contextWindow <= 0)) {
    console.warn(
      `[pancode:orchestrator] Model "${model.id}" has contextWindow=${model.contextWindow}. ` +
        `Applying default of ${DEFAULT_API_CONTEXT_WINDOW}.`,
    );
    (model as { contextWindow: number }).contextWindow = DEFAULT_API_CONTEXT_WINDOW;
  }

  const effectiveThinkingLevel = resolveThinkingLevelForPreference(model ?? null, config.reasoningPreference);
  process.env.PANCODE_EFFECTIVE_THINKING = effectiveThinkingLevel;
  p5.end();

  // === Phase 6: Resource loader ===
  const p6 = phase("Phase 6", "resource-loader");
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
  p6.end();

  // === Phase 7: Session creation ===
  const p7 = phase("Phase 7", "session");
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
  p7.end();

  // === Phase 8: Shell startup ===
  const p8 = phase("Phase 8", "shell-init");
  const shell = new PanCodeInteractiveShell(session, {
    modelFallbackMessage: bootFallbackMessage ?? sessionFallback,
  });
  p8.end();

  printBootTimingTable(bootMode, bootPhases);

  // Export boot timing data so the /perf command can display it.
  const phaseRecords: BootPhaseRecord[] = bootPhases.map((p) => ({
    name: p.name,
    label: p.label,
    durationMs: p.endMs - p.startMs,
  }));
  const totalBootMs = phaseRecords.reduce((sum, p) => sum + p.durationMs, 0);
  const budgetMs = Number.parseInt(process.env.PANCODE_STARTUP_BUDGET_MS ?? "", 10) || DEFAULT_STARTUP_BUDGET_MS;
  const budgetExceeded = totalBootMs > budgetMs;

  setBootTimings({
    mode: bootMode,
    phases: phaseRecords,
    totalMs: totalBootMs,
    budgetMs,
    budgetExceeded,
  });

  if (budgetExceeded) {
    const slowest = phaseRecords.reduce((a, b) => (b.durationMs > a.durationMs ? b : a));
    process.stderr.write(
      `[pancode:boot] WARNING: Startup took ${totalBootMs.toFixed(0)}ms, exceeding budget of ${budgetMs}ms. ` +
        `Slowest phase: ${slowest.label} (${slowest.durationMs.toFixed(0)}ms).\n`,
    );
  }

  // -----------------------------------------------------------------------
  // Background discovery (warm boot only)
  // -----------------------------------------------------------------------
  // After the shell is interactive, refresh the provider cache so the NEXT
  // boot uses fresh data. Does not modify the current session's model
  // registry to avoid mid-session instability.
  let backgroundConnections: DiscoveryResult[] = [];

  if (bootMode === "warm") {
    const bgRefresh = async () => {
      try {
        const { results, profiles } = await runFullDiscovery();
        backgroundConnections = results;
        setModelProfileCache(profiles);

        const cachedCount = mergedProfiles.length;
        const freshCount = profiles.length;
        if (cachedCount !== freshCount) {
          process.stderr.write(
            `[pancode:boot] Background refresh: ${freshCount} models (was ${cachedCount}). Changes take effect on next boot or with --rediscover.\n`,
          );
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        process.stderr.write(`[pancode:boot] Background refresh failed: ${msg}\n`);
      }
    };

    // Delay 500ms to avoid contention with initial TUI render.
    setTimeout(() => void bgRefresh(), 500);
  }

  // -----------------------------------------------------------------------
  // Shutdown handlers
  // -----------------------------------------------------------------------

  shutdownCoordinator.onTerminate(async () => {
    for (const result of [...discoveryConnections, ...backgroundConnections]) {
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

  // Install SIGINT double-tap: first Ctrl+C gracefully shuts down,
  // second Ctrl+C within 3 seconds forces immediate exit.
  const removeSigintHandler = installSigintDoubleTap(shutdownCoordinator);

  process.on("SIGTERM", handleSigterm);
  try {
    await shell.run();
  } catch (sessionErr) {
    // Session-level errors (context pressure, API failures, SDK crashes)
    // are caught here instead of propagating to the top-level handler.
    // Log diagnostic details and proceed to graceful shutdown.
    const errMsg = sessionErr instanceof Error ? sessionErr.message : String(sessionErr);
    const errStack = sessionErr instanceof Error ? sessionErr.stack : undefined;
    process.stderr.write(`[pancode:session] Session terminated with error: ${errMsg}\n`);
    if (errStack) {
      process.stderr.write(`${errStack}\n`);
    }
    try {
      const ts = new Date().toISOString();
      appendFileSync(crashLogPath, `\n[${ts}] Session error: ${errMsg}\n${errStack ?? ""}\n`);
    } catch {
      /* ignore */
    }
  } finally {
    removeSigintHandler();
    process.off("SIGTERM", handleSigterm);
    if (!shutdownCoordinator.isDraining()) {
      await shutdownCoordinator.execute();
    }
  }
}

runOrchestratorEntry().catch((error) => {
  const crashLogPath = join(process.env.PANCODE_HOME ?? "", "crash.log");
  const message = error instanceof Error ? error.message : String(error);
  const stack = error instanceof Error ? error.stack : undefined;
  console.error(`[pancode:orchestrator] Fatal: ${message}`);
  try {
    const ts = new Date().toISOString();
    appendFileSync(crashLogPath, `\n[${ts}] Fatal: ${message}\n${stack ?? ""}\n`);
  } catch {
    /* ignore */
  }
  process.exit(1);
});
