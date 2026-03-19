/**
 * Shadow agent: lightweight in-process agent for orchestrator-internal exploration.
 *
 * Creates a minimal Pi agent session with readonly tools and a cheap model.
 * Runs the query, collects the response, and tears down. No session persistence.
 */

import type { Api, Model } from "@pancode/pi-ai";
import {
  AuthStorage,
  type ModelRegistry,
  SessionManager,
  SettingsManager,
  createAgentSession,
  createReadOnlyTools,
} from "@pancode/pi-coding-agent";

export interface ShadowQueryOptions {
  query: string;
  cwd: string;
  model?: Model<Api>;
  modelRegistry?: InstanceType<typeof ModelRegistry>;
  timeoutMs?: number;
}

export interface ShadowQueryResult {
  response: string;
  toolCalls: number;
  durationMs: number;
  error?: string;
}

export async function runShadowQuery(options: ShadowQueryOptions): Promise<ShadowQueryResult> {
  const startTime = Date.now();
  const timeout = options.timeoutMs ?? 30000;

  try {
    const tools = createReadOnlyTools(options.cwd);

    const sessionOptions: Parameters<typeof createAgentSession>[0] = {
      cwd: options.cwd,
      tools,
      sessionManager: SessionManager.inMemory(options.cwd),
      settingsManager: SettingsManager.inMemory(),
      authStorage: AuthStorage.inMemory(),
      thinkingLevel: "off",
    };

    if (options.model) {
      sessionOptions.model = options.model;
    }
    if (options.modelRegistry) {
      sessionOptions.modelRegistry = options.modelRegistry;
    }

    const { session } = await createAgentSession(sessionOptions);

    let response = "";
    let toolCalls = 0;

    // Subscribe to events to collect response and tool call count.
    // message_end with an assistant message carries the final text content.
    // tool_execution_end events track tool call count.
    const unsubscribe = session.subscribe((event) => {
      if (event.type === "message_end" && "message" in event && event.message?.role === "assistant") {
        const msg = event.message;
        if (Array.isArray(msg.content)) {
          for (const part of msg.content) {
            if (part && typeof part === "object" && "type" in part && part.type === "text" && "text" in part) {
              response = String(part.text);
            }
          }
        }
      }
      if (event.type === "tool_execution_end") {
        toolCalls++;
      }
    });

    // Run query with timeout
    const timeoutPromise = new Promise<never>((_resolve, reject) => {
      setTimeout(() => reject(new Error("Shadow query timed out")), timeout);
    });

    await Promise.race([session.prompt(options.query), timeoutPromise]);

    unsubscribe();

    return {
      response,
      toolCalls,
      durationMs: Date.now() - startTime,
    };
  } catch (err) {
    return {
      response: "",
      toolCalls: 0,
      durationMs: Date.now() - startTime,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
