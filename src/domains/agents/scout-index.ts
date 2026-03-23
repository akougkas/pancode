/**
 * Scout persistent index for codebase knowledge caching.
 *
 * Stores scout findings in a local JSON-based index so repeated
 * questions about the same codebase do not require fresh exploration.
 * The index is updated incrementally when files change (using git
 * status as a change detector).
 *
 * Future: migrate to SQLite or DuckDB for queryable persistence.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { atomicWriteJsonSync } from "../../core/config-writer";

export interface ScoutIndexEntry {
  /** File path relative to project root. */
  filePath: string;
  /** Content hash (first 8 chars of sha256). */
  contentHash: string;
  /** Last modification time (ISO 8601). */
  lastModified: string;
  /** Number of lines in the file. */
  lineCount: number;
  /** Detected symbols (function/class/type names). */
  symbols: string[];
  /** File size in bytes. */
  sizeBytes: number;
}

export interface ScoutQueryResult {
  /** The query text. */
  query: string;
  /** The scout's response. */
  result: string;
  /** When the query was executed. */
  timestamp: string;
  /** Which model produced the result. */
  scoutModel: string;
}

export interface ScoutIndex {
  /** Project root this index belongs to. */
  projectRoot: string;
  /** When the index was last updated. */
  lastUpdated: string;
  /** File entries. */
  files: ScoutIndexEntry[];
  /** Cached query results. */
  queries: ScoutQueryResult[];
}

/** Maximum cached queries before pruning. */
const MAX_CACHED_QUERIES = 50;

/** Maximum age for cached queries in milliseconds (1 hour). */
const MAX_QUERY_AGE_MS = 3600_000;

function indexPath(projectRoot: string): string {
  return join(projectRoot, ".pancode", "scout-index.json");
}

/**
 * Load the scout index for a project.
 * Returns null if no index exists.
 */
export function loadScoutIndex(projectRoot: string): ScoutIndex | null {
  const path = indexPath(projectRoot);
  if (!existsSync(path)) return null;

  try {
    const raw = readFileSync(path, "utf8");
    return JSON.parse(raw) as ScoutIndex;
  } catch {
    return null;
  }
}

/**
 * Save the scout index for a project.
 */
export function saveScoutIndex(projectRoot: string, index: ScoutIndex): void {
  const path = indexPath(projectRoot);
  atomicWriteJsonSync(path, index);
}

/**
 * Create an empty scout index.
 */
export function createEmptyIndex(projectRoot: string): ScoutIndex {
  return {
    projectRoot,
    lastUpdated: new Date().toISOString(),
    files: [],
    queries: [],
  };
}

/**
 * Update a file entry in the index.
 */
export function updateFileEntry(index: ScoutIndex, entry: ScoutIndexEntry): void {
  const existing = index.files.findIndex((f) => f.filePath === entry.filePath);
  if (existing >= 0) {
    index.files[existing] = entry;
  } else {
    index.files.push(entry);
  }
  index.lastUpdated = new Date().toISOString();
}

/**
 * Remove stale file entries (files that no longer exist).
 */
export function pruneStaleFiles(index: ScoutIndex, existingPaths: Set<string>): number {
  const before = index.files.length;
  index.files = index.files.filter((f) => existingPaths.has(f.filePath));
  const pruned = before - index.files.length;
  if (pruned > 0) {
    index.lastUpdated = new Date().toISOString();
  }
  return pruned;
}

/**
 * Cache a scout query result.
 */
export function cacheQueryResult(index: ScoutIndex, result: ScoutQueryResult): void {
  index.queries.push(result);

  // Prune old queries
  const cutoff = Date.now() - MAX_QUERY_AGE_MS;
  index.queries = index.queries.filter((q) => new Date(q.timestamp).getTime() > cutoff);

  // Trim to max size
  if (index.queries.length > MAX_CACHED_QUERIES) {
    index.queries = index.queries.slice(-MAX_CACHED_QUERIES);
  }
}

/**
 * Look up a cached query result.
 * Returns the cached result if the exact query was asked recently.
 */
export function lookupCachedQuery(index: ScoutIndex, query: string): ScoutQueryResult | null {
  const cutoff = Date.now() - MAX_QUERY_AGE_MS;
  const normalizedQuery = query.trim().toLowerCase();

  for (let i = index.queries.length - 1; i >= 0; i--) {
    const cached = index.queries[i];
    if (cached.query.trim().toLowerCase() === normalizedQuery && new Date(cached.timestamp).getTime() > cutoff) {
      return cached;
    }
  }

  return null;
}
