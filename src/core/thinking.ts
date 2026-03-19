import { DEFAULT_REASONING_PREFERENCE, DEFAULT_THINKING_LEVEL } from "./defaults";

export const THINKING_LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh"] as const;
export type PanCodeThinkingLevel = (typeof THINKING_LEVELS)[number];
export const REASONING_PREFERENCES = ["off", "on"] as const;
export type PanCodeReasoningPreference = (typeof REASONING_PREFERENCES)[number];
export type PanCodeReasoningControl = "none" | "toggle" | "levels";

interface ReasoningCompatibleModel {
  reasoning: boolean;
  compat?: {
    supportsReasoningEffort?: boolean;
    thinkingFormat?: "openai" | "zai" | "qwen" | "qwen-chat-template";
  };
}

export function parseThinkingLevel(value: string | null | undefined): PanCodeThinkingLevel | undefined {
  switch (value) {
    case "off":
    case "minimal":
    case "low":
    case "medium":
    case "high":
    case "xhigh":
      return value;
    default:
      return undefined;
  }
}

export function resolveThinkingLevel(value: string | null | undefined): PanCodeThinkingLevel {
  return parseThinkingLevel(value) ?? DEFAULT_THINKING_LEVEL;
}

export function parseReasoningPreference(value: string | null | undefined): PanCodeReasoningPreference | undefined {
  switch (value) {
    case "off":
    case "on":
      return value;
    default:
      return undefined;
  }
}

export function resolveReasoningPreference(value: string | null | undefined): PanCodeReasoningPreference {
  return parseReasoningPreference(value) ?? DEFAULT_REASONING_PREFERENCE;
}

export function reasoningPreferenceFromThinking(
  value: string | null | undefined,
): PanCodeReasoningPreference | undefined {
  const thinkingLevel = parseThinkingLevel(value);
  if (!thinkingLevel) return undefined;
  return thinkingLevel === "off" ? "off" : "on";
}

export function getModelReasoningControl(
  model: Partial<ReasoningCompatibleModel> | null | undefined,
): PanCodeReasoningControl {
  if (!model?.reasoning) return "none";
  if (model.compat?.supportsReasoningEffort === false) {
    if (
      model.compat.thinkingFormat === "qwen" ||
      model.compat.thinkingFormat === "qwen-chat-template" ||
      model.compat.thinkingFormat === "zai"
    ) {
      return "toggle";
    }
    return "none";
  }
  return "levels";
}

export function resolveThinkingLevelForPreference(
  model: Partial<ReasoningCompatibleModel> | null | undefined,
  reasoningPreference: PanCodeReasoningPreference,
): PanCodeThinkingLevel {
  if (reasoningPreference === "off") return "off";

  const control = getModelReasoningControl(model);
  if (control === "none") return "off";
  return DEFAULT_THINKING_LEVEL;
}
