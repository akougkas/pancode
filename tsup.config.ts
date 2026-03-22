import { defineConfig } from "tsup";

export default defineConfig([
  // CLI entry point (needs shebang for `pancode` binary)
  {
    entry: { loader: "src/loader.ts" },
    format: ["esm"],
    target: "node20",
    platform: "node",
    sourcemap: true,
    clean: true,
    outDir: "dist",
    banner: {
      js: "#!/usr/bin/env node",
    },
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
    noExternal: [],
  },
  // Worker entry points (no shebang, spawned by the orchestrator)
  {
    entry: {
      "worker/cli-entry": "src/worker/cli-entry.ts",
      "worker/entry": "src/worker/entry.ts",
      "worker/safety-ext": "src/worker/safety-ext.ts",
    },
    format: ["esm"],
    target: "node20",
    platform: "node",
    sourcemap: true,
    clean: false,
    outDir: "dist",
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
    noExternal: [],
  },
]);
