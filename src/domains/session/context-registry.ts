/**
 * Context Registry: file-backed key-value store for cross-agent findings.
 *
 * Workers publish facts, the orchestrator and later workers read them
 * across dispatch rounds. Backed by JSON at ${runtimeRoot}/context.json.
 * Max 500 entries with oldest-by-timestamp eviction.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { atomicWriteJsonSync, withFileLockSync } from "../../core/config-writer";

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

function loadStore(filePath: string): Map<string, ContextEntry> {
  if (!existsSync(filePath)) return new Map();
  try {
    const raw = readFileSync(filePath, "utf-8");
    const data = JSON.parse(raw) as Record<string, ContextEntry>;
    return new Map(Object.entries(data));
  } catch {
    return new Map();
  }
}

function serializeStore(store: Map<string, ContextEntry>): Record<string, ContextEntry> {
  return Object.fromEntries(store.entries());
}

function evictOldest(store: Map<string, ContextEntry>): void {
  if (store.size <= MAX_ENTRIES) return;
  const sorted = [...store.entries()].sort((a, b) => a[1].timestamp.localeCompare(b[1].timestamp));
  const toRemove = store.size - MAX_ENTRIES;
  for (let i = 0; i < toRemove; i += 1) {
    store.delete(sorted[i][0]);
  }
}

export function createContextRegistry(runtimeRoot: string): ContextRegistry {
  const filePath = join(runtimeRoot, "context.json");
  let store = loadStore(filePath);

  function refresh(): void {
    store = loadStore(filePath);
  }

  return {
    set(key: string, value: string, source: string): void {
      withFileLockSync(filePath, () => {
        const next = loadStore(filePath);
        next.set(key, {
          key,
          value,
          source,
          timestamp: new Date().toISOString(),
        });
        evictOldest(next);
        atomicWriteJsonSync(filePath, serializeStore(next));
        store = next;
      });
    },

    get(key: string): ContextEntry | null {
      refresh();
      return store.get(key) ?? null;
    },

    getBySource(source: string): ContextEntry[] {
      refresh();
      const result: ContextEntry[] = [];
      for (const entry of store.values()) {
        if (entry.source === source) result.push(entry);
      }
      return result;
    },

    getAll(): ContextEntry[] {
      refresh();
      return [...store.values()];
    },

    delete(key: string): boolean {
      let existed = false;
      withFileLockSync(filePath, () => {
        const next = loadStore(filePath);
        existed = next.delete(key);
        if (existed) {
          atomicWriteJsonSync(filePath, serializeStore(next));
        }
        store = next;
      });
      return existed;
    },

    clear(): void {
      withFileLockSync(filePath, () => {
        store = new Map();
        atomicWriteJsonSync(filePath, {});
      });
    },

    size(): number {
      refresh();
      return store.size;
    },
  };
}
