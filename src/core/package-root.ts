import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

let cachedPackageRoot: string | null = null;

export function resolvePackageRoot(metaUrl = import.meta.url) {
  if (cachedPackageRoot) return cachedPackageRoot;

  const override = process.env.PANCODE_PACKAGE_ROOT?.trim();
  if (override) {
    cachedPackageRoot = resolve(override);
    return cachedPackageRoot;
  }

  let dir = resolve(dirname(fileURLToPath(metaUrl)));

  while (true) {
    if (existsSync(join(dir, "package.json"))) {
      cachedPackageRoot = dir;
      return dir;
    }

    const parent = dirname(dir);
    if (parent === dir) {
      throw new Error(`Could not find package.json above ${dir}`);
    }

    dir = parent;
  }
}

export function resetPackageRootCache() {
  cachedPackageRoot = null;
}
