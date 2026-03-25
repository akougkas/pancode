/**
 * PI SDK UPGRADE CHECKLIST
 *
 * This file patches Pi SDK internals that are not part of any public API.
 * When upgrading the Pi SDK, verify all of the following:
 *
 * 1. BUILTIN_SLASH_COMMANDS is still an Array (not frozen, not a Proxy).
 *    patchBuiltinCommands() casts ReadonlyArray to Array and splices entries.
 *    If the SDK freezes this array or uses a getter, splicing will throw or
 *    silently fail. The guard at line ~56 logs a warning if the type changes.
 *
 * 2. InteractiveMode.prototype method names have not been renamed:
 *    - showSettingsSelector, handleModelCommand, showModelsSelector
 *    - handleClearCommand, handleCompactCommand, handleReloadCommand
 *    - handleSessionCommand, handleHotkeysCommand
 *    Each patch has a typeof guard that logs a warning if the method is
 *    missing. Search for "WARNING:" in this file to find all guards.
 *
 * 3. Pi SDK's hardcoded command dispatch in the submit handler still routes
 *    to the prototype methods listed above. If the SDK changes its routing
 *    (e.g., to a command registry), the prototype patches will stop working
 *    even though the typeof guards pass.
 *
 * 4. CustomEditor.actionHandlers is still a public Map<string, () => void>.
 *    The UI extension replaces the "cycleThinkingLevel" action handler. If
 *    actionHandlers becomes private or the action name changes, the override
 *    silently fails and Shift+Tab reverts to Pi's thinking level cycling.
 */
import { BUILTIN_SLASH_COMMANDS } from "@pancode/pi-coding-agent/core/slash-commands.js";
import { BusChannel } from "../core/bus-events";
import { sharedBus } from "../core/shared-bus";
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
 * Pi SDK builtins that PanCode replaces entirely. Every built-in command is
 * spliced out of the array so none appear in Pi's autocomplete or help.
 * PanCode registers its own commands via extension registerCommand().
 *
 * The built-in routing still works because Pi SDK hardcodes command dispatch
 * in its submit handler. We patch the corresponding prototype methods below
 * to inject PanCode behavior.
 */
const HIDDEN_BUILTIN_NAMES = new Set([
  "model",
  // "scoped-models" is NOT hidden. Pi's /scoped-models controls Ctrl+P model
  // cycling scope. Users need access to configure which models appear in the
  // cycle. Pass-through to Pi's native handler.
  "settings",
  "export",
  "share",
  "copy",
  "name",
  "session",
  "changelog",
  "hotkeys",
  "fork",
  "tree",
  "login",
  "logout",
  "new",
  "compact",
  // "resume" is NOT hidden. Pi's /resume enables session switching. Users may
  // want to resume a previous session. Pass-through to Pi's native handler.
  // "quit" is NOT hidden. Pi's /quit provides a native exit command that users
  // expect. PanCode's /exit is an alias registered via the UI domain.
  "reload",
]);

function patchBuiltinCommands(): void {
  // BUILTIN_SLASH_COMMANDS is typed ReadonlyArray but is a plain JS array at runtime.
  // Mutating it is the only way to control what Pi SDK exposes in autocomplete and help.
  if (!Array.isArray(BUILTIN_SLASH_COMMANDS)) {
    console.error("[pancode] WARNING: BUILTIN_SLASH_COMMANDS is not an array. Builtin command hiding skipped.");
    return;
  }
  const commands = BUILTIN_SLASH_COMMANDS as unknown as Array<{ name: string; description: string }>;

  // Remove all commands PanCode shadows. Iterate backwards to avoid index shift.
  for (let i = commands.length - 1; i >= 0; i--) {
    if (HIDDEN_BUILTIN_NAMES.has(commands[i].name)) {
      commands.splice(i, 1);
    }
  }
}

