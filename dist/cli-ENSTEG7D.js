import "./chunk-DGUM43GV.js";

// src/cli/up.ts
import { execSync as execSync2 } from "child_process";

// src/cli/shared.ts
import { execSync } from "child_process";
var EXIT_SUCCESS = 0;
var EXIT_FAILURE = 1;
var PANCODE_TMUX_SESSION = "pancode";
function isTmuxAvailable() {
  try {
    execSync("tmux -V", { stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}
function isTmuxSessionRunning(sessionName = PANCODE_TMUX_SESSION) {
  try {
    execSync(`tmux has-session -t ${sessionName}`, { stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}

// src/cli/up.ts
function up(args) {
  if (!isTmuxAvailable()) {
    console.error("[pancode:cli] tmux is not installed. Run PanCode directly with: npm start");
    return EXIT_FAILURE;
  }
  if (isTmuxSessionRunning()) {
    console.log(`PanCode session "${PANCODE_TMUX_SESSION}" is already running. Attaching...`);
    try {
      execSync2(`tmux attach-session -t ${PANCODE_TMUX_SESSION}`, { stdio: "inherit" });
    } catch {
    }
    return EXIT_SUCCESS;
  }
  const binPath = process.env.PANCODE_BIN_PATH ?? "src/loader.ts";
  const extraArgs = args.length > 0 ? ` ${args.join(" ")}` : "";
  const cmd = `node --import tsx ${binPath}${extraArgs}`;
  console.log(`Starting PanCode in tmux session "${PANCODE_TMUX_SESSION}"...`);
  try {
    execSync2(`tmux new-session -d -s ${PANCODE_TMUX_SESSION} '${cmd}'`, { stdio: "pipe" });
    execSync2(`tmux attach-session -t ${PANCODE_TMUX_SESSION}`, { stdio: "inherit" });
  } catch {
  }
  return EXIT_SUCCESS;
}

// src/cli/down.ts
import { execSync as execSync3 } from "child_process";
function down() {
  if (!isTmuxSessionRunning()) {
    console.log("No PanCode tmux session is running.");
    return EXIT_SUCCESS;
  }
  console.log(`Stopping PanCode session "${PANCODE_TMUX_SESSION}"...`);
  try {
    execSync3(`tmux send-keys -t ${PANCODE_TMUX_SESSION} C-c`, { stdio: "pipe" });
    execSync3("sleep 2", { stdio: "pipe" });
    if (isTmuxSessionRunning()) {
      execSync3(`tmux kill-session -t ${PANCODE_TMUX_SESSION}`, { stdio: "pipe" });
    }
    console.log("PanCode session stopped.");
  } catch {
    console.error("[pancode:cli] Failed to stop PanCode session.");
    return EXIT_FAILURE;
  }
  return EXIT_SUCCESS;
}

// src/cli/login.ts
function login() {
  console.log("Use /login inside the PanCode shell to authenticate with providers.");
  console.log("PanCode delegates authentication to the Pi SDK.");
  return EXIT_SUCCESS;
}

// src/cli/version.ts
import { readFileSync } from "fs";
import { join } from "path";
function version() {
  const packageRoot = process.env.PANCODE_PACKAGE_ROOT ?? process.cwd();
  try {
    const pkg = JSON.parse(readFileSync(join(packageRoot, "package.json"), "utf8"));
    console.log(pkg.version ?? "0.1.0");
  } catch {
    console.log("0.1.0");
  }
  return EXIT_SUCCESS;
}

// src/cli/index.ts
function runCliCommand(command, args) {
  switch (command) {
    case "up":
      return up(args);
    case "down":
      return down();
    case "login":
      return login();
    case "version":
      return version();
    default:
      console.error(`[pancode:cli] Unknown command: ${command}. Available: up, down, login, version`);
      return EXIT_FAILURE;
  }
}
export {
  runCliCommand
};
//# sourceMappingURL=cli-ENSTEG7D.js.map