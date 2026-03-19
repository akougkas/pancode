/**
 * Context Registry: file-backed key-value store for cross-agent findings.
 *
 * Workers publish facts, the orchestrator and later workers read them
 * across dispatch rounds. Backed by JSON at ${runtimeRoot}/context.json.
 * Max 500 entries with oldest-by-timestamp eviction.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { atomicWriteJsonSync } from "../../core/config-writer";

const MAX_ENTRIES = 500;

export interface ContextEntry {
  key: string;
  value: string;
  source: string;
  timestamp: string;
}

export interface ContextRegistry {
  set(key: string, value: string, source: string): void;
  get(key: string): ContextEntry | null;
  getBySource(source: string): ContextEntry[];
  getAll(): ContextEntry[];
  delete(key: string): boolean;
  clear(): void;
  size(): number;
}

export function createContextRegistry(runtimeRoot: string): ContextRegistry {
  const filePath = join(runtimeRoot, "context.json");
  let store: Map<string, ContextEntry> = new Map();

  // Load existing data from disk if available.
  if (existsSync(filePath)) {
    try {
      const raw = readFileSync(filePath, "utf-8");
      const data = JSON.parse(raw) as Record<string, ContextEntry>;
      for (const [key, entry] of Object.entries(data)) {
        store.set(key, entry);
      }
    } catch {
      // Corrupt file is non-fatal. Start empty.
    }
  }

  function persist(): void {
    const data: Record<string, ContextEntry> = {};
    for (const [key, entry] of store) {
      data[key] = entry;
    }
    atomicWriteJsonSync(filePath, data);
  }

  function evictOldest(): void {
    if (store.size <= MAX_ENTRIES) return;
    // Sort entries by timestamp ascending, remove the oldest.
    const sorted = [...store.entries()].sort((a, b) => a[1].timestamp.localeCompare(b[1].timestamp));
    const toRemove = store.size - MAX_ENTRIES;
    for (let i = 0; i < toRemove; i++) {
      store.delete(sorted[i][0]);
    }
  }

  return {
    set(key: string, value: string, source: string): void {
      store.set(key, {
        key,
        value,
        source,
        timestamp: new Date().toISOString(),
      });
      evictOldest();
      persist();
    },

    get(key: string): ContextEntry | null {
      return store.get(key) ?? null;
    },

    getBySource(source: string): ContextEntry[] {
      const result: ContextEntry[] = [];
      for (const entry of store.values()) {
        if (entry.source === source) result.push(entry);
      }
      return result;
    },

    getAll(): ContextEntry[] {
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
