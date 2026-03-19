import { execSync } from "node:child_process";

export const EXIT_SUCCESS = 0;
export const EXIT_FAILURE = 1;

export const PANCODE_TMUX_SESSION = "pancode";

export function isTmuxAvailable(): boolean {
  try {
    execSync("tmux -V", { stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}

export function isTmuxSessionRunning(sessionName: string = PANCODE_TMUX_SESSION): boolean {
  try {
    execSync(`tmux has-session -t ${sessionName}`, { stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}
