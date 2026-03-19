import { up } from "./up";
import { down } from "./down";
import { login } from "./login";
import { version } from "./version";
import { EXIT_FAILURE } from "./shared";

export function runCliCommand(command: string, args: string[]): number {
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
