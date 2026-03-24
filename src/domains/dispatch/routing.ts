import { BusChannel, type WarningEvent } from "../../core/bus-events";
import { sharedBus } from "../../core/shared-bus";
import { runtimeRegistry } from "../../engine/runtimes/registry";
import { agentRegistry } from "../agents";
import { workerPool } from "../agents/worker-pool";
import { classifyModelTier, deriveProviderHint } from "../prompts/tiering";
import { type SamplingPreset, findModelProfile, getSamplingPreset } from "../providers";

export interface WorkerRouting {
  model: string | null;
  tools: string;
  systemPrompt: string;
  sampling: SamplingPreset | null;
  runtime: string; // Runtime ID from agent spec
  runtimeArgs: string[]; // Extra args from agent spec
  readonly: boolean; // From agent spec
  workerId: string | null; // PanWorker ID if resolved from pool
}

function getWorkerModel(): string | null {
  return process.env.PANCODE_WORKER_MODEL?.trim() || null;
}

function getWorkerRuntime(): string {
  return process.env.PANCODE_WORKER_RUNTIME?.trim() || "pi";
}

function resolveModelSampling(model: string | null, presetName: string | undefined): SamplingPreset | null {
  if (!model || !presetName) return null;

  // model is "provider/model-id"
  const slashIndex = model.indexOf("/");
  if (slashIndex === -1) return null;

  const providerId = model.slice(0, slashIndex);
  const modelId = model.slice(slashIndex + 1);

  const sampling = getSamplingPreset(providerId, modelId, presetName) ?? null;
  if (!sampling) {
    // Missing presets are expected for local models that have no sampling profiles.
    // Log at debug level to stderr only; do not surface in the TUI.
    console.error(
      `[pancode:routing] Sampling preset "${presetName}" not found for ${providerId}/${modelId}. Using model defaults.`,
    );
  }
  return sampling;
}

/**
 * Infer the runtime from the model's provider prefix.
 * Anthropic models (prefix "anthropic/") must use cli:claude-code since they cannot be served
 * by the Pi native runtime or local engines.
 */
function inferRuntimeFromModel(model: string | null): string | null {
  if (!model) return null;

  const slashIdx = model.indexOf("/");
  if (slashIdx === -1) return null;

  const provider = model.slice(0, slashIdx);

  // Map known cloud providers to their CLI runtimes
  const providerToRuntime: Record<string, string> = {
    anthropic: "cli:claude-code",
    "openai-codex": "cli:codex",
  };

  return providerToRuntime[provider] ?? null;
}

/**
 * Resolve the runtime for a worker dispatch.
 *
 * Resolution order:
 * 1. Explicit spec runtime (if not the default "pi")
 * 2. Configured worker runtime from settings/env (PANCODE_WORKER_RUNTIME)
 * 3. Inferred from model provider prefix
 * 4. Default "pi"
 */
function resolveRuntime(model: string | null, specRuntime: string): string {
  if (specRuntime !== "pi") return specRuntime;

  const configuredRuntime = getWorkerRuntime();
  if (configuredRuntime !== "pi") return configuredRuntime;

  return inferRuntimeFromModel(model) ?? "pi";
}

export function resolveWorkerRouting(agentName: string): WorkerRouting {
  const spec = agentRegistry.get(agentName);
  const workerModel = getWorkerModel();

  if (!spec) {
    const fallbackRuntime = resolveRuntime(workerModel, "pi");
    return {
      model: workerModel,
      tools: "read,bash,grep,find,ls,write,edit",
      systemPrompt: "",
      sampling: null,
      runtime: fallbackRuntime,
      runtimeArgs: [],
      readonly: false,
      workerId: null,
    };
  }

  const model = spec.model ?? workerModel;
  const sampling = resolveModelSampling(model, spec.sampling);

  // Warn if the agent needs tools but the resolved model may not support tool calling.
  if (model && spec.tools) {
    const slashIdx = model.indexOf("/");
    if (slashIdx !== -1) {
      const profile = findModelProfile(model.slice(0, slashIdx), model.slice(slashIdx + 1));
      if (profile && profile.capabilities.toolCalling === false) {
        const message = `Model ${model} may not support tool calling. Agent "${agentName}" requires tools: ${spec.tools}`;
        console.error(`[pancode:dispatch] ${message}`);
        sharedBus.emit(BusChannel.WARNING, { source: "dispatch", message } satisfies WarningEvent);
      }
    }
  }

  // Tier advisory: warn when the resolved model is below the agent's recommended tier.
  if (spec.tier !== "any" && model) {
    const slashIdx = model.indexOf("/");
    if (slashIdx !== -1) {
      const profile = findModelProfile(model.slice(0, slashIdx), model.slice(slashIdx + 1));
      if (profile) {
        const hint = deriveProviderHint(model.slice(0, slashIdx));
        const modelTier = classifyModelTier(profile.capabilities, hint, profile.family);
        const tierRank: Record<string, number> = { frontier: 3, mid: 2, small: 1 };
        const requiredRank = tierRank[spec.tier] ?? 0;
        const actualRank = tierRank[modelTier] ?? 0;
        if (actualRank < requiredRank) {
          const message = `Agent "${agentName}" recommends tier "${spec.tier}" but model ${model} is "${modelTier}". Results may be degraded.`;
          console.error(`[pancode:routing] ${message}`);
          sharedBus.emit(BusChannel.WARNING, { source: "dispatch", message } satisfies WarningEvent);
          if (process.env.PANCODE_STRICT_TIERS === "1") {
            throw new Error(`Dispatch blocked: ${message}`);
          }
        }
      }
    }
  }

  // Consult the worker pool for the best available worker (advisory).
  const bestWorker = workerPool.bestForAgent(agentName);
  const workerId = bestWorker?.id ?? null;

  // If the pool has a better model suggestion, log it (advisory only).
  if (bestWorker?.model && !spec.model) {
    console.error(
      `[pancode:routing] Pool suggests model ${bestWorker.model} for ${agentName} (score: ${bestWorker.score.overall.toFixed(3)})`,
    );
  }

  const resolvedRuntime = resolveRuntime(model, spec.runtime);

  // Verify the inferred runtime is actually available before using it.
  if (resolvedRuntime !== "pi" && resolvedRuntime !== spec.runtime) {
    if (!runtimeRegistry.has(resolvedRuntime)) {
      const message = `Inferred runtime "${resolvedRuntime}" for model ${model} is not available. Falling back to "${spec.runtime}".`;
      console.error(`[pancode:routing] ${message}`);
      sharedBus.emit(BusChannel.WARNING, { source: "dispatch", message } satisfies WarningEvent);
    }
  }

  return {
    model,
    tools: spec.tools,
    systemPrompt: spec.systemPrompt,
    sampling,
    runtime: runtimeRegistry.has(resolvedRuntime) ? resolvedRuntime : spec.runtime,
    runtimeArgs: spec.runtimeArgs,
    readonly: spec.readonly,
    workerId,
  };
}
