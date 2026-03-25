import { ClaudeCodeRuntime } from "./adapters/claude-code";
import { ClaudeSdkRuntime } from "./adapters/claude-sdk";
import { CodexRuntime } from "./adapters/codex";
import { CopilotCliRuntime } from "./adapters/copilot-cli";
import { GeminiRuntime } from "./adapters/gemini";
import { OpencodeRuntime } from "./adapters/opencode";
import { PiRuntime } from "./pi-runtime";
import { runtimeRegistry } from "./registry";

/** All known CLI runtimes. Each one self-reports availability. */
const CLI_RUNTIMES = [
  new ClaudeCodeRuntime(),
  new CodexRuntime(),
  new GeminiRuntime(),
  new OpencodeRuntime(),
  new CopilotCliRuntime(),
];

/** SDK runtimes that execute in-process via programmatic APIs. */
const SDK_RUNTIMES = [new ClaudeSdkRuntime()];

/**
 * Register the Pi runtime (always available) and discover CLI runtimes.
 * Call once at boot from the agents domain session_start hook.
 * Returns a summary of what was discovered.
 */
export function discoverAndRegisterRuntimes(): {
  registered: string[];
  available: string[];
  unavailable: string[];
} {
  const registered: string[] = [];
  const available: string[] = [];
  const unavailable: string[] = [];

  // Pi runtime is always registered and always available
  const pi = new PiRuntime();
  runtimeRegistry.register(pi);
  registered.push(pi.id);
  available.push(pi.id);

  // Register all CLI runtimes (even unavailable ones, for /runtimes display)
  for (const runtime of CLI_RUNTIMES) {
    runtimeRegistry.register(runtime);
    registered.push(runtime.id);
    if (runtime.isAvailable()) {
      available.push(runtime.id);
    } else {
      unavailable.push(runtime.id);
    }
  }

  // Register SDK runtimes (in-process execution via programmatic APIs)
  for (const runtime of SDK_RUNTIMES) {
    runtimeRegistry.register(runtime);
    registered.push(runtime.id);
    if (runtime.isAvailable()) {
      available.push(runtime.id);
    } else {
      unavailable.push(runtime.id);
    }
  }

  return { registered, available, unavailable };
}
