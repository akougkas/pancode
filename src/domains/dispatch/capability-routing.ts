/**
 * Per-capability model routing.
 *
 * Routes different cognitive tasks within a dispatch to different models.
 * Tool-call formatting goes to a tiny fast model. Code generation goes
 * to a capable mid-range model. Planning goes to a frontier model.
 *
 * In the subprocess isolation model, per-capability routing is
 * implemented as dispatch chain decomposition: the orchestrator splits
 * a task into sub-tasks routed to different agent specs.
 */

export type Capability =
  | "tool-planning"
  | "code-generation"
  | "code-review"
  | "reasoning"
  | "classification"
  | "general";

export interface RoutingPolicy {
  /** Maps capability tags to model IDs. */
  routes: Map<Capability, string>;
  /** Fallback model when no capability-specific route matches. */
  fallback: string;
}

/**
 * Parse a routing policy from an agent spec's model_routing field.
 *
 * Expected YAML format:
 * model_routing:
 *   tool-planning: provider/small-model
 *   code-generation: provider/mid-model
 *   code-review: provider/distilled-model
 *   fallback: provider/default-model
 */
export function parseRoutingPolicy(modelRouting: Record<string, string> | undefined): RoutingPolicy | null {
  if (!modelRouting) return null;

  const routes = new Map<Capability, string>();
  let fallback = "";

  for (const [key, model] of Object.entries(modelRouting)) {
    if (key === "fallback") {
      fallback = model;
      continue;
    }
    if (isCapability(key)) {
      routes.set(key, model);
    }
  }

  if (routes.size === 0 && !fallback) return null;

  return { routes, fallback: fallback || (routes.values().next().value ?? "") };
}

function isCapability(value: string): value is Capability {
  return ["tool-planning", "code-generation", "code-review", "reasoning", "classification", "general"].includes(value);
}

/**
 * Resolve the model for a specific capability within a routing policy.
 */
export function resolveCapabilityModel(policy: RoutingPolicy, capability: Capability): string {
  return policy.routes.get(capability) ?? policy.fallback;
}

/**
 * Classify a task into a primary capability for routing.
 * Uses simple keyword heuristics. Future: use the intelligence domain's
 * intent detector for more accurate classification.
 */
export function classifyCapability(task: string): Capability {
  const lower = task.toLowerCase();

  if (lower.includes("plan") || lower.includes("architect") || lower.includes("design")) {
    return "reasoning";
  }
  if (lower.includes("review") || lower.includes("audit") || lower.includes("check")) {
    return "code-review";
  }
  if (lower.includes("implement") || lower.includes("write") || lower.includes("code") || lower.includes("build")) {
    return "code-generation";
  }
  if (lower.includes("classify") || lower.includes("categorize") || lower.includes("route")) {
    return "classification";
  }

  return "general";
}

/**
 * Decompose a task into capability-specific dispatch steps.
 * Each step targets a different model based on the routing policy.
 *
 * Returns a single step if no decomposition is beneficial.
 */
export function decomposeByCapability(
  task: string,
  policy: RoutingPolicy,
): Array<{ capability: Capability; model: string; taskFragment: string }> {
  const primaryCapability = classifyCapability(task);
  const model = resolveCapabilityModel(policy, primaryCapability);

  // For simple tasks, no decomposition
  return [{ capability: primaryCapability, model, taskFragment: task }];
}
