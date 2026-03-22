import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { resolvePackageRoot } from "./core/package-root";

type LoaderTarget = "orchestrator" | "worker" | "cli" | "tmux-start";

const CLI_SUBCOMMANDS = new Set(["up", "down", "sessions", "login", "version"]);

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
    if (!process.env[key]) {
      process.env[key] = value;
    }
  }
}

function initializeEnvironment(): string {
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

interface ParsedLoaderArgs {
  target: LoaderTarget;
  cliSubcommand: string | null;
  forwardedArgs: string[];
}

function parseLoaderArgs(argv: string[]): ParsedLoaderArgs {
  let target: LoaderTarget = "orchestrator";
  let cliSubcommand: string | null = null;
  const forwardedArgs: string[] = [];

  // Handle --sessions as a top-level flag (convenience alias for `pancode sessions`)
  if (argv.includes("--sessions")) {
    return { target: "cli", cliSubcommand: "sessions", forwardedArgs: [] };
  }

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

  // Default (no subcommand): create a new tmux session unless we are
  // already inside one (set by start.ts before spawning the inner process).
  if (target === "orchestrator" && !process.env.PANCODE_INSIDE_TMUX) {
    target = "tmux-start";
  }

  return { target, cliSubcommand, forwardedArgs };
}

function isHelpRequest(args: string[]): boolean {
  return args.length === 1 && (args[0] === "--help" || args[0] === "-h");
}

function isVersionRequest(args: string[]): boolean {
  return args.length === 1 && (args[0] === "--version" || args[0] === "-v");
}

function printUsage(): void {
  console.log(`Usage:
  pancode                     Start a new session in tmux
  pancode --preset <name>     Start with a named preset
  pancode up [<name>]         Attach to a running session
  pancode down [<name>]       Stop a session (--all for all)
  pancode --sessions          List running sessions
  pancode login               Authenticate with providers
  pancode version             Show version

Options:
  --preset <name>             Boot preset (local, openai, hybrid, ...)
  --model <id>                Model override (provider/model-id)
  --provider <name>           Preferred provider
  --cwd <path>                Working directory
  --safety <level>            suggest | auto-edit | full-auto
  --sessions                  List all PanCode sessions
  --help, -h                  Show this help
  --version, -v               Show version

Sessions:
  Each "pancode" invocation creates a new tmux session.
  Use "pancode up" to reattach and "pancode down" to stop.
  Sessions are named pancode, pancode-2, pancode-3, etc.`);
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

  if (parsed.target === "tmux-start") {
    const { runCliCommand } = await import("./cli/index");
    const exitCode = runCliCommand("start", parsed.forwardedArgs);
    process.exit(exitCode);
  }

  // target === "orchestrator" (inside tmux)
  await import("./entry/orchestrator");
}

async function main(): Promise<void> {
  const packageRoot = initializeEnvironment();
  const ver = resolveVersion(packageRoot);
  const parsed = parseLoaderArgs(process.argv.slice(2));

  if (isVersionRequest(parsed.forwardedArgs)) {
    console.log(ver);
    return;
  }

  if (isHelpRequest(parsed.forwardedArgs)) {
    printUsage();
    return;
  }

  process.argv = [
    process.argv[0] ?? "node",
    process.env.PANCODE_BIN_PATH ?? process.argv[1] ?? "pancode",
    ...parsed.forwardedArgs,
  ];
  process.env.PANCODE_ENTRYPOINT = parsed.target === "tmux-start" ? "orchestrator" : parsed.target;

  await loadTarget(parsed);
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[pancode:loader] ${message}`);
  process.exit(1);
});
