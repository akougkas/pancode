import { BUILTIN_SLASH_COMMANDS } from "@pancode/pi-coding-agent/core/slash-commands.js";
import { PANCODE_PRODUCT_NAME } from "../core/shell-metadata";
import { InteractiveMode } from "./session";

interface ShellPatchedInteractiveMode {
  session: {
    prompt: (text: string) => Promise<unknown>;
  };
  editor: {
    setText: (text: string) => void;
  };
  ui?: {
    requestRender?: () => void;
  };
  updatePendingMessagesDisplay?: () => void;
}

/**
 * Pi SDK builtins that PanCode replaces entirely. These are spliced out of
 * the array so they never appear in Pi's autocomplete or help rendering.
 * The actual routing still works because Pi SDK hardcodes the method calls
 * in its submit handler (handleModelCommand, showModelsSelector, etc.) and
 * we patch those on the prototype below.
 */
const HIDDEN_BUILTIN_NAMES = new Set(["model", "scoped-models"]);

/**
 * Pi SDK builtins that PanCode intercepts but keeps visible with rebranded
 * descriptions so they match PanCode's command surface.
 */
const REBRANDED_DESCRIPTIONS: Record<string, string> = {
  settings: "Open PanCode preferences",
  quit: `Exit ${PANCODE_PRODUCT_NAME}`,
};

function patchBuiltinCommands(): void {
  // BUILTIN_SLASH_COMMANDS is typed ReadonlyArray but is a plain JS array at runtime.
  // Mutating it is the only way to control what Pi SDK exposes in autocomplete and help.
  const commands = BUILTIN_SLASH_COMMANDS as unknown as Array<{ name: string; description: string }>;

  // Remove commands PanCode replaces entirely. Iterate backwards to avoid index shift.
  for (let i = commands.length - 1; i >= 0; i--) {
    if (HIDDEN_BUILTIN_NAMES.has(commands[i].name)) {
      commands.splice(i, 1);
    }
  }

  // Rebrand commands PanCode intercepts but keeps visible.
  for (const command of commands) {
    const description = REBRANDED_DESCRIPTIONS[command.name];
    if (description) {
      command.description = description;
    }
  }
}

async function routeToShellCommand(
  mode: ShellPatchedInteractiveMode,
  command: string,
): Promise<void> {
  mode.editor.setText("");
  await mode.session.prompt(command);
  mode.updatePendingMessagesDisplay?.();
  mode.ui?.requestRender?.();
}

let installed = false;

export function installPanCodeShellOverrides(): void {
  if (installed) return;
  installed = true;

  patchBuiltinCommands();

  const prototype = InteractiveMode.prototype as unknown as {
    showSettingsSelector?: () => void;
    handleModelCommand?: (searchTerm?: string) => Promise<void>;
    showModelsSelector?: () => Promise<void>;
  };

  prototype.showSettingsSelector = function showSettingsSelector(this: ShellPatchedInteractiveMode) {
    void routeToShellCommand(this, "/preferences");
  };

  prototype.handleModelCommand = async function handleModelCommand(
    this: ShellPatchedInteractiveMode,
    searchTerm?: string,
  ) {
    const suffix = searchTerm?.trim() ? ` ${searchTerm.trim()}` : "";
    await routeToShellCommand(this, `/models${suffix}`);
  };

  prototype.showModelsSelector = async function showModelsSelector(this: ShellPatchedInteractiveMode) {
    await routeToShellCommand(this, "/models");
  };
}
