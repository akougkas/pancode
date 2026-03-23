/**
 * Model favorites and recents tracking.
 *
 * Persists favorite models in PanCode settings and tracks recently
 * used models from dispatch history. Powers the /models switch
 * interface with quick-access model selection.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { atomicWriteJsonSync } from "../../core/config-writer";

export interface ModelFavorite {
  /** Full model ID (provider/model-name). */
  modelId: string;
  /** When the favorite was added. */
  addedAt: string;
  /** User-provided alias (optional). */
  alias?: string;
}

export interface ModelRecent {
  /** Full model ID (provider/model-name). */
  modelId: string;
  /** Last time this model was used. */
  lastUsedAt: string;
  /** Number of times this model was used in recent dispatches. */
  useCount: number;
}

export interface ModelSelection {
  favorites: ModelFavorite[];
  recents: ModelRecent[];
}

/** Maximum number of recent models to track. */
const MAX_RECENTS = 10;

function favoritesPath(pancodeHome: string): string {
  return join(pancodeHome, "model-favorites.json");
}

/**
 * Load model favorites from the PanCode home directory.
 */
export function loadFavorites(pancodeHome: string): ModelFavorite[] {
  const path = favoritesPath(pancodeHome);
  if (!existsSync(path)) return [];

  try {
    const raw = readFileSync(path, "utf8");
    const data = JSON.parse(raw) as { favorites?: ModelFavorite[] };
    return Array.isArray(data.favorites) ? data.favorites : [];
  } catch {
    return [];
  }
}

/**
 * Save model favorites to the PanCode home directory.
 */
export function saveFavorites(pancodeHome: string, favorites: ModelFavorite[]): void {
  const path = favoritesPath(pancodeHome);
  atomicWriteJsonSync(path, { favorites });
}

/**
 * Add a model to favorites.
 */
export function addFavorite(pancodeHome: string, modelId: string, alias?: string): void {
  const favorites = loadFavorites(pancodeHome);
  const existing = favorites.find((f) => f.modelId === modelId);
  if (existing) {
    if (alias) existing.alias = alias;
    saveFavorites(pancodeHome, favorites);
    return;
  }

  favorites.push({
    modelId,
    addedAt: new Date().toISOString(),
    alias,
  });
  saveFavorites(pancodeHome, favorites);
}

/**
 * Remove a model from favorites.
 */
export function removeFavorite(pancodeHome: string, modelId: string): void {
  const favorites = loadFavorites(pancodeHome).filter((f) => f.modelId !== modelId);
  saveFavorites(pancodeHome, favorites);
}

/**
 * Track a model usage for the recents list.
 * Maintains a rolling window of the last MAX_RECENTS unique models.
 */
export function recordModelUsage(recents: ModelRecent[], modelId: string): ModelRecent[] {
  const existing = recents.find((r) => r.modelId === modelId);
  if (existing) {
    existing.lastUsedAt = new Date().toISOString();
    existing.useCount++;
  } else {
    recents.push({
      modelId,
      lastUsedAt: new Date().toISOString(),
      useCount: 1,
    });
  }

  // Sort by last used (most recent first) and trim to MAX_RECENTS
  recents.sort((a, b) => b.lastUsedAt.localeCompare(a.lastUsedAt));
  if (recents.length > MAX_RECENTS) {
    recents.length = MAX_RECENTS;
  }

  return recents;
}

/**
 * Build a model selection view combining favorites and recents.
 */
export function buildModelSelection(pancodeHome: string, recents: ModelRecent[]): ModelSelection {
  return {
    favorites: loadFavorites(pancodeHome),
    recents: recents.slice(0, MAX_RECENTS),
  };
}
