export interface ClusterNode {
  name: string;
  host: string;
  port: number;
  provider: string;
  maxConcurrency: number;
  available: boolean;
}

const SERVICE_PORTS: Record<string, number> = {
  "lm-studio": 1234,
  ollama: 11434,
  "llama-server": 8080,
};

/**
 * Build cluster nodes from PANCODE_LOCAL_MACHINES env var.
 * Format: "name=address,name=address"
 * Each machine is probed for known services at their default ports.
 * No hardcoded IPs or hostnames in source.
 */
function buildClusterNodesFromEnv(): ClusterNode[] {
  const raw = process.env.PANCODE_LOCAL_MACHINES?.trim();
  if (!raw) return [];

  const nodes: ClusterNode[] = [];
  const concurrencyEnv = process.env.PANCODE_NODE_CONCURRENCY?.trim();

  for (const entry of raw.split(",")) {
    const [name, address] = entry.split("=", 2).map((v) => v?.trim() ?? "");
    if (!name || !address) continue;

    for (const [provider, port] of Object.entries(SERVICE_PORTS)) {
      const nodeName = `${name}-${provider.replace("-", "")}`;
      const defaultConcurrency = Number.parseInt(concurrencyEnv ?? "4", 10) || 4;

      nodes.push({
        name: nodeName,
        host: address,
        port,
        provider,
        maxConcurrency: defaultConcurrency,
        available: false,
      });
    }
  }

  return nodes;
}

export class ClusterRegistry {
  private readonly nodes: ClusterNode[] = [];

  constructor(initialNodes?: ClusterNode[]) {
    this.nodes.push(...(initialNodes ?? buildClusterNodesFromEnv()));
  }

  getAll(): ClusterNode[] {
    return [...this.nodes];
  }

  getAvailable(): ClusterNode[] {
    return this.nodes.filter((n) => n.available);
  }

  getTotalCapacity(): number {
    return this.nodes.reduce((sum, n) => sum + (n.available ? n.maxConcurrency : 0), 0);
  }

  markAvailable(name: string, available: boolean): void {
    const node = this.nodes.find((n) => n.name === name);
    if (node) node.available = available;
  }
}
