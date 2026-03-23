/**
 * ARC Memory: semantic context registry for cross-agent knowledge.
 *
 * Evolution of the shared board (explicit key-value) into a queryable memory
 * store. Agents write context entries with natural-language descriptions.
 * Other agents query by meaning rather than by known key names.
 *
 * Phase 1 uses TF-IDF-like term similarity for ranking. Future phases will
 * integrate a local embedding model (nomic-embed-text via Ollama) and vector
 * database (LanceDB) for true semantic search.
 *
 * Memory entries survive session compaction. Each entry tracks its producing
 * agent and dispatch, enabling full provenance chains.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { atomicWriteJsonSync, withFileLockSync } from "../../core/config-writer";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const MAX_ENTRIES = 2000;
const DEFAULT_DECAY_HALF_LIFE_MS = 3600_000; // 1 hour: recent entries score 2x versus hour-old ones

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface MemoryEntry {
  /** Unique identifier for this entry. */
  id: string;
  /** Human-readable description of what this context represents. */
  description: string;
  /** The actual content (code snippets, findings, decisions, etc.). */
  content: string;
  /** Agent that produced this entry. */
  source: string;
  /** Dispatch run ID that produced this entry, if applicable. */
  runId: string | null;
  /** Tags for coarse filtering before similarity search. */
  tags: string[];
  /** ISO timestamp when the entry was created. */
  createdAt: string;
  /** ISO timestamp of last access (for LRU-like eviction). */
  lastAccessedAt: string;
  /** Number of times this entry has been retrieved. */
  accessCount: number;
}

export interface MemoryQueryResult {
  entry: MemoryEntry;
  /** Relevance score (0 to 1, higher is more relevant). */
  score: number;
}

export interface MemoryQueryOptions {
  /** Maximum number of results to return (default: 10). */
  limit?: number;
  /** Minimum relevance score threshold (default: 0.01). */
  minScore?: number;
  /** Filter to entries from a specific agent. */
  source?: string;
  /** Filter to entries with at least one matching tag. */
  tags?: string[];
  /** Temporal decay half-life in milliseconds (default: 1 hour). */
  decayHalfLifeMs?: number;
}

// ---------------------------------------------------------------------------
// Text similarity (TF-IDF-inspired term frequency scoring)
// ---------------------------------------------------------------------------

/** Normalize text for term extraction: lowercase, strip punctuation, split on whitespace. */
function extractTerms(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\w\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 1);
}

/** Build a term frequency map for a set of terms. */
function termFrequency(terms: string[]): Map<string, number> {
  const freq = new Map<string, number>();
  for (const term of terms) {
    freq.set(term, (freq.get(term) ?? 0) + 1);
  }
  return freq;
}

/**
 * Compute cosine similarity between two term frequency vectors.
 * Returns a value between 0 and 1.
 */
