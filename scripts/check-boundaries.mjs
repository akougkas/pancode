import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

const projectRoot = process.cwd();
const srcRoot = path.join(projectRoot, "src");
const engineRoot = path.join(srcRoot, "engine");
const workerRoot = path.join(srcRoot, "worker");
const domainsRoot = path.join(srcRoot, "domains");

function walk(dir) {
  const entries = readdirSync(dir, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...walk(fullPath));
      continue;
    }
    if (entry.isFile() && (fullPath.endsWith(".ts") || fullPath.endsWith(".tsx") || fullPath.endsWith(".mts"))) {
      files.push(fullPath);
    }
  }

  return files;
}

function isWithin(childPath, parentPath) {
  const relative = path.relative(parentPath, childPath);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function extractSpecifiers(source) {
  const specifiers = [];
  const regex = /\bfrom\s*["']([^"']+)["']|\bimport\s*\(\s*["']([^"']+)["']\s*\)/g;

  for (const match of source.matchAll(regex)) {
    const specifier = match[1] ?? match[2];
    if (specifier) specifiers.push(specifier);
  }

  return specifiers;
}

function resolveRelativeImport(fromFile, specifier) {
  const candidate = path.resolve(path.dirname(fromFile), specifier);
  const candidates = [
    candidate,
    `${candidate}.ts`,
    `${candidate}.tsx`,
    `${candidate}.mts`,
    path.join(candidate, "index.ts"),
    path.join(candidate, "index.tsx"),
    path.join(candidate, "index.mts"),
  ];

  for (const item of candidates) {
    try {
      if (statSync(item).isFile()) return item;
    } catch {
      // Ignore missing path candidates.
    }
  }

  return candidate;
}

const violations = [];

for (const filePath of walk(srcRoot)) {
  const source = readFileSync(filePath, "utf8");
  const specifiers = extractSpecifiers(source);

  for (const specifier of specifiers) {
    // safety-ext.ts runs inside the pi subprocess and must import Pi SDK directly
    const isSafetyExt = filePath === path.join(workerRoot, "safety-ext.ts");
    if (!isWithin(filePath, engineRoot) && !isSafetyExt && (specifier.startsWith("@pancode/pi-") || specifier.startsWith("@mariozechner/pi-"))) {
      violations.push(`${path.relative(projectRoot, filePath)} imports ${specifier} outside src/engine`);
    }

    if (!isWithin(filePath, workerRoot)) continue;

    if (specifier.startsWith(".")) {
      const resolved = resolveRelativeImport(filePath, specifier);
      if (isWithin(resolved, domainsRoot)) {
        violations.push(`${path.relative(projectRoot, filePath)} imports ${specifier} from src/domains`);
      }
      continue;
    }

    if (specifier === "src/domains" || specifier.startsWith("src/domains/")) {
      violations.push(`${path.relative(projectRoot, filePath)} imports ${specifier} from src/domains`);
    }
  }
}

if (violations.length > 0) {
  console.error("Boundary check failed:");
  for (const violation of violations) {
    console.error(`- ${violation}`);
  }
  process.exit(1);
}

console.log("Boundary check passed.");
