/**
 * Session Memory: three-tier memory system with uniform read/write interface.
 *
 * Temporal: in-memory, session-scoped, lost on exit.
 * Persistent: file-backed at ${runtimeRoot}/memory.json, survives sessions.
 * Shared: thin wrapper over ContextRegistry, cross-agent visible.
 *
 * Max 200 entries per tier with oldest-by-timestamp eviction.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { atomicWriteJsonSync } from "../../core/config-writer";
import type { ContextRegistry } from "./context-registry";

const MAX_ENTRIES_PER_TIER = 200;

export interface MemoryEntry {
  key: string;
  value: string;
  source: string;
  timestamp: string;
}

export interface MemoryTier {
  set(key: string, value: string, source: string): void;
  get(key: string): MemoryEntry | null;
  getAll(): MemoryEntry[];
  delete(key: string): boolean;
  clear(): void;
  size(): number;
}

export interface SessionMemory {
  temporal: MemoryTier;
  persistent: MemoryTier;
  shared: MemoryTier;
}

// ---------------------------------------------------------------------------
// Temporal tier: pure in-memory
// ---------------------------------------------------------------------------

function createTemporalTier(): MemoryTier {
  const store = new Map<string, MemoryEntry>();

  function evictOldest(): void {
    if (store.size <= MAX_ENTRIES_PER_TIER) return;
    const sorted = [...store.entries()].sort((a, b) => a[1].timestamp.localeCompare(b[1].timestamp));
    const toRemove = store.size - MAX_ENTRIES_PER_TIER;
    for (let i = 0; i < toRemove; i++) {
      store.delete(sorted[i][0]);
    }
  }

  return {
    set(key: string, value: string, source: string): void {
      store.set(key, { key, value, source, timestamp: new Date().toISOString() });
      evictOldest();
    },
    get(key: string): MemoryEntry | null {
      return store.get(key) ?? null;
    },
    getAll(): MemoryEntry[] {
      return [...store.values()];
    },
    delete(key: string): boolean {
      return store.delete(key);
    },
    clear(): void {
      store.clear();
    },
    size(): number {
      return store.size;
    },
  };
}

// ---------------------------------------------------------------------------
// Persistent tier: file-backed JSON
// ---------------------------------------------------------------------------

function createPersistentTier(runtimeRoot: string): MemoryTier {
  const filePath = join(runtimeRoot, "memory.json");
  const store = new Map<string, MemoryEntry>();

  // Load existing data from disk.
  if (existsSync(filePath)) {
    try {
      const raw = readFileSync(filePath, "utf-8");
      const data = JSON.parse(raw) as Record<string, MemoryEntry>;
      for (const [key, entry] of Object.entries(data)) {
        store.set(key, entry);
      }
    } catch {
      // Corrupt file is non-fatal.
    }
  }

  function persist(): void {
    const data: Record<string, MemoryEntry> = {};
    for (const [key, entry] of store) {
      data[key] = entry;
    }
    atomicWriteJsonSync(filePath, data);
  }

  function evictOldest(): void {
    if (store.size <= MAX_ENTRIES_PER_TIER) return;
    const sorted = [...store.entries()].sort((a, b) => a[1].timestamp.localeCompare(b[1].timestamp));
    const toRemove = store.size - MAX_ENTRIES_PER_TIER;
    for (let i = 0; i < toRemove; i++) {
      store.delete(sorted[i][0]);
    }
  }

  return {
    set(key: string, value: string, source: string): void {
      store.set(key, { key, value, source, timestamp: new Date().toISOString() });
      evictOldest();
      persist();
    },
    get(key: string): MemoryEntry | null {
      return store.get(key) ?? null;
    },
    getAll(): MemoryEntry[] {
      return [...store.values()];
    },
    delete(key: string): boolean {
      const existed = store.delete(key);
      if (existed) persist();
      return existed;
    },
    clear(): void {
      store.clear();
      persist();
    },
    size(): number {
      return store.size;
    },
  };
}

// ---------------------------------------------------------------------------
// Shared tier: wraps ContextRegistry
// ---------------------------------------------------------------------------

function createSharedTier(registry: ContextRegistry): MemoryTier {
  return {
    set(key: string, value: string, source: string): void {
      registry.set(key, value, source);
    },
    get(key: string): MemoryEntry | null {
      const entry = registry.get(key);
      if (!entry) return null;
      return { key: entry.key, value: entry.value, source: entry.source, timestamp: entry.timestamp };
    },
    getAll(): MemoryEntry[] {
      return registry.getAll().map((e) => ({
        key: e.key,
        value: e.value,
        source: e.source,
        timestamp: e.timestamp,
      }));
    },
    delete(key: string): boolean {
      return registry.delete(key);
    },
    clear(): void {
      registry.clear();
    },
    size(): number {
      return registry.size();
    },
  };
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createSessionMemory(runtimeRoot: string, contextRegistry: ContextRegistry): SessionMemory {
  return {
    temporal: createTemporalTier(),
    persistent: createPersistentTier(runtimeRoot),
    shared: createSharedTier(contextRegistry),
  };
}
