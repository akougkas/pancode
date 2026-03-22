export type SafeEventListener = (payload: unknown) => void | Promise<void>;

export interface SafeEventBus {
  emit(channel: string, payload: unknown): void;
  emitSafe(channel: string, payload: unknown): void;
  on(channel: string, listener: SafeEventListener): () => void;
  listeners(channel: string): SafeEventListener[];
  clear(): void;
}

function reportListenerError(channel: string, error: unknown): void {
  const message = error instanceof Error ? (error.stack ?? error.message) : String(error);
  console.error(`[pancode:event-bus] Listener crashed on ${channel}: ${message}`);
}

export function emitSafe(bus: Pick<SafeEventBus, "listeners">, channel: string, payload: unknown): void {
  for (const listener of bus.listeners(channel)) {
    queueMicrotask(() => {
      void Promise.resolve()
        .then(() => listener(payload))
        .catch((error) => reportListenerError(channel, error));
    });
  }
}

export function createSafeEventBus(): SafeEventBus {
  const registry = new Map<string, Set<SafeEventListener>>();

  const bus: SafeEventBus = {
    emit(channel, payload) {
      emitSafe(bus, channel, payload);
    },
    emitSafe(channel, payload) {
      emitSafe(bus, channel, payload);
    },
    on(channel, listener) {
      const listeners = registry.get(channel) ?? new Set<SafeEventListener>();
      listeners.add(listener);
      registry.set(channel, listeners);

      return () => {
        const current = registry.get(channel);
        if (!current) return;
        current.delete(listener);
        if (current.size === 0) registry.delete(channel);
      };
    },
    listeners(channel) {
      return [...(registry.get(channel) ?? [])];
    },
    clear() {
      registry.clear();
    },
  };

  return bus;
}
