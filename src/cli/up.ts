import { execSync } from "node:child_process";
import { EXIT_FAILURE, EXIT_SUCCESS, PANCODE_TMUX_SESSION, isTmuxAvailable, isTmuxSessionRunning } from "./shared";

export function up(args: string[]): number {
  if (!isTmuxAvailable()) {
    console.error("[pancode:cli] tmux is not installed. Run PanCode directly with: npm start");
    return EXIT_FAILURE;
  }

  if (isTmuxSessionRunning()) {
    console.log(`PanCode session "${PANCODE_TMUX_SESSION}" is already running. Attaching...`);
    try {
      execSync(`tmux attach-session -t ${PANCODE_TMUX_SESSION}`, { stdio: "inherit" });
    } catch {
      // User detached or session ended
    }
    return EXIT_SUCCESS;
  }

  const binPath = process.env.PANCODE_BIN_PATH ?? "src/loader.ts";
  const extraArgs = args.length > 0 ? ` ${args.join(" ")}` : "";
  const cmd = `node --import tsx ${binPath}${extraArgs}`;

  console.log(`Starting PanCode in tmux session "${PANCODE_TMUX_SESSION}"...`);
  try {
    execSync(`tmux new-session -d -s ${PANCODE_TMUX_SESSION} '${cmd}'`, { stdio: "pipe" });
    execSync(`tmux attach-session -t ${PANCODE_TMUX_SESSION}`, { stdio: "inherit" });
  } catch {
    // User detached or session ended
  }

  return EXIT_SUCCESS;
}
