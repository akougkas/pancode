import { readFileSync } from "node:fs";
import { join } from "node:path";
import { EXIT_SUCCESS } from "./shared";

export function version(): number {
  const packageRoot = process.env.PANCODE_PACKAGE_ROOT ?? process.cwd();
  try {
    const pkg = JSON.parse(readFileSync(join(packageRoot, "package.json"), "utf8"));
    console.log(pkg.version ?? "unknown");
  } catch {
    console.log("unknown");
  }
  return EXIT_SUCCESS;
}
