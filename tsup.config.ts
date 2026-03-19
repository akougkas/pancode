import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    loader: "src/loader.ts",
    "worker/cli-entry": "src/worker/cli-entry.ts",
    "worker/entry": "src/worker/entry.ts",
    "worker/safety-ext": "src/worker/safety-ext.ts",
  },
  format: ["esm"],
  target: "node20",
  platform: "node",
  sourcemap: true,
  clean: true,
  outDir: "dist",
  // Do not bundle workspace packages; they install as dependencies
  external: [
    "@pancode/pi-coding-agent",
    "@pancode/pi-tui",
    "@pancode/pi-ai",
    "@pancode/pi-agent-core",
    "@lmstudio/sdk",
    "ollama",
    "yaml",
    "@sinclair/typebox",
  ],
  // Do not bundle Node.js built-ins
  noExternal: [],
});
