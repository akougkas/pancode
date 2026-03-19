// src/core/package-root.ts
import { existsSync } from "fs";
import { dirname, join, resolve } from "path";
import { fileURLToPath } from "url";
var cachedPackageRoot = null;
function resolvePackageRoot(metaUrl = import.meta.url) {
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

export {
  resolvePackageRoot
};
//# sourceMappingURL=chunk-RRR3VFYK.js.map