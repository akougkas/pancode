import type { ModeDefinition } from "../../core/modes";

const PANCODE_IDENTITY = `You are PanCode, a multi-agent orchestrator and universal agent factory.
You coordinate specialized worker agents to complete coding tasks.
You do not implement code yourself.

Your capabilities:
- Understand requests and decide how to fulfill them
- Use shadow_explore to scout the codebase before dispatch decisions
- Dispatch workers via dispatch_agent or batch_dispatch for implementation
- Track work items with task_write and task_check
- Answer questions directly when no code changes are needed
- For greetings and conversation, respond naturally without calling tools

Rules:
- Coordinate over implement. Dispatch to specialists when possible.
- Do not dispatch tasks to yourself. You are the orchestrator.
- Do not refer to yourself as the underlying model name. You are PanCode.
- Do not expand scope beyond what was asked.
- Do not read SDK documentation or engine internals. Your tools are listed above.`;

function buildModeBlock(mode: ModeDefinition): string {
  switch (mode.id) {
    case "capture":
      return "You are in CAPTURE mode. Log ideas and requirements using task_write. Do not dispatch workers or modify code.";
    case "plan":
      return "You are in PLAN mode. Analyze the codebase and build a plan. Use shadow_explore for reconnaissance. Create tasks with task_write. Do not dispatch workers.";
    case "build":
      return "You are in BUILD mode. Full dispatch capability. Scout the codebase with shadow_explore, then dispatch workers for implementation. Monitor progress and verify results.";
    case "ask":
      return "You are in ASK mode. Answer questions and explore the codebase. Use shadow_explore for research. Do not dispatch workers or modify files.";
    case "review":
      return "You are in REVIEW mode. Dispatch readonly reviewers to analyze code. Do not dispatch mutable agents. Focus on quality and correctness.";
  }
}

const TOOL_OUTPUT_GUIDANCE = `Tool results and dispatch outputs are already displayed to the user in the
terminal. Do not repeat or reformat tool output in your response. Instead,
provide a brief interpretation, summary, or next-step recommendation.`;

// Section markers used to locate boundaries in the Pi SDK system prompt.
const MARKER_TOOLS = "Available tools:";
const MARKER_PI_DOCS = "Pi documentation (read only";
const MARKER_PROJECT_CONTEXT = "# Project Context";
const MARKER_SKILLS = "# Skills";
const MARKER_DATE = "\nCurrent date:";

/**
 * Find the start of the next major section after `fromIndex`.
 * Returns -1 if none found (meaning content runs to end of string).
 */
function findNextSectionAfter(prompt: string, fromIndex: number): number {
  const candidates = [MARKER_PROJECT_CONTEXT, MARKER_SKILLS, MARKER_DATE];
  let earliest = -1;
  for (const marker of candidates) {
    const idx = prompt.indexOf(marker, fromIndex);
    if (idx !== -1 && (earliest === -1 || idx < earliest)) {
      earliest = idx;
    }
  }
  return earliest;
}

/**
 * Synthesize the PanCode orchestrator system prompt.
 *
 * Takes the Pi SDK's auto-built system prompt, replaces the identity section,
 * removes Pi documentation references, injects mode behavior, and adds
 * PanCode-specific tool guidance.
 */
export function synthesizeOrchestratorPrompt(piBasePrompt: string, mode: ModeDefinition): string {
  const toolsIndex = piBasePrompt.indexOf(MARKER_TOOLS);

  // Fallback: if the prompt structure is unexpected, prepend identity + mode.
  if (toolsIndex === -1) {
    process.stderr.write("[pancode:ui] System prompt structure unexpected, using fallback composition.\n");
    return `${PANCODE_IDENTITY}\n\n${buildModeBlock(mode)}\n\n${piBasePrompt}\n\n${TOOL_OUTPUT_GUIDANCE}`;
  }

  // 1. Replace everything before "Available tools:" with PanCode identity + mode block.
  const afterIdentity = piBasePrompt.slice(toolsIndex);

  // 2. Remove Pi documentation section if present.
  let cleaned = afterIdentity;
  const piDocsIndex = cleaned.indexOf(MARKER_PI_DOCS);
  if (piDocsIndex !== -1) {
    const nextSection = findNextSectionAfter(cleaned, piDocsIndex + MARKER_PI_DOCS.length);
    if (nextSection !== -1) {
      cleaned = cleaned.slice(0, piDocsIndex) + cleaned.slice(nextSection);
    } else {
      // Pi docs run to end of string; just trim them.
      cleaned = cleaned.slice(0, piDocsIndex);
    }
  }

  // 3. Inject tool output guidance before the date footer.
  const dateIndex = cleaned.indexOf(MARKER_DATE);
  if (dateIndex !== -1) {
    cleaned = `${cleaned.slice(0, dateIndex)}\n\n${TOOL_OUTPUT_GUIDANCE}${cleaned.slice(dateIndex)}`;
  } else {
    // No date footer found; append guidance at end.
    cleaned = `${cleaned}\n\n${TOOL_OUTPUT_GUIDANCE}`;
  }

  // 4. Compose final prompt: identity + mode + cleaned SDK content.
  return `${PANCODE_IDENTITY}\n\n${buildModeBlock(mode)}\n\n${cleaned}`;
}
