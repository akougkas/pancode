/**
 * Cluster visibility: node-centric view of discovered engines.
 *
 * Pure visibility. No transport protocol, no network probes, no heartbeat.
 * Groups existing provider data by host into cluster nodes.
 */

export interface ClusterNode {
  name: string;
  host: string;
  engines: ClusterEngine[];
  capacity: number;
  status: "healthy" | "unknown";
}

export interface ClusterEngine {
  type: string;
  port: number;
  healthy: boolean;
  modelCount: number;
}

export interface ProviderInput {
  id: string;
  type: string;
  host: string;
  port: number;
  healthy: boolean;
  modelCount: number;
}

function parseNodeAliases(): Record<string, string> {
  // Read node name aliases from PANCODE_CLUSTER_ALIASES env var.
  // Format: "ip1=name1,ip2=name2" e.g., "192.168.86.141=mini,192.168.86.143=dynamo"
  const aliases: Record<string, string> = { "127.0.0.1": "local", localhost: "local" };
  const raw = process.env.PANCODE_CLUSTER_ALIASES;
  if (raw) {
    for (const pair of raw.split(",")) {
      const [ip, name] = pair.split("=").map((s) => s.trim());
      if (ip && name) aliases[ip] = name;
    }
  }
  return aliases;
}

function deriveNodeName(host: string): string {
  const aliases = parseNodeAliases();
  return aliases[host] ?? host;
}

export function buildClusterView(providers: ProviderInput[]): ClusterNode[] {
  const byHost = new Map<string, ProviderInput[]>();

  for (const provider of providers) {
    const group = byHost.get(provider.host) ?? [];
    group.push(provider);
    byHost.set(provider.host, group);
  }

  const nodes: ClusterNode[] = [];

  for (const [host, hostProviders] of byHost) {
    const engines: ClusterEngine[] = hostProviders.map((p) => ({
      type: p.type,
      port: p.port,
      healthy: p.healthy,
      modelCount: p.modelCount,
    }));

    const allHealthy = engines.every((e) => e.healthy);
    const anyHealthy = engines.some((e) => e.healthy);

    nodes.push({
      name: deriveNodeName(host),
      host,
      engines,
      capacity: engines.length,
      status: anyHealthy || allHealthy ? "healthy" : "unknown",
    });
  }

  return nodes.sort((a, b) => a.name.localeCompare(b.name));
}
