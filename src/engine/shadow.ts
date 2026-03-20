/**
 * Shadow Scout Engine: concurrent in-process agents for orchestrator reconnaissance.
 *
 * Spawns 1-4 lightweight Pi SDK sessions in parallel, each running on a fast
 * model (PANCODE_SCOUT_MODEL) with readonly tools. Results are returned as
 * structured objects directly in memory. No file I/O, no dispatch ledger,
 * no session persistence. Pure IPC between orchestrator and scouts.
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

export const MAX_CONCURRENT_SCOUTS = 4;

export interface ScoutResult {
  query: string;
  response: string;
  toolCalls: number;
  durationMs: number;
  error?: string;
}

export interface ScoutRunOptions {
  cwd: string;
  model?: Model<Api>;
  modelRegistry?: InstanceType<typeof ModelRegistry>;
  systemPrompt: string;
  signal?: AbortSignal;
}

/**
 * Run 1-N scout queries concurrently. Each query gets its own in-process
 * Pi session with readonly tools. Queries beyond MAX_CONCURRENT_SCOUTS
 * are silently dropped.
 */
export async function runScouts(queries: string[], options: ScoutRunOptions): Promise<ScoutResult[]> {
  const limited = queries.slice(0, MAX_CONCURRENT_SCOUTS);
  const settled = await Promise.allSettled(limited.map((query) => runSingleScout(query, options)));

  return settled.map((outcome, i) => {
    if (outcome.status === "fulfilled") return outcome.value;
    return {
      query: limited[i],
      response: "",
      toolCalls: 0,
      durationMs: 0,
      error: outcome.reason instanceof Error ? outcome.reason.message : String(outcome.reason),
    };
  });
}

async function runSingleScout(query: string, options: ScoutRunOptions): Promise<ScoutResult> {
  const startTime = Date.now();
  let session: Awaited<ReturnType<typeof createAgentSession>>["session"] | null = null;

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

    const created = await createAgentSession(sessionOptions);
    session = created.session;

    let response = "";
    let toolCalls = 0;

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

    // Forward external abort signal to session
    const abortHandler = () => {
      session?.abort().catch(() => {});
    };
    options.signal?.addEventListener("abort", abortHandler, { once: true });

    const fullPrompt = `${options.systemPrompt}\n\n${query}`;

    try {
      await session.prompt(fullPrompt);
    } finally {
      options.signal?.removeEventListener("abort", abortHandler);
    }

    unsubscribe();

    return {
      query,
      response,
      toolCalls,
      durationMs: Date.now() - startTime,
    };
  } catch (err) {
    if (session) {
      session.abort().catch(() => {});
    }
    return {
      query,
      response: "",
      toolCalls: 0,
      durationMs: Date.now() - startTime,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
