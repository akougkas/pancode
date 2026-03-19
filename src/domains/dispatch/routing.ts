import { agentRegistry } from "../agents";
import { findModelProfile, getSamplingPreset, type SamplingPreset } from "../providers";
import { sharedBus } from "../../core/shared-bus";

export interface WorkerRouting {
  model: string | null;
  tools: string;
  systemPrompt: string;
  sampling: SamplingPreset | null;
}

function getWorkerModel(): string | null {
  return process.env.PANCODE_WORKER_MODEL?.trim() || null;
}

function resolveModelSampling(
  model: string | null,
  presetName: string | undefined,
): SamplingPreset | null {
  if (!model || !presetName) return null;

  // model is "provider/model-id"
  const slashIndex = model.indexOf("/");
  if (slashIndex === -1) return null;

  const providerId = model.slice(0, slashIndex);
  const modelId = model.slice(slashIndex + 1);

  const sampling = getSamplingPreset(providerId, modelId, presetName) ?? null;
  if (!sampling) {
    const message = `Sampling preset "${presetName}" not found for ${providerId}/${modelId}. Worker will use model defaults.`;
    console.error(`[pancode:routing] ${message}`);
    // Also surface this in the TUI so the user can correct agents.yaml without checking stderr.
    sharedBus.emit("pancode:warning", { source: "dispatch", message });
  }
  return sampling;
}

export function resolveWorkerRouting(agentName: string): WorkerRouting {
  const spec = agentRegistry.get(agentName);
  const workerModel = getWorkerModel();

  if (!spec) {
    return {
      model: workerModel,
      tools: "read,bash,grep,find,ls,write,edit",
      systemPrompt: "",
      sampling: null,
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
        sharedBus.emit("pancode:warning", { source: "dispatch", message });
      }
    }
  }

  return {
    model,
    tools: spec.tools,
    systemPrompt: spec.systemPrompt,
    sampling,
  };
}
