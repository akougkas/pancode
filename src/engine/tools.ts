export type {
  AgentToolResult,
  AgentToolUpdateCallback,
  ToolDefinition,
} from "@pancode/pi-coding-agent";

export function defineTool<T>(definition: T): T {
  return definition;
}
