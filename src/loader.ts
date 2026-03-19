import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { resolvePackageRoot } from "./core/package-root";
import { formatPanCodeCliUsage } from "./core/shell-metadata";

type LoaderTarget = "orchestrator" | "worker" | "cli";

const CLI_SUBCOMMANDS = new Set(["up", "down", "login", "version"]);

function resolveVersion(packageRoot: string): string {
  try {
    const packageJsonPath = join(packageRoot, "package.json");
    const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8")) as { version?: unknown };
    return typeof packageJson.version === "string" ? packageJson.version : "0.0.0";
  } catch {
    return "0.0.0";
  }
}

function loadEnvFile(packageRoot: string): void {
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
    // Only set if not already defined (real env takes precedence)
    if (!process.env[key]) {
      process.env[key] = value;
    }
  }
}

function initializeEnvironment(): string {
  const packageRoot = resolvePackageRoot(import.meta.url);

  // Load .env before anything else (real env vars take precedence)
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

interface ParsedLoaderArgs {
  target: LoaderTarget;
  cliSubcommand: string | null;
  forwardedArgs: string[];
}

function parseLoaderArgs(argv: string[]): ParsedLoaderArgs {
  let target: LoaderTarget = "orchestrator";
  let cliSubcommand: string | null = null;
  const forwardedArgs: string[] = [];

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];

    if (arg === "--worker") {
      target = "worker";
      continue;
    }

    // First positional arg that matches a CLI subcommand routes to the CLI
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

function isHelpRequest(args: string[]): boolean {
  return args.length === 1 && (args[0] === "--help" || args[0] === "-h");
}

function isVersionRequest(args: string[]): boolean {
  return args.length === 1 && (args[0] === "--version" || args[0] === "-v");
}

async function loadTarget(parsed: ParsedLoaderArgs): Promise<void> {
  if (parsed.target === "worker") {
    await import("./worker/entry");
    return;
  }

  if (parsed.target === "cli" && parsed.cliSubcommand) {
    const { runCliCommand } = await import("./cli/index");
    const exitCode = runCliCommand(parsed.cliSubcommand, parsed.forwardedArgs);
    process.exit(exitCode);
  }

  await import("./entry/orchestrator");
}

async function main(): Promise<void> {
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
