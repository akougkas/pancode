/**
 * Anthropic model catalog registration via Claude Code CLI.
 *
 * Unlike local engine discovery (Ollama, LM Studio, llama.cpp), Anthropic
 * models are accessed through the Claude Code CLI binary, not a local HTTP
 * endpoint. This module detects Claude CLI availability and authentication
 * status, then registers the Anthropic model catalog in PanCode's
 * ModelRegistry.
 *
 * Auth detection runs `claude auth status` which returns JSON with
 * subscriptionType, authMethod, and email. If authenticated, we register
 * a curated set of current Anthropic models.
 */

import { execSync } from "node:child_process";
import { binaryExists } from "../../engine/runtimes/cli-base";
import type { ModelRegistry } from "../../engine/session";

// The curated Anthropic model catalog. These are the current production
// models available through Claude Code CLI. Costs are per million tokens.
const ANTHROPIC_MODELS = [
  {
    id: "claude-opus-4-6",
    name: "Claude Opus 4.6",
    reasoning: true,
    vision: true,
    contextWindow: 1_000_000,
    maxTokens: 64_000,
    cost: { input: 15, output: 75, cacheRead: 1.5, cacheWrite: 18.75 },
  },
  {
    id: "claude-sonnet-4-6",
    name: "Claude Sonnet 4.6",
    reasoning: true,
    vision: true,
    contextWindow: 1_000_000,
    maxTokens: 64_000,
    cost: { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
  },
  {
    id: "claude-sonnet-4-5-20250929",
    name: "Claude Sonnet 4.5",
    reasoning: true,
    vision: true,
    contextWindow: 200_000,
    maxTokens: 64_000,
    cost: { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
  },
  {
    id: "claude-sonnet-4-20250514",
    name: "Claude Sonnet 4",
    reasoning: true,
    vision: true,
    contextWindow: 200_000,
    maxTokens: 64_000,
    cost: { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
  },
  {
    id: "claude-haiku-4-5-20251001",
    name: "Claude Haiku 4.5",
    reasoning: true,
    vision: true,
    contextWindow: 200_000,
    maxTokens: 64_000,
    cost: { input: 1, output: 5, cacheRead: 0.1, cacheWrite: 1.25 },
  },
  {
    id: "claude-3-5-haiku-20241022",
    name: "Claude Haiku 3.5",
    reasoning: false,
    vision: true,
    contextWindow: 200_000,
    maxTokens: 8_192,
    cost: { input: 0.8, output: 4, cacheRead: 0.08, cacheWrite: 1 },
  },
] as const;

export interface AnthropicAuthStatus {
  loggedIn: boolean;
  authMethod: string | null;
  subscriptionType: string | null;
  email: string | null;
}

/**
 * Detect Claude CLI authentication status.
 * Returns auth info if authenticated, null if CLI is missing or not authenticated.
 */
export function detectAnthropicAuth(): AnthropicAuthStatus | null {
  if (!binaryExists("claude")) return null;

  try {
    const raw = execSync("claude auth status", {
      encoding: "utf-8",
      timeout: 5_000,
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();

    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (parsed.loggedIn !== true) return null;

    return {
      loggedIn: true,
      authMethod: typeof parsed.authMethod === "string" ? parsed.authMethod : null,
      subscriptionType: typeof parsed.subscriptionType === "string" ? parsed.subscriptionType : null,
      email: typeof parsed.email === "string" ? parsed.email : null,
    };
  } catch {
    return null;
  }
}

/**
 * Register Anthropic models in the ModelRegistry if Claude CLI is authenticated.
 * Returns the list of registered model IDs, or empty array if not authenticated.
 */
export function registerAnthropicModels(modelRegistry: InstanceType<typeof ModelRegistry>): {
  registered: string[];
  auth: AnthropicAuthStatus | null;
} {
  const auth = detectAnthropicAuth();
  if (!auth) {
    return { registered: [], auth: null };
  }

  // Register under provider "anthropic" with the Anthropic Messages API format.
  // These models are accessed via cli:claude-code runtime, not direct API calls.
  // The baseUrl is informational only; actual requests go through the Claude CLI.
  modelRegistry.registerProvider("anthropic", {
    baseUrl: "https://api.anthropic.com/v1",
    apiKey: "claude-cli",
    api: "anthropic-messages",
    models: ANTHROPIC_MODELS.map((m) => ({
      id: m.id,
      name: m.name,
      reasoning: m.reasoning,
      input: m.vision ? (["text", "image"] as ("text" | "image")[]) : (["text"] as ("text" | "image")[]),
      cost: m.cost,
      contextWindow: m.contextWindow,
      maxTokens: m.maxTokens,
      compat: {},
    })),
  });

  return {
    registered: ANTHROPIC_MODELS.map((m) => m.id),
    auth,
  };
}

/** Get the curated model catalog (for display purposes). */
export function getAnthropicModelCatalog(): typeof ANTHROPIC_MODELS {
  return ANTHROPIC_MODELS;
}
