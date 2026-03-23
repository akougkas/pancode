import type { AgentRuntime } from "./types";

class RuntimeRegistryImpl {
  private readonly runtimes = new Map<string, AgentRuntime>();

  register(runtime: AgentRuntime): void {
    this.runtimes.set(runtime.id, runtime);
  }

  get(id: string): AgentRuntime | undefined {
    return this.runtimes.get(id);
  }

  getOrThrow(id: string): AgentRuntime {
    const runtime = this.runtimes.get(id);
    if (!runtime) throw new Error(`Unknown runtime: ${id}`);
    return runtime;
  }

  has(id: string): boolean {
    return this.runtimes.has(id);
  }

  /** All registered runtimes */
  all(): AgentRuntime[] {
    return [...this.runtimes.values()];
  }

  /** Only runtimes where isAvailable() returns true */
  available(): AgentRuntime[] {
    return this.all().filter((r) => r.isAvailable());
  }

  /** IDs of available runtimes */
  availableIds(): string[] {
    return this.available().map((r) => r.id);
  }

  /** Number of registered runtimes */
  count(): number {
    return this.runtimes.size;
  }

  /** Runtimes grouped by tier */
  byTier(): Record<string, AgentRuntime[]> {
    const groups: Record<string, AgentRuntime[]> = {};
    for (const rt of this.all()) {
      const bucket = groups[rt.tier] ?? [];
      bucket.push(rt);
      groups[rt.tier] = bucket;
    }
    return groups;
  }
}

export const runtimeRegistry = new RuntimeRegistryImpl();
