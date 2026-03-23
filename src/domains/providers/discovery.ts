import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import YAML from "yaml";
import { createLlamaCppConnection } from "./engines/llamacpp";
import { createLmStudioConnection } from "./engines/lmstudio";
import { createOllamaConnection } from "./engines/ollama";
import type { DiscoveredModel, EngineConnection, EngineType } from "./engines/types";

interface KnownService {
  type: EngineType;
  name: string;
  defaultPort: number;
  factory: (baseUrl: string, providerId: string, probeTimeoutMs?: number) => EngineConnection;
}

interface LocalMachine {
  name: string;
  address: string;
}

export interface DiscoveryResult {
  providerId: string;
  engine: EngineType;
  baseUrl: string;
  models: DiscoveredModel[];
  connection: EngineConnection;
}

const KNOWN_SERVICES: readonly KnownService[] = [
  {
    type: "lmstudio",
    name: "LM Studio",
    defaultPort: 1234,
    factory: createLmStudioConnection,
  },
  {
    type: "ollama",
    name: "Ollama",
    defaultPort: 11434,
    factory: createOllamaConnection,
  },
  {
    type: "llamacpp",
    name: "llama.cpp",
    defaultPort: 8080,
    factory: createLlamaCppConnection,
  },
] as const;

function parseLocalMachinesEnv(): LocalMachine[] {
  const raw = process.env.PANCODE_LOCAL_MACHINES?.trim();
  if (!raw) return [];

  const seen = new Set<string>();
  const machines: LocalMachine[] = [];

  for (const entry of raw.split(",")) {
    const [namePart, addressPart] = entry.split("=", 2).map((v) => v?.trim() ?? "");
    if (!namePart || !addressPart || seen.has(namePart)) continue;
    seen.add(namePart);
    machines.push({ name: namePart, address: addressPart });
  }

  return machines;
}

function getLocalMachines(): LocalMachine[] {
  const builtin: LocalMachine = { name: "localhost", address: "localhost" };
  const additional = parseLocalMachinesEnv().filter((m) => m.name !== builtin.name);
  return [builtin, ...additional];
}

function normalizeProviderFragment(value: string): string {
  return (
    value
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "local"
  );
}

function buildProviderId(machine: LocalMachine, service: KnownService): string {
  const machineName = normalizeProviderFragment(machine.name);
  return machineName === "localhost" ? `local-${service.type}` : `${machineName}-${service.type}`;
}

function buildServiceUrl(address: string, port: number): string {
  if (address === "localhost" || address === "127.0.0.1") {
    return `http://127.0.0.1:${port}`;
  }
  return `http://${address}:${port}`;
}

// Tiered probe timeouts: known-good endpoints from last boot get a fast
// timeout since they should respond in <50ms on a LAN. Unknown or previously
// unreachable endpoints get a standard timeout. This eliminates the 3-second
// wall time from dead endpoint timeouts that dominated boot latency.
const FAST_PROBE_TIMEOUT_MS = 500;
const DEFAULT_PROBE_TIMEOUT_MS = 1000;

function loadCachedProviderUrls(): Set<string> {
  const pancodeHome = process.env.PANCODE_HOME;
  if (!pancodeHome) return new Set();

  const filePath = join(pancodeHome, "panproviders.yaml");
  try {
    const content = readFileSync(filePath, "utf8");
    const parsed = YAML.parse(content) as { providers?: Array<{ baseUrl?: string }> };
    const urls = new Set<string>();
    for (const p of parsed?.providers ?? []) {
      if (p.baseUrl) urls.add(p.baseUrl);
    }
    return urls;
  } catch {
    return new Set();
  }
}

function resolveProbeTimeout(baseUrl: string, cachedUrls: Set<string>): number {
  const envTimeout = Number.parseInt(process.env.PANCODE_PROBE_TIMEOUT_MS ?? "", 10);
  if (Number.isFinite(envTimeout) && envTimeout > 0) return envTimeout;
  return cachedUrls.has(baseUrl) ? FAST_PROBE_TIMEOUT_MS : DEFAULT_PROBE_TIMEOUT_MS;
}

export async function discoverEngines(): Promise<DiscoveryResult[]> {
  const machines = getLocalMachines();
  const cachedUrls = loadCachedProviderUrls();
  const results: DiscoveryResult[] = [];

  const tasks = machines.flatMap((machine) =>
    KNOWN_SERVICES.map(async (service) => {
      const baseUrl = buildServiceUrl(machine.address, service.defaultPort);
      const providerId = buildProviderId(machine, service);
      const timeout = resolveProbeTimeout(baseUrl, cachedUrls);
      const connection = service.factory(baseUrl, providerId, timeout);

      const reachable = await connection.connect();
      if (!reachable) {
        connection.disconnect();
        return null;
      }

      const models = await connection.listModels();
      if (models.length === 0) {
        connection.disconnect();
        return null;
      }

      return { providerId, engine: service.type, baseUrl, models, connection };
    }),
  );

  const settled = await Promise.allSettled(tasks);
  for (const outcome of settled) {
    if (outcome.status === "fulfilled" && outcome.value) {
      results.push(outcome.value);
    }
  }

  return results;
}

export function writeProvidersYaml(results: DiscoveryResult[], pancodeHome: string): void {
  const providers = results.map((r) => ({
    providerId: r.providerId,
    engine: r.engine,
    baseUrl: r.baseUrl,
    modelCount: r.models.length,
    models: r.models.map((m) => m.id),
    discoveredAt: new Date().toISOString(),
  }));

  const filePath = join(pancodeHome, "panproviders.yaml");
  const tempPath = `${filePath}.tmp`;
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(tempPath, YAML.stringify({ providers }), "utf8");
  renameSync(tempPath, filePath);
}
