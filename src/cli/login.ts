import { EXIT_SUCCESS } from "./shared";

/**
 * pancode login: points users to the in-shell provider authentication flow.
 */
export function login(): number {
  console.log("Use /login inside the PanCode shell to authenticate with providers.");
  console.log("PanCode will guide you through provider login from the interactive shell.");
  return EXIT_SUCCESS;
}
