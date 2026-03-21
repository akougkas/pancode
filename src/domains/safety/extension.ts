import { BusChannel, type RunFinishedEvent, type WarningEvent } from "../../core/bus-events";
import { sharedBus } from "../../core/shared-bus";
import { PiEvent } from "../../engine/events";
import { defineExtension } from "../../engine/extensions";
import { classifyAction, classifyBashCommand, isActionAllowed } from "./action-classifier";
import { createLoopDetector } from "./loop-detector";
import { type AutonomyMode, parseAutonomyMode } from "./scope";
import { checkDispatchAdmission } from "./scope-enforcement";
import { type SafetyRules, checkBashCommand, checkPathAccess, loadSafetyRules } from "./yaml-rules";

let autonomyMode: AutonomyMode = "auto-edit";
const loopDetector = createLoopDetector();
let yamlRules: SafetyRules = { bashPatterns: [], zeroAccessPaths: [], readOnlyPaths: [], noDeletePaths: [] };

interface SafetyPreFlightContext {
  task: string;
  agent: string;
  model: string | null;
}

interface SafetyPreFlightResult {
  admit: boolean;
  reason?: string;
}

type RegisterPreFlight = (name: string, fn: (context: SafetyPreFlightContext) => SafetyPreFlightResult) => void;

export function registerSafetyPreFlightChecks(register: RegisterPreFlight): void {
  register("scope-enforcement", (context) => {
    const admission = checkDispatchAdmission(autonomyMode, autonomyMode);
    if (!admission.admitted) {
      return { admit: false, reason: admission.reason };
    }
    if (loopDetector.isBlocked(context.agent)) {
      return { admit: false, reason: `Agent ${context.agent} is blocked by loop detector (too many failures)` };
    }
    return { admit: true };
  });
}

export const extension = defineExtension((pi) => {
  pi.on(PiEvent.SESSION_START, (_event, _ctx) => {
    autonomyMode = parseAutonomyMode(process.env.PANCODE_SAFETY);

    // Load YAML safety rules (Layer 2)
    const packageRoot = process.env.PANCODE_PACKAGE_ROOT ?? process.cwd();
    yamlRules = loadSafetyRules(packageRoot);
    if (process.env.PANCODE_VERBOSE) {
      console.error(
        `[pancode:safety] Mode: ${autonomyMode}. YAML rules: ${yamlRules.bashPatterns.length} bash patterns, ` +
          `${yamlRules.zeroAccessPaths.length} zero-access, ${yamlRules.readOnlyPaths.length} read-only, ` +
          `${yamlRules.noDeletePaths.length} no-delete paths.`,
      );
    }

    // Subscribe to run-finished events for loop detection
    sharedBus.on(BusChannel.RUN_FINISHED, (raw: unknown) => {
      const payload = raw as RunFinishedEvent | null;
      const agent = typeof payload?.agent === "string" ? payload.agent : "unknown";
      if (payload?.status === "error") {
        const loopEvent = loopDetector.recordFailure(agent);
        if (loopEvent) {
          console.error(`[pancode:safety] Loop detector: ${loopEvent.message}`);
          const warning: WarningEvent = { source: "safety", message: loopEvent.message };
          sharedBus.emit(BusChannel.WARNING, warning);
        }
      } else if (payload?.status === "done") {
        loopDetector.recordSuccess(agent);
      }
    });
  });

  pi.on(PiEvent.TOOL_CALL, (event, _ctx) => {
    const actionClass = classifyAction(event.toolName);

    // Layer 1: Formal scope model
    if (!isActionAllowed(autonomyMode, actionClass)) {
      return { block: true, reason: `[pancode:safety] ${actionClass} blocked in ${autonomyMode} mode` };
    }

    // Layer 2: YAML rules (bash commands)
    if ((event.toolName === "bash" || event.toolName === "shell") && "command" in event.input) {
      const command = event.input.command as string;
      const bashAction = classifyBashCommand(command);
      if (!isActionAllowed(autonomyMode, bashAction)) {
        return { block: true, reason: `[pancode:safety] ${bashAction} blocked in ${autonomyMode} mode` };
      }
      const yamlCheck = checkBashCommand(command, yamlRules);
      if (yamlCheck.blocked) {
        return { block: true, reason: `[pancode:safety] YAML rule: ${yamlCheck.reason}` };
      }
    }

    // Layer 2: YAML rules (path access)
    const input = event.input as Record<string, unknown>;
    const filePath = input.file_path ?? input.path ?? input.file;
    if (typeof filePath === "string") {
      const pathAction = actionClass === "file_delete" ? "delete" : actionClass === "file_write" ? "write" : "read";
      const pathCheck = checkPathAccess(filePath, pathAction, yamlRules);
      if (pathCheck.blocked) {
        return { block: true, reason: `[pancode:safety] YAML rule: ${pathCheck.reason}` };
      }
    }

    return undefined;
  });
});
