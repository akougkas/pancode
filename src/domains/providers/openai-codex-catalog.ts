/**
 * OpenAI Codex model catalog registration via Codex CLI.
 *
 * Detects Codex CLI availability and OAuth authentication status,
 * then registers available OpenAI Codex models in PanCode's ModelRegistry.
 */

import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { binaryExists } from "../../engine/runtimes/cli-base";
import type { ModelRegistry } from "../../engine/session";

const OPENAI_CODEX_MODELS = [
  {
    id: "gpt-5.4",
    name: "GPT-5.4",
    reasoning: true,
    vision: true,
    contextWindow: 272_000,
    maxTokens: 128_000,
    cost: { input: 2.5, output: 15, cacheRead: 0.25, cacheWrite: 0 },
  },
  {
    id: "gpt-5.4-pro",
    name: "GPT-5.4 Pro",
    reasoning: true,
    vision: true,
    contextWindow: 1_050_000,
    maxTokens: 128_000,
    cost: { input: 30, output: 180, cacheRead: 0, cacheWrite: 0 },
  },
  {
    id: "gpt-5.2",
    name: "GPT-5.2",
    reasoning: true,
    vision: true,
    contextWindow: 272_000,
    maxTokens: 128_000,
    cost: { input: 1.75, output: 14, cacheRead: 0.175, cacheWrite: 0 },
  },
  {
    id: "gpt-5.2-codex",
    name: "GPT-5.2 Codex",
    reasoning: true,
    vision: true,
    contextWindow: 272_000,
    maxTokens: 128_000,
    cost: { input: 1.75, output: 14, cacheRead: 0.175, cacheWrite: 0 },
  },
  {
    id: "gpt-5.1",
    name: "GPT-5.1",
    reasoning: true,
    vision: true,
    contextWindow: 272_000,
    maxTokens: 128_000,
    cost: { input: 1.25, output: 10, cacheRead: 0.125, cacheWrite: 0 },
  },
  {
    id: "gpt-5.1-codex-mini",
    name: "GPT-5.1 Codex Mini",
    reasoning: true,
    vision: true,
    contextWindow: 272_000,
    maxTokens: 128_000,
    cost: { input: 0.25, output: 2, cacheRead: 0.025, cacheWrite: 0 },
  },
  {
    id: "gpt-5.3-codex",
    name: "GPT-5.3 Codex",
    reasoning: true,
    vision: true,
    contextWindow: 272_000,
    maxTokens: 128_000,
    cost: { input: 2, output: 12, cacheRead: 0.2, cacheWrite: 0 },
  },
] as const;

export interface OpenAICodexAuthStatus {
  authenticated: boolean;
  accountId: string | null;
  expiresAt: string | null;
}

/** Detect Codex CLI availability and OAuth authentication from auth.json. */
export function detectOpenAICodexAuth(): OpenAICodexAuthStatus | null {
  if (!binaryExists("codex")) return null;

  // Check auth.json for openai-codex OAuth entry
  const agentDir =
    process.env.PI_CODING_AGENT_DIR ?? join(process.env.PANCODE_HOME ?? join(homedir(), ".pancode"), "agent-engine");
  const authPath = join(agentDir, "auth.json");

  try {
    if (!existsSync(authPath)) return null;
    const raw = readFileSync(authPath, "utf-8").trim();
    const auth = JSON.parse(raw) as Record<string, unknown>;
    const codexAuth = auth["openai-codex"] as Record<string, unknown> | undefined;
    if (!codexAuth?.access) return null;

    const expires = typeof codexAuth.expires === "number" ? codexAuth.expires : null;
    const isExpired = expires !== null && expires < Date.now();

    return {
      authenticated: !isExpired,
      accountId: typeof codexAuth.accountId === "string" ? codexAuth.accountId : null,
      expiresAt: expires ? new Date(expires).toISOString() : null,
    };
  } catch {
    return null;
  }
}

/**
 * Register OpenAI Codex models in the ModelRegistry if Codex CLI is authenticated.
 * Returns the list of registered model IDs, or empty array if not authenticated.
 */
export function registerOpenAICodexModels(modelRegistry: InstanceType<typeof ModelRegistry>): {
  registered: string[];
  auth: OpenAICodexAuthStatus | null;
} {
  const auth = detectOpenAICodexAuth();
  if (!auth?.authenticated) {
    return { registered: [], auth };
  }

  modelRegistry.registerProvider("openai-codex", {
    baseUrl: "https://chatgpt.com/backend-api",
    apiKey: "codex-cli",
    api: "openai-codex-responses",
    models: OPENAI_CODEX_MODELS.map((m) => ({
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
    registered: OPENAI_CODEX_MODELS.map((m) => m.id),
    auth,
  };
}

/** Get the curated model catalog (for display purposes). */
export function getOpenAICodexModelCatalog(): typeof OPENAI_CODEX_MODELS {
  return OPENAI_CODEX_MODELS;
}
