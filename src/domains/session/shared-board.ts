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
import { atomicWriteJsonSync } from "../../core/config-writer";

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

export function createSharedBoard(runtimeRoot: string): SharedBoard {
  const filePath = join(runtimeRoot, "board.json");
  // Namespace -> Key -> StoredEntry
  let store = new Map<string, Map<string, StoredEntry>>();

  function loadFromDisk(): void {
    if (!existsSync(filePath)) return;
    try {
      const raw = readFileSync(filePath, "utf-8");
      const data = JSON.parse(raw) as Record<string, Record<string, StoredEntry>>;
      store = new Map();
      for (const [ns, entries] of Object.entries(data)) {
        const nsMap = new Map<string, StoredEntry>();
        for (const [key, entry] of Object.entries(entries)) {
          nsMap.set(key, entry);
        }
        store.set(ns, nsMap);
      }
    } catch {
      // Corrupt file is non-fatal.
    }
  }

  function saveToDisk(): void {
    const data: Record<string, Record<string, StoredEntry>> = {};
    for (const [ns, entries] of store) {
      data[ns] = {};
      for (const [key, entry] of entries) {
        data[ns][key] = entry;
      }
    }
    atomicWriteJsonSync(filePath, data);
  }

  function isExpired(entry: StoredEntry): boolean {
    if (!entry.ttlMs) return false;
    const created = new Date(entry.createdAt).getTime();
    return Date.now() > created + entry.ttlMs;
  }

  function totalSize(): number {
    let count = 0;
    for (const ns of store.values()) {
      count += ns.size;
    }
    return count;
  }

  function evictToLimit(): void {
    if (totalSize() <= MAX_ENTRIES) return;

    // First pass: remove all expired entries.
    for (const [, nsMap] of store) {
      for (const [key, entry] of nsMap) {
        if (isExpired(entry)) nsMap.delete(key);
      }
    }
    if (totalSize() <= MAX_ENTRIES) return;

    // Second pass: evict oldest by timestamp until under limit.
    const all: { ns: string; key: string; timestamp: string }[] = [];
    for (const [ns, nsMap] of store) {
      for (const [key, entry] of nsMap) {
        all.push({ ns, key, timestamp: entry.timestamp });
      }
    }
    all.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
    const toRemove = totalSize() - MAX_ENTRIES;
    for (let i = 0; i < toRemove; i++) {
      const target = all[i];
      store.get(target.ns)?.delete(target.key);
    }
  }

  // Load existing state on construction.
  loadFromDisk();

  return {
    set(
      namespace: string,
      key: string,
      value: string,
      source: string,
      options?: { ttlMs?: number; merge?: MergeStrategy },
    ): void {
      let nsMap = store.get(namespace);
      if (!nsMap) {
        nsMap = new Map();
        store.set(namespace, nsMap);
      }

      const merge = options?.merge ?? "last-write-wins";
      const now = new Date().toISOString();
      let finalValue = value;

      if (merge === "append") {
        const existing = nsMap.get(key);
        if (existing && !isExpired(existing)) {
          finalValue = `${existing.value}\n${value}`;
        }
      }

      const entry: StoredEntry = {
        value: finalValue,
        source,
        timestamp: now,
        createdAt: now,
        ttlMs: options?.ttlMs,
      };
      nsMap.set(key, entry);

      evictToLimit();
      saveToDisk();
    },

    get(namespace: string, key: string): BoardEntry | null {
      const nsMap = store.get(namespace);
      if (!nsMap) return null;
      const entry = nsMap.get(key);
      if (!entry) return null;
      if (isExpired(entry)) {
        nsMap.delete(key);
        return null;
      }
      return { value: entry.value, source: entry.source, timestamp: entry.timestamp, ttlMs: entry.ttlMs };
    },

    getNamespace(namespace: string): Record<string, BoardEntry> {
      const nsMap = store.get(namespace);
      if (!nsMap) return {};
      const result: Record<string, BoardEntry> = {};
      for (const [key, entry] of nsMap) {
        if (isExpired(entry)) {
          nsMap.delete(key);
          continue;
        }
        result[key] = { value: entry.value, source: entry.source, timestamp: entry.timestamp, ttlMs: entry.ttlMs };
      }
      return result;
    },

    getAll(): Record<string, Record<string, BoardEntry>> {
      const result: Record<string, Record<string, BoardEntry>> = {};
      for (const [ns, nsMap] of store) {
        const nsEntries: Record<string, BoardEntry> = {};
        let hasEntries = false;
        for (const [key, entry] of nsMap) {
          if (isExpired(entry)) {
            nsMap.delete(key);
            continue;
          }
          nsEntries[key] = { value: entry.value, source: entry.source, timestamp: entry.timestamp, ttlMs: entry.ttlMs };
          hasEntries = true;
        }
        if (hasEntries) result[ns] = nsEntries;
      }
      return result;
    },

    delete(namespace: string, key: string): boolean {
      const nsMap = store.get(namespace);
      if (!nsMap) return false;
      const existed = nsMap.delete(key);
      if (existed) saveToDisk();
      return existed;
    },

    clearNamespace(namespace: string): void {
      store.delete(namespace);
      saveToDisk();
    },

    clear(): void {
      store.clear();
      saveToDisk();
    },

    size(): number {
      return totalSize();
    },

    persist(): void {
      saveToDisk();
    },

    sync(): void {
      loadFromDisk();
    },
  };
}
