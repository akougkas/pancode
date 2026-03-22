import { AgentName } from "../../core/agent-names";

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
    agents: [AgentName.DEV, AgentName.REVIEWER],
    workflow: "sequential",
  },
  {
    name: "research-dev",
    description: "Reviewer explores codebase, developer implements",
    agents: [AgentName.REVIEWER, AgentName.DEV],
    workflow: "sequential",
  },
];
