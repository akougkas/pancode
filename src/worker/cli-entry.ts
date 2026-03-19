import { type ChildProcess, spawn } from "node:child_process";

interface ParsedArgs {
  binary: string;
  parentPid: number;
  childArgs: string[];
}

function fail(message: string): never {
  console.error(`[pancode:cli-wrapper] ${message}`);
  process.exit(1);
}

function parseArgs(argv: string[]): ParsedArgs {
  let binary = "";
  let parentPid = 0;
  let childArgs: string[] = [];

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--") {
      childArgs = argv.slice(index + 1);
      break;
    }

    if (arg === "--binary") {
      binary = argv[++index] ?? "";
      continue;
    }

    if (arg === "--parent-pid") {
      parentPid = Number.parseInt(argv[++index] ?? "", 10);
      continue;
    }

    fail(`Unknown argument: ${arg}`);
  }

  if (!binary) fail("Missing --binary");
  if (!Number.isInteger(parentPid) || parentPid <= 0) fail("Invalid --parent-pid");

  return { binary, parentPid, childArgs };
}

function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function terminateChild(child: ChildProcess, signal: NodeJS.Signals = "SIGTERM"): void {
  if (child.exitCode !== null || child.killed) return;
  try {
    child.kill(signal);
  } catch {
    // Ignore already-exited children.
  }
}

const { binary, parentPid, childArgs } = parseArgs(process.argv.slice(2));

const child = spawn(binary, childArgs, {
  cwd: process.cwd(),
  env: process.env,
  shell: false,
  stdio: ["ignore", "pipe", "pipe"],
});

child.stdout?.on("data", (chunk: Buffer) => {
  process.stdout.write(chunk);
});

child.stderr?.on("data", (chunk: Buffer) => {
  process.stderr.write(chunk);
});

const monitor = setInterval(() => {
  if (child.exitCode !== null) return;
  if (!isPidAlive(parentPid)) {
    terminateChild(child, "SIGTERM");
    setTimeout(() => terminateChild(child, "SIGKILL"), 3000).unref();
  }
}, 2000);
monitor.unref();

const forwardSignal = (signal: NodeJS.Signals) => {
  terminateChild(child, signal);
  setTimeout(() => terminateChild(child, "SIGKILL"), 3000).unref();
};

process.on("SIGINT", () => forwardSignal("SIGINT"));
process.on("SIGTERM", () => forwardSignal("SIGTERM"));
process.on("exit", () => {
  terminateChild(child, "SIGTERM");
});

child.on("close", (code) => {
  clearInterval(monitor);
  process.exit(code ?? 1);
});

child.on("error", (error) => {
  clearInterval(monitor);
  console.error(`[pancode:cli-wrapper] ${error.message}`);
  process.exit(1);
});
