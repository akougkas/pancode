export interface DispatchContext {
  task: string;
  agent: string;
  cwd: string;
}

export type DispatchAction =
  | { action: "dispatch"; agent: string; task: string }
  | { action: "stop"; reason: string }
  | { action: "skip"; reason?: string };

export interface DispatchRule {
  name: string;
  match: (ctx: DispatchContext) => DispatchAction | null;
}

export const DEFAULT_DISPATCH_RULES: DispatchRule[] = [
  {
    name: "empty-task-guard",
    match: (ctx) => {
      if (!ctx.task.trim()) return { action: "stop", reason: "Empty task" };
      return null;
    },
  },
  {
    name: "agent-fallback",
    match: (ctx) => {
      return { action: "dispatch", agent: ctx.agent || "dev", task: ctx.task };
    },
  },
];

export function evaluateRules(rules: DispatchRule[], ctx: DispatchContext): DispatchAction {
  for (const rule of rules) {
    const result = rule.match(ctx);
    if (result) return result;
  }
  return { action: "dispatch", agent: ctx.agent || "dev", task: ctx.task };
}
