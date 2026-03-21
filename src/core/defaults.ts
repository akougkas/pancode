export const DEFAULT_PROMPT = "list files in the current directory";
export const DEFAULT_TOOLS = "read,bash,grep,find,ls";
export const DEFAULT_TIMEOUT_MS = 120_000;
export const DEFAULT_PROFILE = "standard";
export const DEFAULT_THEME = "pancode-dark";
export const DEFAULT_SAFETY = "auto-edit" as const;
export const DEFAULT_REASONING_PREFERENCE = "medium" as const;
export const DEFAULT_THINKING_LEVEL = "medium" as const;
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
