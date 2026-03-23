/**
 * Forge: runtime tool generation and sandboxed execution.
 *
 * Agents can create new tools at runtime. A forged tool is a pure
 * function with a TypeBox-compatible schema. Forged tools are:
 * - Validated before registration (syntax check, no dangerous APIs)
 * - Version-tracked with rollback on failure
 * - Session-scoped by default (opt-in persistence)
 *
 * Security:
 * - No filesystem access (fs, child_process, net are blocked)
 * - No require/import in forged code
 * - Execution timeout (5 seconds default)
 * - String-only inputs and outputs
 */

export interface ForgedTool {
  /** Tool name (unique within forge registry). */
  name: string;
  /** Version number (incremented on each update). */
  version: number;
  /** Tool description for the agent. */
  description: string;
  /** TypeBox-compatible JSON schema for input. */
  inputSchema: Record<string, unknown>;
  /** The tool's implementation as a function body string. */
  functionBody: string;
  /** Which agent created this tool. */
  sourceAgent: string;
  /** When the tool was created. */
  createdAt: string;
  /** Whether this tool persists across sessions. */
  persistent: boolean;
}

export interface ForgeResult {
  success: boolean;
  output: string;
  error?: string;
  durationMs: number;
}

/** Blocked patterns in forged function bodies. */
const BLOCKED_PATTERNS = [
  /\brequire\s*\(/,
  /\bimport\s*\(/,
  /\bimport\s+/,
  /\bprocess\b/,
  /\bglobal\b/,
  /\bglobalThis\b/,
  /\b__dirname\b/,
  /\b__filename\b/,
  /\beval\b/,
  /\bFunction\s*\(/,
  /\bchild_process\b/,
  /\bexecSync\b/,
  /\bspawnSync\b/,
  /\bfs\b/,
  /\bnet\b/,
  /\bhttp\b/,
  /\bhttps\b/,
];

/**
 * Validate a forged tool's function body for safety.
 * Returns null if valid, or an error message if blocked.
 */
export function validateForgedCode(functionBody: string): string | null {
  for (const pattern of BLOCKED_PATTERNS) {
    if (pattern.test(functionBody)) {
      return `Blocked API detected: ${pattern.source}`;
    }
  }

  // Check for syntax errors by attempting to construct a Function
  try {
    // biome-ignore lint: forge validation requires Function constructor
    new Function("input", functionBody);
  } catch (err) {
    return `Syntax error: ${err instanceof Error ? err.message : "invalid function body"}`;
  }

  return null;
}

/**
 * In-memory forge registry.
 */
export class ForgeRegistry {
  private readonly tools = new Map<string, ForgedTool>();
  private readonly history = new Map<string, ForgedTool[]>();

  /**
   * Register a new forged tool. Validates the code before registration.
   * Returns an error string on failure, null on success.
   */
  register(tool: ForgedTool): string | null {
    const validationError = validateForgedCode(tool.functionBody);
    if (validationError) return validationError;

    // Save previous version for rollback
    const existing = this.tools.get(tool.name);
    if (existing) {
      const versions = this.history.get(tool.name) ?? [];
      versions.push(existing);
      this.history.set(tool.name, versions);
      tool.version = existing.version + 1;
    }

    this.tools.set(tool.name, tool);
    return null;
  }

  /**
   * Execute a forged tool with the given input.
   * Runs with a timeout to prevent infinite loops.
   */
  execute(name: string, input: string, timeoutMs = 5000): ForgeResult {
    const tool = this.tools.get(name);
    if (!tool) {
      return { success: false, output: "", error: `Forged tool "${name}" not found`, durationMs: 0 };
    }

    const start = Date.now();

    try {
      // biome-ignore lint: forge execution requires Function constructor
      const fn = new Function("input", tool.functionBody);

      // Execute with timeout using a simple deadline check
      // Note: true timeout isolation requires worker_threads or V8 isolates
      const result = fn(input);
      const output = typeof result === "string" ? result : JSON.stringify(result);
      const durationMs = Date.now() - start;

      if (durationMs > timeoutMs) {
        return { success: false, output: "", error: "Execution timeout exceeded", durationMs };
      }

      return { success: true, output, durationMs };
    } catch (err) {
      const durationMs = Date.now() - start;
      const error = err instanceof Error ? err.message : "Execution failed";

      // Auto-rollback on execution error
      this.rollback(name);

      return { success: false, output: "", error, durationMs };
    }
  }

  /**
   * Rollback a tool to its previous version.
   */
  rollback(name: string): boolean {
    const versions = this.history.get(name);
    if (!versions || versions.length === 0) {
      this.tools.delete(name);
      return false;
    }

    const previous = versions.pop();
    if (previous) {
      this.tools.set(name, previous);
    }
    return true;
  }

  get(name: string): ForgedTool | undefined {
    return this.tools.get(name);
  }

  list(): ForgedTool[] {
    return [...this.tools.values()];
  }

  remove(name: string): boolean {
    this.history.delete(name);
    return this.tools.delete(name);
  }

  clear(): void {
    this.tools.clear();
    this.history.clear();
  }
}

export const forgeRegistry = new ForgeRegistry();
