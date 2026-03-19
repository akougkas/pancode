export interface TeamDefinition {
  name: string;
  description: string;
  agents: string[];
  workflow: "parallel" | "sequential" | "review";
}

export const BUILTIN_TEAMS: TeamDefinition[] = [
  {
    name: "code-review",
    description: "Developer writes code, reviewer checks it",
    agents: ["dev", "reviewer"],
    workflow: "sequential",
  },
  {
    name: "research-dev",
    description: "Scout explores codebase, developer implements",
    agents: ["scout", "dev"],
    workflow: "sequential",
  },
];
