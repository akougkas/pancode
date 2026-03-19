import { EXIT_SUCCESS } from "./shared";

/**
 * pancode login: Delegates to Pi SDK's /login flow.
 * The Pi SDK handles OAuth and API key storage natively.
 */
export function login(): number {
  console.log("Use /login inside the PanCode shell to authenticate with providers.");
  console.log("PanCode delegates authentication to the Pi SDK.");
  return EXIT_SUCCESS;
}
