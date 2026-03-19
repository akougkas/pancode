import type { ModelRegistry } from "../../engine/session";

export function registerApiProvidersOnRegistry(
  _modelRegistry: InstanceType<typeof ModelRegistry>,
  _projectRoot: string,
): string[] {
  // Phase 1b keeps provider registration minimal. Custom API providers land later.
  return [];
}
