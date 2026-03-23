export const DEFAULT_PROMPT = "list files in the current directory";
export const DEFAULT_TOOLS = "read,bash,grep,find,ls";
export const DEFAULT_TIMEOUT_MS = 120_000;
export const DEFAULT_PROFILE = "standard";
export const DEFAULT_THEME = "pancode-dark";
export const DEFAULT_SAFETY = "auto-edit" as const;
export const DEFAULT_REASONING_PREFERENCE = "medium" as const;
export const DEFAULT_THINKING_LEVEL = "medium" as const;
// Ring buffer limits configurable via environment variables.
// PANCODE_MAX_RUNS controls dispatch run history; PANCODE_MAX_METRICS controls metric history.
export const DEFAULT_MAX_RUNS = 500;
export const DEFAULT_MAX_METRICS = 1000;
// Startup performance budget. If total boot time exceeds this value, a warning
// is logged to stderr identifying the slowest phase. Configurable via env var.
export const DEFAULT_STARTUP_BUDGET_MS = 3000;

export const DEFAULT_ENABLED_DOMAINS = [
  "safety",
  "session",
  "agents",
  "prompts",
  "dispatch",
  "observability",
  "scheduling",
  "ui",
] as const;
