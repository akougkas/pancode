import { ClaudeCodeRuntime } from "./adapters/claude-code";
import { ClineRuntime } from "./adapters/cline";
import { CodexRuntime } from "./adapters/codex";
import { CopilotCliRuntime } from "./adapters/copilot-cli";
import { GeminiRuntime } from "./adapters/gemini";
import { OpencodeRuntime } from "./adapters/opencode";
import { PiRuntime } from "./pi-runtime";
import { runtimeRegistry } from "./registry";
import { SimRuntime } from "./sim-runtime";
import { SshRuntime } from "./ssh-runtime";

/** All known CLI runtimes. Each one self-reports availability. */
const CLI_RUNTIMES = [
  new ClaudeCodeRuntime(),
  new CodexRuntime(),
  new GeminiRuntime(),
  new OpencodeRuntime(),
  new ClineRuntime(),
  new CopilotCliRuntime(),
];

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

  // Simulator runtime: available when PANCODE_SIM_ENABLED=1.
  const sim = new SimRuntime();
  runtimeRegistry.register(sim);
  registered.push(sim.id);
  if (sim.isAvailable()) {
    available.push(sim.id);
  } else {
    unavailable.push(sim.id);
  }

  // SSH runtime: available only when PANCODE_SSH_NODES is configured.
  const ssh = new SshRuntime();
  runtimeRegistry.register(ssh);
  registered.push(ssh.id);
  if (ssh.isAvailable()) {
    available.push(ssh.id);
  } else {
    unavailable.push(ssh.id);
  }

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

  return { registered, available, unavailable };
}
