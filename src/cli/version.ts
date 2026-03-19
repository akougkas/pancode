import { readFileSync } from "node:fs";
import { join } from "node:path";
import { EXIT_SUCCESS } from "./shared";

export function version(): number {
  const packageRoot = process.env.PANCODE_PACKAGE_ROOT ?? process.cwd();
  try {
    const pkg = JSON.parse(readFileSync(join(packageRoot, "package.json"), "utf8"));
    console.log(pkg.version ?? "0.1.0");
  } catch {
    console.log("0.1.0");
  }
  return EXIT_SUCCESS;
}
