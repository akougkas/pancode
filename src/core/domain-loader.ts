import type { ExtensionFactory } from "../engine/types";

export interface DomainManifest {
  name: string;
  dependsOn?: readonly string[];
}

export interface DomainDefinition {
  manifest: DomainManifest;
  extension: ExtensionFactory;
}

export type DomainRegistry = Record<string, DomainDefinition>;

function uniqueInOrder(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const value of values) {
    if (seen.has(value)) continue;
    seen.add(value);
    result.push(value);
  }

  return result;
}

function getRegistryEntry(name: string, registry: DomainRegistry): DomainDefinition {
  const entry = registry[name];
  if (!entry) {
    const available = Object.keys(registry).sort().join(", ");
    throw new Error(`Unknown domain "${name}". Available domains: ${available}`);
  }
  if (entry.manifest.name !== name) {
    throw new Error(`Domain registry key "${name}" does not match manifest name "${entry.manifest.name}".`);
  }
  return entry;
}

// Performs topological ordering of enabled domains based on their dependency graph
export function resolveDomainOrder(enabledDomains: readonly string[], registry: DomainRegistry): DomainDefinition[] {
  const enabled = uniqueInOrder(enabledDomains);
  if (enabled.length === 0) return [];

  const priority = new Map(enabled.map((name, index) => [name, index]));
  const enabledSet = new Set(enabled);
  const inDegree = new Map<string, number>();
  const dependents = new Map<string, string[]>();

  for (const name of enabled) {
    const entry = getRegistryEntry(name, registry);
    const dependencies = [...(entry.manifest.dependsOn ?? [])];
    inDegree.set(name, dependencies.length);

    for (const dependency of dependencies) {
      getRegistryEntry(dependency, registry);
      if (!enabledSet.has(dependency)) {
        throw new Error(`Domain "${name}" depends on "${dependency}", but "${dependency}" is not enabled.`);
      }

      const listeners = dependents.get(dependency) ?? [];
      listeners.push(name);
      dependents.set(dependency, listeners);
    }
  }

  const ready = enabled.filter((name) => (inDegree.get(name) ?? 0) === 0);
  const ordered: string[] = [];

  while (ready.length > 0) {
    ready.sort((left, right) => {
      const leftPriority = priority.get(left) ?? Number.MAX_SAFE_INTEGER;
      const rightPriority = priority.get(right) ?? Number.MAX_SAFE_INTEGER;
      return leftPriority === rightPriority ? left.localeCompare(right) : leftPriority - rightPriority;
    });

    const name = ready.shift();
    if (!name) break;
    ordered.push(name);

    for (const dependent of dependents.get(name) ?? []) {
      const nextDegree = (inDegree.get(dependent) ?? 0) - 1;
      inDegree.set(dependent, nextDegree);
      if (nextDegree === 0) ready.push(dependent);
    }
  }

  if (ordered.length !== enabled.length) {
    const remaining = enabled.filter((name) => !ordered.includes(name)).join(", ");
    throw new Error(`Domain dependency cycle detected: ${remaining}`);
  }

  return ordered.map((name) => registry[name]);
}

/**
 * Validate domain names against the registry. Returns only names that exist
 * in the registry. Unknown names are logged to stderr as warnings so a typo
 * in PANCODE_ENABLED_DOMAINS does not crash the boot sequence.
 */
export function filterValidDomains(requested: readonly string[], registry: DomainRegistry): string[] {
  const available = new Set(Object.keys(registry));
  const valid: string[] = [];

  for (const name of requested) {
    if (available.has(name)) {
      valid.push(name);
    } else {
      const known = [...available].sort().join(", ");
      process.stderr.write(`[pancode:domains] Unknown domain "${name}" (skipped). Available: ${known}\n`);
    }
  }

  return valid;
}

export function collectDomainExtensions(
  enabledDomains: readonly string[],
  registry: DomainRegistry,
): ExtensionFactory[] {
  return resolveDomainOrder(enabledDomains, registry).map((entry) => entry.extension);
}
