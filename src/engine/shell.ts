import { PANCODE_PRODUCT_NAME } from "../core/shell-metadata";
import { InteractiveMode, type InteractiveModeOptions } from "./session";
import { installPanCodeShellOverrides } from "./shell-overrides";
import type { AgentSession } from "./types";

export interface PanCodeInteractiveShellOptions extends InteractiveModeOptions {}

export class PanCodeInteractiveShell {
  readonly productName = PANCODE_PRODUCT_NAME;
  private readonly mode: InstanceType<typeof InteractiveMode>;

  constructor(session: AgentSession, options: PanCodeInteractiveShellOptions = {}) {
    installPanCodeShellOverrides();
    this.mode = new InteractiveMode(session, {
      verbose: false,
      ...options,
    });
  }

  async run(): Promise<void> {
    await this.mode.run();
  }

  stop(): void {
    this.mode.stop();
  }
}