async function routeToShellCommand(mode: ShellPatchedInteractiveMode, command: string): Promise<void> {
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
    // Already patched in v0.1.0
    showSettingsSelector?: () => void;
    handleModelCommand?: (searchTerm?: string) => Promise<void>;
    showModelsSelector?: () => Promise<void>;
    // New patches for v0.1.2: command surface takeover
    handleClearCommand?: () => Promise<void>;
    handleCompactCommand?: (customInstructions?: string) => Promise<void>;
    handleReloadCommand?: () => Promise<void>;
    handleSessionCommand?: () => void;
    handleExportCommand?: (text: string) => Promise<void>;
    handleCopyCommand?: () => void;
    handleHotkeysCommand?: () => void;
    showUserMessageSelector?: () => void;
    showTreeSelector?: () => void;
    showOAuthSelector?: (mode: "login" | "logout") => void;
    showSessionSelector?: () => void;
    shutdown?: () => Promise<void>;
  };

  // === Settings ===
  if (typeof prototype.showSettingsSelector === "function") {
    prototype.showSettingsSelector = function showSettingsSelector(this: ShellPatchedInteractiveMode) {
      void routeToShellCommand(this, "/settings");
    };
  } else {
    console.error("[pancode] WARNING: InteractiveMode.showSettingsSelector not found. Settings patch skipped.");
  }

  // === Models ===
  // /modes (plural) avoids the Pi SDK prefix collision entirely: the SDK's
  // hardcoded check for "/model" or "/model " never matches "/modes".
  // The defensive reroute below is kept as a safety net in case future SDK
  // changes introduce new prefix-matching behavior.
  const MODE_NAMES = new Set(["admin", "plan", "build", "review"]);
  if (typeof prototype.handleModelCommand === "function") {
    prototype.handleModelCommand = async function handleModelCommand(
      this: ShellPatchedInteractiveMode,
      searchTerm?: string,
    ) {
      // Safety net: if Pi SDK somehow routes /modes as /model with searchTerm
      // "s" or "s <mode>", reroute to the /modes extension command.
      const trimmed = searchTerm?.trim() ?? "";
      if (trimmed === "s" || trimmed.startsWith("s ")) {
        const possibleMode = trimmed.slice(1).trim().toLowerCase();
        if (possibleMode === "" || MODE_NAMES.has(possibleMode)) {
          await routeToShellCommand(this, `/modes ${possibleMode}`.trim());
          return;
        }
      }
      const suffix = trimmed ? ` ${trimmed}` : "";
      await routeToShellCommand(this, `/models${suffix}`);
    };
  } else {
    console.error("[pancode] WARNING: InteractiveMode.handleModelCommand not found. Model command patch skipped.");
  }

  if (typeof prototype.showModelsSelector === "function") {
    prototype.showModelsSelector = async function showModelsSelector(this: ShellPatchedInteractiveMode) {
      await routeToShellCommand(this, "/models");
    };
  }

  // === /new: emit reset event before Pi creates a new session ===
  if (typeof prototype.handleClearCommand === "function") {
    const originalClear = prototype.handleClearCommand;
    prototype.handleClearCommand = async function handleClearCommand(this: ShellPatchedInteractiveMode) {
      sharedBus.emit(BusChannel.SESSION_RESET, {});
      if (originalClear) {
        await originalClear.call(this);
      }
    };
  }

  // === /compact: emit compaction event, then call Pi's handler ===
  if (typeof prototype.handleCompactCommand === "function") {
    const originalCompact = prototype.handleCompactCommand;
    prototype.handleCompactCommand = async function handleCompactCommand(
      this: ShellPatchedInteractiveMode,
      customInstructions?: string,
    ) {
      sharedBus.emit(BusChannel.COMPACTION_STARTED, { customInstructions: customInstructions ?? null });
      if (originalCompact) {
        await originalCompact.call(this, customInstructions);
      }
    };
  }

  // === /reload: emit event, then call Pi's handler ===
  if (typeof prototype.handleReloadCommand === "function") {
    const originalReload = prototype.handleReloadCommand;
    prototype.handleReloadCommand = async function handleReloadCommand(this: ShellPatchedInteractiveMode) {
      if (originalReload) {
        await originalReload.call(this);
      }
      sharedBus.emit(BusChannel.EXTENSIONS_RELOADED, {});
    };
  }

  // === /session: route to PanCode wrapper that adds domain state summary ===
  if (typeof prototype.handleSessionCommand === "function") {
    prototype.handleSessionCommand = function handleSessionCommand(this: ShellPatchedInteractiveMode) {
      void routeToShellCommand(this, "/session");
    };
  }

  // === /hotkeys: route to PanCode handler that shows correct extension shortcuts ===
  if (typeof prototype.handleHotkeysCommand === "function") {
    prototype.handleHotkeysCommand = function handleHotkeysCommand(this: ShellPatchedInteractiveMode) {
      void routeToShellCommand(this, "/hotkeys");
    };
  }

  // Pass-through commands: Pi's hardcoded routing calls these methods directly.
  // We let them execute their Pi behavior unchanged. PanCode owns them visually
  // through the categorized /help but does not need to modify their execution.
  // The methods below are NOT patched: handleExportCommand, handleCopyCommand,
  // showUserMessageSelector, showTreeSelector, showOAuthSelector,
  // showSessionSelector, shutdown.
  // They retain their original Pi implementations.
}
