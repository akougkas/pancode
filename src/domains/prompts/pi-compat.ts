// Pi SDK system prompt compatibility layer.
// Detects section boundaries in the Pi SDK's auto-built prompt and performs
// safe surgical replacement, removal, and injection operations.
//
// If the Pi SDK changes its prompt structure, only this file needs updating.
// The integrity check script (check-prompts.mjs) validates marker compatibility.

/** Detected section boundaries in a Pi SDK system prompt. */
export interface PiPromptSections {
  /** Position where "Available tools:" begins. -1 if not found. */
  toolsStart: number;
  /** Position of "Pi documentation" section. -1 if absent. */
  piDocsStart: number;
  /** End of Pi docs section (start of next section after it). -1 if absent. */
  piDocsEnd: number;
  /** Position of "# Project Context" header. -1 if absent. */
  projectContextStart: number;
  /** Position of skills section. -1 if absent. */
  skillsStart: number;
  /** Position of "\nCurrent date:" footer. -1 if absent. */
  dateFooterStart: number;
  /** True if the critical "Available tools:" marker was found. */
  valid: boolean;
}

// Section markers. Case-insensitive to survive minor Pi SDK formatting changes.
const RE_TOOLS = /^Available tools:/im;
const RE_PI_DOCS = /^Pi documentation \(read only/im;
const RE_PROJECT_CONTEXT = /^# Project Context/im;
const RE_SKILLS = /^# Skills/im;
const RE_DATE = /\nCurrent date:/im;

/**
 * Find a marker's position using a case-insensitive regex.
 * Searches from `fromIndex` onward. Returns -1 if not found.
 */
function findMarker(prompt: string, pattern: RegExp, fromIndex = 0): number {
  const slice = prompt.slice(fromIndex);
  const match = pattern.exec(slice);
  return match ? fromIndex + match.index : -1;
}

/**
 * Detect all section boundaries in a Pi SDK system prompt.
 */
export function detectSections(prompt: string): PiPromptSections {
  const toolsStart = findMarker(prompt, RE_TOOLS);
  const piDocsStart = findMarker(prompt, RE_PI_DOCS);
  const projectContextStart = findMarker(prompt, RE_PROJECT_CONTEXT);
  const skillsStart = findMarker(prompt, RE_SKILLS);
  const dateFooterStart = findMarker(prompt, RE_DATE);

  // Determine the end of Pi docs section: the next major section after it.
  let piDocsEnd = -1;
  if (piDocsStart !== -1) {
    const searchFrom = piDocsStart + 30; // Skip past the marker text itself
    const candidates = [projectContextStart, skillsStart, dateFooterStart].filter((idx) => idx > searchFrom);
    piDocsEnd = candidates.length > 0 ? Math.min(...candidates) : -1;
  }

  return {
    toolsStart,
    piDocsStart,
    piDocsEnd,
    projectContextStart,
    skillsStart,
    dateFooterStart,
    valid: toolsStart !== -1,
  };
}

/**
 * Perform full surgical replacement of the Pi SDK prompt.
 *
 * Operations:
 * 1. Replace everything before "Available tools:" with pancodeContent
 * 2. Remove the "Pi documentation" section (saves ~200-300 tokens)
 * 3. Inject pancodeFooter before the date footer
 *
 * Falls back to prepending if the prompt structure is unrecognizable.
 *
 * @param piBasePrompt - The Pi SDK's auto-built system prompt
 * @param pancodeContent - PanCode compiled content (identity + mode + dispatch + ...)
 * @param pancodeFooter - Content to inject before the date footer (tool output guidance, operational)
 * @returns The surgically modified prompt
 */
export function surgePiPrompt(piBasePrompt: string, pancodeContent: string, pancodeFooter: string): string {
  const sections = detectSections(piBasePrompt);

  // Fallback: if structure is unrecognizable, prepend PanCode content.
  if (!sections.valid) {
    process.stderr.write("[pancode:prompts] Pi SDK prompt structure unexpected, using fallback composition.\n");
    return `${pancodeContent}\n\n${piBasePrompt}${pancodeFooter ? `\n\n${pancodeFooter}` : ""}`;
  }

  // 1. Replace identity: keep everything from "Available tools:" onward.
  let result = piBasePrompt.slice(sections.toolsStart);

  // 2. Remove Pi documentation section if present.
  if (sections.piDocsStart !== -1) {
    // Recalculate positions relative to the sliced result.
    const relPiDocsStart = findMarker(result, RE_PI_DOCS);
    if (relPiDocsStart !== -1) {
      const relSearchFrom = relPiDocsStart + 30;
      const relProjectContext = findMarker(result, RE_PROJECT_CONTEXT, relSearchFrom);
      const relSkills = findMarker(result, RE_SKILLS, relSearchFrom);
      const relDate = findMarker(result, RE_DATE, relSearchFrom);
      const candidates = [relProjectContext, relSkills, relDate].filter((idx) => idx !== -1);
      if (candidates.length > 0) {
        const nextSection = Math.min(...candidates);
        result = result.slice(0, relPiDocsStart) + result.slice(nextSection);
      } else {
        result = result.slice(0, relPiDocsStart);
      }
    }
  }

  // 3. Inject footer content before the date line.
  if (pancodeFooter) {
    const relDate = findMarker(result, RE_DATE);
    if (relDate !== -1) {
      result = `${result.slice(0, relDate)}\n\n${pancodeFooter}${result.slice(relDate)}`;
    } else {
      result = `${result}\n\n${pancodeFooter}`;
    }
  }

  // 4. Compose: PanCode content + modified Pi SDK content.
  return `${pancodeContent}\n\n${result}`;
}
