/**
 * Shared Board: namespaced key-value store for orchestrator-worker coordination.
 *
 * Primary store is in-memory for speed. Backed by JSON at ${runtimeRoot}/board.json
 * for debuggability and worker access. Supports TTL (lazy expiry on access) and
 * merge strategies (last-write-wins, append).
 * Max 1000 entries total across all namespaces.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { atomicWriteJsonSync, withFileLockSync } from "../../core/config-writer";

const MAX_ENTRIES = 1000;

export interface BoardEntry {
  value: string;
  source: string;
  timestamp: string;
  ttlMs?: number;
}

export type MergeStrategy = "last-write-wins" | "append";

export interface SharedBoard {
  set(
    namespace: string,
    key: string,
    value: string,
    source: string,
    options?: { ttlMs?: number; merge?: MergeStrategy },
  ): void;
  get(namespace: string, key: string): BoardEntry | null;
  getNamespace(namespace: string): Record<string, BoardEntry>;
  getAll(): Record<string, Record<string, BoardEntry>>;
  delete(namespace: string, key: string): boolean;
  clearNamespace(namespace: string): void;
  clear(): void;
  size(): number;
  persist(): void;
  sync(): void;
}

/** Serialized format for a single entry on disk. Includes createdAt for TTL calculation. */
interface StoredEntry extends BoardEntry {
  createdAt: string;
}

type BoardStore = Map<string, Map<string, StoredEntry>>;

function deserializeStore(data: Record<string, Record<string, StoredEntry>>): BoardStore {
  const store = new Map<string, Map<string, StoredEntry>>();
  for (const [namespace, entries] of Object.entries(data)) {
    store.set(namespace, new Map(Object.entries(entries)));
  }
  return store;
}

function loadStore(filePath: string): BoardStore {
  if (!existsSync(filePath)) return new Map();
  try {
    const raw = readFileSync(filePath, "utf-8");
    return deserializeStore(JSON.parse(raw) as Record<string, Record<string, StoredEntry>>);
  } catch {
    return new Map();
  }
}

function serializeStore(store: BoardStore): Record<string, Record<string, StoredEntry>> {
  const data: Record<string, Record<string, StoredEntry>> = {};
  for (const [namespace, entries] of store) {
    data[namespace] = Object.fromEntries(entries.entries());
  }
  return data;
}

function isExpired(entry: StoredEntry): boolean {
  if (!entry.ttlMs) return false;
  const created = new Date(entry.createdAt).getTime();
  return Date.now() > created + entry.ttlMs;
}

function totalSize(store: BoardStore): number {
  let count = 0;
  for (const entries of store.values()) {
    count += entries.size;
  }
  return count;
}

function evictToLimit(store: BoardStore): void {
  if (totalSize(store) <= MAX_ENTRIES) return;

  for (const entries of store.values()) {
    for (const [key, entry] of entries) {
      if (isExpired(entry)) entries.delete(key);
    }
  }
  if (totalSize(store) <= MAX_ENTRIES) return;

  const all: Array<{ namespace: string; key: string; timestamp: string }> = [];
  for (const [namespace, entries] of store) {
    for (const [key, entry] of entries) {
      all.push({ namespace, key, timestamp: entry.timestamp });
    }
  }
  all.sort((a, b) => a.timestamp.localeCompare(b.timestamp));

  const toRemove = totalSize(store) - MAX_ENTRIES;
  for (let i = 0; i < toRemove; i += 1) {
    const item = all[i];
    store.get(item.namespace)?.delete(item.key);
  }
}

export function createSharedBoard(runtimeRoot: string): SharedBoard {
  const filePath = join(runtimeRoot, "board.json");
  let store = loadStore(filePath);

  function save(next: BoardStore, lock: boolean): void {
    const payload = serializeStore(next);
    if (lock) {
      atomicWriteJsonSync(filePath, payload, { lock: "adjacent" });
    } else {
      atomicWriteJsonSync(filePath, payload);
    }
  }

  return {
    set(
      namespace: string,
      key: string,
      value: string,
      source: string,
      options?: { ttlMs?: number; merge?: MergeStrategy },
    ): void {
      withFileLockSync(filePath, () => {
        const next = loadStore(filePath);
        let entries = next.get(namespace);
        if (!entries) {
          entries = new Map();
          next.set(namespace, entries);
        }

        const merge = options?.merge ?? "last-write-wins";
        const now = new Date().toISOString();
        let finalValue = value;

        if (merge === "append") {
          const existing = entries.get(key);
          if (existing && !isExpired(existing)) {
            finalValue = `${existing.value}\n${value}`;
          }
        }

        entries.set(key, {
          value: finalValue,
          source,
          timestamp: now,
          createdAt: now,
          ttlMs: options?.ttlMs,
        });

        evictToLimit(next);
        save(next, false);
        store = next;
      });
    },

    get(namespace: string, key: string): BoardEntry | null {
      const entries = store.get(namespace);
      if (!entries) return null;
      const entry = entries.get(key);
      if (!entry) return null;
      if (isExpired(entry)) {
        entries.delete(key);
        return null;
      }
      return { value: entry.value, source: entry.source, timestamp: entry.timestamp, ttlMs: entry.ttlMs };
    },

    getNamespace(namespace: string): Record<string, BoardEntry> {
      const entries = store.get(namespace);
      if (!entries) return {};
      const result: Record<string, BoardEntry> = {};
      for (const [key, entry] of entries) {
        if (isExpired(entry)) {
          entries.delete(key);
          continue;
        }
        result[key] = { value: entry.value, source: entry.source, timestamp: entry.timestamp, ttlMs: entry.ttlMs };
      }
      return result;
    },

    getAll(): Record<string, Record<string, BoardEntry>> {
      const result: Record<string, Record<string, BoardEntry>> = {};
      for (const [namespace, entries] of store) {
        const serialized: Record<string, BoardEntry> = {};
        let hasEntries = false;
        for (const [key, entry] of entries) {
          if (isExpired(entry)) {
            entries.delete(key);
            continue;
          }
          serialized[key] = {
            value: entry.value,
            source: entry.source,
            timestamp: entry.timestamp,
            ttlMs: entry.ttlMs,
          };
          hasEntries = true;
        }
        if (hasEntries) result[namespace] = serialized;
      }
      return result;
    },

    delete(namespace: string, key: string): boolean {
      let existed = false;
      withFileLockSync(filePath, () => {
        const next = loadStore(filePath);
        const entries = next.get(namespace);
        if (entries) {
          existed = entries.delete(key);
        }
        if (existed) {
          save(next, false);
        }
        store = next;
      });
      return existed;
    },

    clearNamespace(namespace: string): void {
      withFileLockSync(filePath, () => {
        const next = loadStore(filePath);
        next.delete(namespace);
        save(next, false);
        store = next;
      });
    },

    clear(): void {
      store = new Map();
      save(store, true);
    },

    size(): number {
      return totalSize(store);
    },

    persist(): void {
      save(store, true);
    },

    sync(): void {
      store = loadStore(filePath);
    },
  };
}
