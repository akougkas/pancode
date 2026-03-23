/**
 * SSH node configuration parsed from PANCODE_SSH_NODES env var.
 *
 * Format: name=user@host[:port],name=user@host[:port]
 * Example: PANCODE_SSH_NODES=dragon=akougkas@192.168.86.143,zbook=akougkas@192.168.86.249
 *
 * No hardcoded hostnames or IPs. All SSH configuration comes from env vars.
 */

export interface SshNode {
  name: string;
  user: string;
  host: string;
  port: number;
  maxConcurrent: number;
}

export function parseSshNodes(): SshNode[] {
  const raw = process.env.PANCODE_SSH_NODES?.trim();
  if (!raw) return [];

  const nodes: SshNode[] = [];
  for (const entry of raw.split(",")) {
    const trimmed = entry.trim();
    if (!trimmed) continue;

    const eqIndex = trimmed.indexOf("=");
    if (eqIndex === -1) continue;

    const name = trimmed.slice(0, eqIndex).trim();
    const connection = trimmed.slice(eqIndex + 1).trim();

    // Parse user@host[:port]
    const atIndex = connection.indexOf("@");
    if (atIndex === -1) continue;

    const user = connection.slice(0, atIndex);
    const hostPort = connection.slice(atIndex + 1);
    const colonIndex = hostPort.lastIndexOf(":");
    const host = colonIndex === -1 ? hostPort : hostPort.slice(0, colonIndex);
    const port = colonIndex === -1 ? 22 : Number.parseInt(hostPort.slice(colonIndex + 1), 10) || 22;

    const maxStr = process.env.PANCODE_SSH_MAX_CONCURRENT?.trim();
    const maxConcurrent = maxStr ? Number.parseInt(maxStr, 10) || 8 : 8;

    nodes.push({ name, user, host, port, maxConcurrent });
  }

  return nodes;
}

export function getSshNode(name: string): SshNode | undefined {
  return parseSshNodes().find((n) => n.name === name);
}

export function getSshNodeNames(): string[] {
  return parseSshNodes().map((n) => n.name);
}

// ---------------------------------------------------------------------------
// Concurrency guard: track active SSH connections per node
// ---------------------------------------------------------------------------

const activeConnections = new Map<string, number>();

export function acquireSshSlot(nodeName: string): boolean {
  const node = getSshNode(nodeName);
  if (!node) return false;
  const current = activeConnections.get(nodeName) ?? 0;
  if (current >= node.maxConcurrent) return false;
  activeConnections.set(nodeName, current + 1);
  return true;
}

export function releaseSshSlot(nodeName: string): void {
  const current = activeConnections.get(nodeName) ?? 0;
  activeConnections.set(nodeName, Math.max(0, current - 1));
}

export function getActiveSshConnections(nodeName: string): number {
  return activeConnections.get(nodeName) ?? 0;
}

// ---------------------------------------------------------------------------
// Shell escaping for safe SSH command construction
// ---------------------------------------------------------------------------

/** Escape a string for safe inclusion in a single-quoted shell argument. */
export function shellEscape(value: string): string {
  // Wrap in single quotes. Escape internal single quotes with '\''
  return `'${value.replace(/'/g, "'\\''")}'`;
}
