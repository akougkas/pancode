import { mkdirSync } from "node:fs";
import { homedir, platform } from "node:os";
import { join } from "node:path";

let cachedDataDir: string | undefined;
let cachedCacheDir: string | undefined;
let cachedConfigDir: string | undefined;

function home(): string {
  return homedir();
}

/**
 * Resolve the platform-appropriate default directories for data, cache, and config.
 * Linux follows the XDG Base Directory Specification. macOS uses ~/Library paths.
 * Windows uses %APPDATA% and %LOCALAPPDATA%.
 */
function platformDefaults(): { data: string; cache: string; config: string } {
  const p = platform();
  const h = home();

  if (p === "win32") {
    const appData = process.env.APPDATA ?? join(h, "AppData", "Roaming");
    const localAppData = process.env.LOCALAPPDATA ?? join(h, "AppData", "Local");
    return {
      data: join(appData, "pancode"),
      cache: join(localAppData, "Temp", "pancode"),
      config: join(appData, "pancode"),
    };
  }

  if (p === "darwin") {
    return {
      data: join(h, "Library", "Application Support", "pancode"),
      cache: join(h, "Library", "Caches", "pancode"),
      config: join(h, "Library", "Application Support", "pancode"),
    };
  }

  // Linux and other POSIX platforms: follow XDG specification.
  const xdgData = process.env.XDG_DATA_HOME ?? join(h, ".local", "share");
  const xdgCache = process.env.XDG_CACHE_HOME ?? join(h, ".cache");
  const xdgConfig = process.env.XDG_CONFIG_HOME ?? join(h, ".config");
  return {
    data: join(xdgData, "pancode"),
    cache: join(xdgCache, "pancode"),
    config: join(xdgConfig, "pancode"),
  };
}

function ensureDir(dir: string): string {
  mkdirSync(dir, { recursive: true });
  return dir;
}

/**
 * Resolve override priority:
 * 1. PANCODE_DATA_HOME / PANCODE_CACHE_HOME / PANCODE_CONFIG_HOME (absolute priority)
 * 2. PANCODE_HOME (legacy single-dir mode)
 * 3. Platform XDG defaults
 */
function resolve(): { data: string; cache: string; config: string } {
  const specificData = process.env.PANCODE_DATA_HOME;
  const specificCache = process.env.PANCODE_CACHE_HOME;
  const specificConfig = process.env.PANCODE_CONFIG_HOME;

  // If any specific override is set, use it for that directory and fall through for the rest.
  const hasSpecific = specificData || specificCache || specificConfig;

  const legacyHome = process.env.PANCODE_HOME;

  let base: { data: string; cache: string; config: string };
  if (legacyHome && !hasSpecific) {
    // Legacy single-dir mode: all directories derive from PANCODE_HOME.
    base = {
      data: legacyHome,
      cache: join(legacyHome, "cache"),
      config: legacyHome,
    };
  } else {
    base = platformDefaults();
  }

  return {
    data: specificData ?? base.data,
    cache: specificCache ?? base.cache,
    config: specificConfig ?? base.config,
  };
}

/** Returns the PanCode data directory, creating it if necessary. */
export function getDataDir(): string {
  if (cachedDataDir !== undefined) return cachedDataDir;
  const dirs = resolve();
  cachedDataDir = ensureDir(dirs.data);
  return cachedDataDir;
}

/** Returns the PanCode cache directory, creating it if necessary. */
export function getCacheDir(): string {
  if (cachedCacheDir !== undefined) return cachedCacheDir;
  const dirs = resolve();
  cachedCacheDir = ensureDir(dirs.cache);
  return cachedCacheDir;
}

/** Returns the PanCode config directory, creating it if necessary. */
export function getConfigDir(): string {
  if (cachedConfigDir !== undefined) return cachedConfigDir;
  const dirs = resolve();
  cachedConfigDir = ensureDir(dirs.config);
  return cachedConfigDir;
}

/**
 * Returns the agent-engine subdirectory within the data directory.
 * PI_CODING_AGENT_DIR should be set to this path for Pi SDK compatibility.
 */
export function getAgentEngineDir(): string {
  return ensureDir(join(getDataDir(), "agent-engine"));
}