function cosineSimilarity(a: Map<string, number>, b: Map<string, number>): number {
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (const [term, freq] of Array.from(a.entries())) {
    normA += freq * freq;
    const bFreq = b.get(term);
    if (bFreq !== undefined) {
      dotProduct += freq * bFreq;
    }
  }

  for (const freq of Array.from(b.values())) {
    normB += freq * freq;
  }

  if (normA === 0 || normB === 0) return 0;
  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

/**
 * Temporal decay factor. Recent entries get higher scores.
 * Uses exponential decay with configurable half-life.
 */
function temporalDecay(createdAt: string, halfLifeMs: number): number {
  const ageMs = Date.now() - new Date(createdAt).getTime();
  if (ageMs <= 0) return 1.0;
  return 0.5 ** (ageMs / halfLifeMs);
}

// ---------------------------------------------------------------------------
// ARC Memory implementation
// ---------------------------------------------------------------------------

export interface ArcMemory {
  /** Store a new context entry. Returns the entry ID. */
  store(entry: Omit<MemoryEntry, "id" | "createdAt" | "lastAccessedAt" | "accessCount">): string;

  /** Query memory by natural language. Returns ranked results. */
  query(queryText: string, options?: MemoryQueryOptions): MemoryQueryResult[];

  /** Get a specific entry by ID. */
  get(id: string): MemoryEntry | null;

  /** Get all entries from a specific source agent. */
  getBySource(source: string): MemoryEntry[];

  /** Get all entries matching any of the given tags. */
  getByTags(tags: string[]): MemoryEntry[];

  /** Delete a specific entry. */
  delete(id: string): boolean;

  /** Clear all entries. */
  clear(): void;

  /** Total number of entries. */
  size(): number;

  /** Persist current state to disk. */
  persist(): void;

  /** Export all entries for debugging or migration. */
  exportAll(): MemoryEntry[];
}

let nextId = 0;

function generateId(): string {
  const ts = Date.now().toString(36);
  const seq = (nextId++).toString(36).padStart(4, "0");
  return `arc-${ts}-${seq}`;
}

export function createArcMemory(runtimeRoot: string): ArcMemory {
  const filePath = join(runtimeRoot, "arc-memory.json");
  let store = loadMemoryStore(filePath);

  function save(): void {
    const data = Object.fromEntries(store.entries());
    atomicWriteJsonSync(filePath, data);
  }

  function evict(): void {
    if (store.size <= MAX_ENTRIES) return;

    // Sort by composite score: low access count + old timestamp = eviction candidate.
    const entries = Array.from(store.entries()).sort((a, b) => {
      // Primary: access count ascending
      const countDiff = a[1].accessCount - b[1].accessCount;
      if (countDiff !== 0) return countDiff;
      // Secondary: oldest first
      return a[1].lastAccessedAt.localeCompare(b[1].lastAccessedAt);
    });

    const toRemove = store.size - MAX_ENTRIES;
    for (let i = 0; i < toRemove; i++) {
      store.delete(entries[i][0]);
    }
  }

  return {
    store(partial: Omit<MemoryEntry, "id" | "createdAt" | "lastAccessedAt" | "accessCount">): string {
      const id = generateId();
      const now = new Date().toISOString();
      const entry: MemoryEntry = {
        ...partial,
        id,
        createdAt: now,
        lastAccessedAt: now,
        accessCount: 0,
      };

      withFileLockSync(filePath, () => {
        store = loadMemoryStore(filePath);
        store.set(id, entry);
        evict();
        save();
      });

      return id;
    },

    query(queryText: string, options?: MemoryQueryOptions): MemoryQueryResult[] {
      const limit = options?.limit ?? 10;
      const minScore = options?.minScore ?? 0.01;
      const halfLifeMs = options?.decayHalfLifeMs ?? DEFAULT_DECAY_HALF_LIFE_MS;

      const queryTerms = extractTerms(queryText);
      if (queryTerms.length === 0) return [];
      const queryTf = termFrequency(queryTerms);

      const results: MemoryQueryResult[] = [];

      for (const entry of Array.from(store.values())) {
        // Pre-filter by source if specified.
        if (options?.source && entry.source !== options.source) continue;

        // Pre-filter by tags if specified.
        if (options?.tags && options.tags.length > 0) {
          const hasMatch = options.tags.some((t) => entry.tags.includes(t));
          if (!hasMatch) continue;
        }

        // Compute term similarity on combined description + content.
        const entryText = `${entry.description} ${entry.content} ${entry.tags.join(" ")}`;
        const entryTerms = extractTerms(entryText);
        const entryTf = termFrequency(entryTerms);
        const similarity = cosineSimilarity(queryTf, entryTf);

        // Apply temporal decay.
        const decay = temporalDecay(entry.createdAt, halfLifeMs);
        const score = similarity * (0.7 + 0.3 * decay);

        if (score >= minScore) {
          results.push({ entry, score });
        }
      }

      // Sort by score descending.
      results.sort((a, b) => b.score - a.score);

      // Update access metadata for returned entries.
      const topResults = results.slice(0, limit);
      const now = new Date().toISOString();
      for (const r of topResults) {
        r.entry.lastAccessedAt = now;
        r.entry.accessCount++;
      }

      return topResults;
    },

    get(id: string): MemoryEntry | null {
      const entry = store.get(id);
      if (!entry) return null;
      entry.lastAccessedAt = new Date().toISOString();
      entry.accessCount++;
      return { ...entry };
    },

    getBySource(source: string): MemoryEntry[] {
      return Array.from(store.values()).filter((e) => e.source === source);
    },

    getByTags(tags: string[]): MemoryEntry[] {
      const tagSet = new Set(tags);
      return Array.from(store.values()).filter((e) => e.tags.some((t) => tagSet.has(t)));
    },

    delete(id: string): boolean {
      let existed = false;
      withFileLockSync(filePath, () => {
        store = loadMemoryStore(filePath);
        existed = store.delete(id);
        if (existed) save();
      });
      return existed;
    },

    clear(): void {
      withFileLockSync(filePath, () => {
        store = new Map();
        save();
      });
    },

    size(): number {
      return store.size;
    },

    persist(): void {
      save();
    },

    exportAll(): MemoryEntry[] {
      return Array.from(store.values());
    },
  };
}

// ---------------------------------------------------------------------------
// Persistence helpers
// ---------------------------------------------------------------------------

function loadMemoryStore(filePath: string): Map<string, MemoryEntry> {
  if (!existsSync(filePath)) return new Map();
  try {
    const raw = readFileSync(filePath, "utf-8");
    const data = JSON.parse(raw) as Record<string, MemoryEntry>;
    return new Map(Object.entries(data));
  } catch {
    return new Map();
  }
}

// ---------------------------------------------------------------------------
// Singleton access
// ---------------------------------------------------------------------------

let arcMemoryInstance: ArcMemory | null = null;

export function getArcMemory(runtimeRoot: string): ArcMemory {
  if (!arcMemoryInstance) {
    arcMemoryInstance = createArcMemory(runtimeRoot);
  }
  return arcMemoryInstance;
}

export function getExistingArcMemory(): ArcMemory | null {
  return arcMemoryInstance;
}
