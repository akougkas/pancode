import { DEFAULT_REASONING_PREFERENCE, DEFAULT_THINKING_LEVEL } from "./defaults";

export const THINKING_LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh"] as const;
export type PanCodeThinkingLevel = (typeof THINKING_LEVELS)[number];

/**
 * Reasoning preference stores the actual thinking level the user chose.
 * Same domain as PanCodeThinkingLevel. Legacy value "on" is accepted at
 * parse boundaries and mapped to DEFAULT_THINKING_LEVEL.
 */
export type PanCodeReasoningPreference = PanCodeThinkingLevel;
export type PanCodeReasoningControl = "none" | "toggle" | "levels";

/** Subset of model shape needed for reasoning resolution. */
interface ReasoningCompatibleModel {
  reasoning?: boolean;
  compat?: {
    supportsReasoningEffort?: boolean;
    thinkingFormat?: "openai" | "openrouter" | "zai" | "qwen" | "qwen-chat-template";
  };
}

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

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

/**
 * Parse a reasoning preference string. Accepts all thinking levels plus
 * the legacy value "on" (mapped to DEFAULT_THINKING_LEVEL).
 */
export function parseReasoningPreference(value: string | null | undefined): PanCodeReasoningPreference | undefined {
  if (value === "on") return DEFAULT_THINKING_LEVEL;
  return parseThinkingLevel(value);
}

export function resolveReasoningPreference(value: string | null | undefined): PanCodeReasoningPreference {
  return parseReasoningPreference(value) ?? DEFAULT_REASONING_PREFERENCE;
}

/**
 * @deprecated Legacy bridge for PANCODE_THINKING env var.
 */
export function reasoningPreferenceFromThinking(
  value: string | null | undefined,
): PanCodeReasoningPreference | undefined {
  return parseThinkingLevel(value);
}

// ---------------------------------------------------------------------------
// Model capability detection
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Resolution: preference + model capabilities -> effective engine level
// ---------------------------------------------------------------------------

/**
 * Resolve the effective thinking level sent to the engine.
 *
 * - "levels" control (OpenAI, Anthropic): pass the preference through directly.
 *   The Pi SDK's setThinkingLevel() clamps to the model's available levels.
 * - "toggle" control (Qwen, ZAI via local engines): any non-off preference
 *   becomes DEFAULT_THINKING_LEVEL (the engine sends enable_thinking=true).
 * - "none": always returns "off".
 */
export function resolveThinkingLevelForPreference(
  model: Partial<ReasoningCompatibleModel> | null | undefined,
  reasoningPreference: PanCodeReasoningPreference,
): PanCodeThinkingLevel {
  if (reasoningPreference === "off") return "off";

  const control = getModelReasoningControl(model);
  if (control === "none") return "off";
  if (control === "toggle") return DEFAULT_THINKING_LEVEL;
  // "levels" control: pass through. The SDK clamps to what the model supports.
  return reasoningPreference;
}

// ---------------------------------------------------------------------------
// Cycling
// ---------------------------------------------------------------------------

/** Levels available for keyboard cycling. Excludes "minimal" for ergonomics. */
const CYCLE_LEVELS: PanCodeThinkingLevel[] = ["off", "low", "medium", "high", "xhigh"];

/**
 * Cycle to the next reasoning level. Wraps around.
 * For toggle-only models, cycles between "off" and DEFAULT_THINKING_LEVEL.
 */
export function cycleReasoningLevel(
  current: PanCodeReasoningPreference,
  model: Partial<ReasoningCompatibleModel> | null | undefined,
): PanCodeReasoningPreference {
  const control = getModelReasoningControl(model);
  if (control === "none") return "off";
  if (control === "toggle") {
    return current === "off" ? DEFAULT_THINKING_LEVEL : "off";
  }
  // "levels" control: cycle through the standard set
  const idx = CYCLE_LEVELS.indexOf(current);
  return CYCLE_LEVELS[(idx + 1) % CYCLE_LEVELS.length];
}
