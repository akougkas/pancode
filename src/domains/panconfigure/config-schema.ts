/**
 * Hierarchical schema of all user-configurable PanCode parameters.
 *
 * Each entry describes one param: its key, type, default, description,
 * whether it can be applied without restart, and whether it requires Admin mode.
 */

export interface ConfigParamDef {
  key: string;
  defaultValue: unknown;
  type: "string" | "number" | "boolean" | "enum" | "array";
  options?: string[];
  description: string;
  hotReload: boolean;
  adminOnly: boolean;
  domain: string;
  /** Environment variable backing this param, if any. */
  envVar?: string;
  /** Settings-state key in the global settings file, if any. */
  settingsKey?: string;
}

export const CONFIG_SCHEMA: ReadonlyArray<ConfigParamDef> = [
  // runtime domain
  {
    key: "runtime.safety",
    defaultValue: "auto-edit",
    type: "enum",
    options: ["suggest", "auto-edit", "full-auto"],
    description: "Autonomy level controlling which tool actions are allowed without confirmation.",
    hotReload: true,
    adminOnly: false,
    domain: "runtime",
    envVar: "PANCODE_SAFETY",
    settingsKey: "safetyMode",
  },
  {
    key: "runtime.mode",
    defaultValue: "build",
    type: "enum",
    options: ["admin", "plan", "build", "review"],
    description: "Orchestrator behavior mode controlling dispatch, shadow agents, and mutation permissions.",
    hotReload: true,
    adminOnly: false,
    domain: "runtime",
  },
  {
    key: "runtime.reasoning",
    defaultValue: "medium",
    type: "enum",
    options: ["off", "minimal", "low", "medium", "high", "xhigh"],
    description: "Reasoning effort level for the orchestrator model.",
    hotReload: true,
    adminOnly: false,
    domain: "runtime",
    envVar: "PANCODE_REASONING",
    settingsKey: "reasoningPreference",
  },
  {
    key: "runtime.theme",
    defaultValue: "dark",
    type: "enum",
    options: ["dark", "light"],
    description: "TUI color theme.",
    hotReload: true,
    adminOnly: false,
    domain: "runtime",
    envVar: "PANCODE_THEME",
    settingsKey: "theme",
  },
  {
    key: "runtime.intelligence",
    defaultValue: false,
    type: "boolean",
    description: "Enable the intelligence domain for adaptive dispatch rule learning.",
    hotReload: true,
    adminOnly: false,
    domain: "runtime",
    envVar: "PANCODE_INTELLIGENCE",
    settingsKey: "intelligence",
  },

  // models domain
  {
    key: "models.orchestrator",
    defaultValue: "",
    type: "string",
    description: "Provider and model ID for the orchestrator (e.g. anthropic/claude-sonnet-4-20250514).",
    hotReload: false,
    adminOnly: false,
    domain: "models",
    envVar: "PANCODE_MODEL",
    settingsKey: "preferredModel",
  },
  {
    key: "models.worker",
    defaultValue: "",
    type: "string",
    description: "Provider and model ID for dispatch workers.",
    hotReload: true,
    adminOnly: false,
    domain: "models",
    envVar: "PANCODE_WORKER_MODEL",
    settingsKey: "workerModel",
  },
  {
    key: "models.scout",
    defaultValue: "",
    type: "string",
    description: "Provider and model ID for shadow scout agents.",
    hotReload: true,
    adminOnly: false,
    domain: "models",
    envVar: "PANCODE_SCOUT_MODEL",
  },

  // budget domain
  {
    key: "budget.ceiling",
    defaultValue: 10.0,
    type: "number",
    description: "Maximum session spend in dollars before the budget gate blocks dispatch.",
    hotReload: true,
    adminOnly: false,
    domain: "budget",
    envVar: "PANCODE_BUDGET_CEILING",
    settingsKey: "budgetCeiling",
  },

  // dispatch domain (expert params, adminOnly)
  {
    key: "dispatch.timeout",
    defaultValue: 300000,
    type: "number",
    description: "Worker subprocess timeout in milliseconds.",
    hotReload: true,
    adminOnly: true,
    domain: "dispatch",
    envVar: "PANCODE_DISPATCH_TIMEOUT",
  },
  {
    key: "dispatch.maxDepth",
    defaultValue: 2,
    type: "number",
    description: "Maximum recursive dispatch depth for nested worker invocations.",
    hotReload: true,
    adminOnly: true,
    domain: "dispatch",
    envVar: "PANCODE_DISPATCH_MAX_DEPTH",
  },
  {
    key: "dispatch.concurrency",
    defaultValue: 4,
    type: "number",
    description: "Maximum number of concurrent worker subprocesses.",
    hotReload: true,
    adminOnly: true,
    domain: "dispatch",
    envVar: "PANCODE_DISPATCH_CONCURRENCY",
  },
  {
    key: "dispatch.heartbeatInterval",
    defaultValue: 10000,
    type: "number",
    description: "Worker heartbeat interval in milliseconds.",
    hotReload: true,
    adminOnly: true,
    domain: "dispatch",
    envVar: "PANCODE_HEARTBEAT_INTERVAL_MS",
  },
  {
    key: "dispatch.workerTimeout",
    defaultValue: 300000,
    type: "number",
    description: "Worker subprocess timeout in milliseconds (per-spawn).",
    hotReload: true,
    adminOnly: true,
    domain: "dispatch",
    envVar: "PANCODE_WORKER_TIMEOUT_MS",
  },

  // preset domain
  {
    key: "preset.active",
    defaultValue: "",
    type: "string",
    description: "Active configuration preset name (e.g. local, cloud, hybrid).",
    hotReload: false,
    adminOnly: false,
    domain: "preset",
    envVar: "PANCODE_PRESET",
  },
];

const schemaByKey = new Map<string, ConfigParamDef>(CONFIG_SCHEMA.map((p) => [p.key, p]));

/** Lookup a schema definition by key. */
export function getParamDef(key: string): ConfigParamDef | undefined {
  return schemaByKey.get(key);
}

/** List all unique domain names in the schema. */
export function getConfigDomains(): string[] {
  return [...new Set(CONFIG_SCHEMA.map((p) => p.domain))].sort();
}
