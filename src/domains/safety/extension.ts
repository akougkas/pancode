import { BusChannel, type RunFinishedEvent, type WarningEvent } from "../../core/bus-events";
import { sharedBus } from "../../core/shared-bus";
import { PiEvent } from "../../engine/events";
import { defineExtension } from "../../engine/extensions";
import { classifyAction, classifyBashCommand, isActionAllowed } from "./action-classifier";
import { type SafetyReasonCode, recordAuditEntry } from "./audit";
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

/**
 * Record a safety decision in the audit log with structured reason code.
 * Every tool call evaluation produces an audit entry, whether allowed or blocked.
 */
function recordSafetyDecision(
  toolName: string,
  actionClass: string,
  allowed: boolean,
  reasonCode: SafetyReasonCode,
  reasonDetail: string,
): void {
  recordAuditEntry({
    timestamp: new Date().toISOString(),
    toolName,
    actionClass: actionClass as import("./scope").ActionClass,
    autonomyMode,
    allowed,
    reason: reasonDetail,
    reasonCode,
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

    // Safety policy enforcement: check the policy matrix for the current autonomy mode.
    // This is the inner gate (policy). The outer gate (mode/structural) is handled by
    // pi.setActiveTools() which physically hides tools the model should not see.
    if (!isActionAllowed(autonomyMode, actionClass)) {
      const detail = `Safety level "${autonomyMode}" blocks ${actionClass}. Change safety level to allow this action.`;
      recordSafetyDecision(event.toolName, actionClass, false, "SAFETY_POLICY", detail);
      return {
        block: true,
        reason: `[pancode:safety] ${detail}`,
      };
    }

    // Layer 2b: Elevated bash classification (destructive patterns, git push, etc.)
    if ((event.toolName === "bash" || event.toolName === "shell") && "command" in event.input) {
      const command = event.input.command as string;
      const bashAction = classifyBashCommand(command);
      if (!isActionAllowed(autonomyMode, bashAction)) {
        const detail = `Safety level "${autonomyMode}" blocks ${bashAction}. Command classified as destructive.`;
        recordSafetyDecision(event.toolName, bashAction, false, "MODE_GATE", detail);
        return {
          block: true,
          reason: `[pancode:safety] ${detail}`,
        };
      }
      const yamlCheck = checkBashCommand(command, yamlRules);
      if (yamlCheck.blocked) {
        const detail = `YAML rule: ${yamlCheck.reason}`;
        recordSafetyDecision(event.toolName, bashAction, false, "YAML_RULE", detail);
        return { block: true, reason: `[pancode:safety] ${detail}` };
      }
    }

    // Layer 2: YAML rules (path access)
    const input = event.input as Record<string, unknown>;
    const filePath = input.file_path ?? input.path ?? input.file;
    if (typeof filePath === "string") {
      const pathAction = actionClass === "file_delete" ? "delete" : actionClass === "file_write" ? "write" : "read";
      const pathCheck = checkPathAccess(filePath, pathAction, yamlRules);
      if (pathCheck.blocked) {
        const detail = `YAML rule: ${pathCheck.reason}`;
        recordSafetyDecision(event.toolName, actionClass, false, "YAML_RULE", detail);
        return { block: true, reason: `[pancode:safety] ${detail}` };
      }
    }

    // Action allowed: record audit entry for the allow decision.
    recordSafetyDecision(event.toolName, actionClass, true, "SAFETY_POLICY", "Allowed by policy");

    return undefined;
  });
});
