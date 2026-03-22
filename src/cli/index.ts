import { down } from "./down";
import { login } from "./login";
import { sessions } from "./sessions";
import { EXIT_FAILURE } from "./shared";
import { start } from "./start";
import { up } from "./up";
import { version } from "./version";

export function runCliCommand(command: string, args: string[]): number {
  switch (command) {
    case "start":
      return start(args);
    case "up":
      return up(args);
    case "down":
      return down(args);
    case "sessions":
      return sessions();
    case "login":
      return login();
    case "version":
      return version();
    default:
      console.error(`[pancode] Unknown command: ${command}. Try: pancode --help`);
      return EXIT_FAILURE;
  }
}
