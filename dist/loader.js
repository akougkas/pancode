import {
  formatPanCodeCliUsage
} from "./chunk-2XWO6ZNN.js";
import {
  resolvePackageRoot
} from "./chunk-RRR3VFYK.js";
import "./chunk-DGUM43GV.js";

// src/loader.ts
import { existsSync, readFileSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import { fileURLToPath } from "url";
var CLI_SUBCOMMANDS = /* @__PURE__ */ new Set(["up", "down", "login", "version"]);
function resolveVersion(packageRoot) {
  try {
    const packageJsonPath = join(packageRoot, "package.json");
    const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8"));
    return typeof packageJson.version === "string" ? packageJson.version : "0.0.0";
  } catch {
    return "0.0.0";
  }
}
function loadEnvFile(packageRoot) {
  const envPath = join(packageRoot, ".env");
  if (!existsSync(envPath)) return;
  const content = readFileSync(envPath, "utf8");
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIndex = trimmed.indexOf("=");
    if (eqIndex === -1) continue;
    const key = trimmed.slice(0, eqIndex).trim();
    const value = trimmed.slice(eqIndex + 1).trim();
    if (!process.env[key]) {
      process.env[key] = value;
    }
  }
}
function initializeEnvironment() {
  const packageRoot = resolvePackageRoot(import.meta.url);
  loadEnvFile(packageRoot);
  const pancodeHome = process.env.PANCODE_HOME?.trim() || join(homedir(), ".pancode");
  const agentDir = join(pancodeHome, "agent-engine");
  process.env.PANCODE_PACKAGE_ROOT = packageRoot;
  process.env.PANCODE_BIN_PATH = fileURLToPath(import.meta.url);
  process.env.PANCODE_HOME = pancodeHome;
  process.env.PANCODE_AGENT_DIR = agentDir;
  process.env.PI_CODING_AGENT_DIR = process.env.PI_CODING_AGENT_DIR?.trim() || agentDir;
  return packageRoot;
}
function parseLoaderArgs(argv) {
  let target = "orchestrator";
  let cliSubcommand = null;
  const forwardedArgs = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--worker") {
      target = "worker";
      continue;
    }
    if (cliSubcommand === null && !arg.startsWith("-") && CLI_SUBCOMMANDS.has(arg)) {
      target = "cli";
      cliSubcommand = arg;
      forwardedArgs.push(...argv.slice(i + 1));
      break;
    }
    forwardedArgs.push(arg);
  }
  return { target, cliSubcommand, forwardedArgs };
}
function isHelpRequest(args) {
  return args.length === 1 && (args[0] === "--help" || args[0] === "-h");
}
function isVersionRequest(args) {
  return args.length === 1 && (args[0] === "--version" || args[0] === "-v");
}
async function loadTarget(parsed) {
  if (parsed.target === "worker") {
    await import("./worker/entry.js");
    return;
  }
  if (parsed.target === "cli" && parsed.cliSubcommand) {
    const { runCliCommand } = await import("./cli-ENSTEG7D.js");
    const exitCode = runCliCommand(parsed.cliSubcommand, parsed.forwardedArgs);
    process.exit(exitCode);
  }
  await import("./orchestrator-OAXAMMVD.js");
}
async function main() {
  const packageRoot = initializeEnvironment();
  const version = resolveVersion(packageRoot);
  const parsed = parseLoaderArgs(process.argv.slice(2));
  if (parsed.target === "orchestrator" && isHelpRequest(parsed.forwardedArgs)) {
    console.log(formatPanCodeCliUsage("orchestrator"));
    console.log("\nSubcommands:");
    console.log("  up                      Start PanCode in a tmux session");
    console.log("  down                    Stop the PanCode tmux session");
    console.log("  login                   Authenticate with providers");
    console.log("  version                 Show PanCode version");
    return;
  }
  if (parsed.target === "worker" && isHelpRequest(parsed.forwardedArgs)) {
    console.log(formatPanCodeCliUsage("worker"));
    return;
  }
  if (isVersionRequest(parsed.forwardedArgs)) {
    console.log(version);
    return;
  }
  process.argv = [process.argv[0] ?? "node", process.env.PANCODE_BIN_PATH ?? process.argv[1] ?? "pancode", ...parsed.forwardedArgs];
  process.env.PANCODE_ENTRYPOINT = parsed.target;
  await loadTarget(parsed);
}
main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[pancode:loader] ${message}`);
  process.exit(1);
});
//# sourceMappingURL=loader.js.map