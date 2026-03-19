import { mkdirSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

function writeTempFile(path: string, contents: string): string {
  mkdirSync(dirname(path), { recursive: true });
  const tempPath = `${path}.tmp-${process.pid}-${Date.now()}`;
  writeFileSync(tempPath, contents, "utf8");
  return tempPath;
}

export function atomicWriteTextSync(path: string, contents: string): void {
  const tempPath = writeTempFile(path, contents);
  renameSync(tempPath, path);
}

export function atomicWriteJsonSync(path: string, value: unknown): void {
  atomicWriteTextSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

export async function atomicWriteText(path: string, contents: string): Promise<void> {
  atomicWriteTextSync(path, contents);
}

export async function atomicWriteJson(path: string, value: unknown): Promise<void> {
  atomicWriteJsonSync(path, value);
}

