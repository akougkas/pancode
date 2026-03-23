/**
 * MCP (Model Context Protocol) manifest generation.
 *
 * Exports PanCode's dispatch tools and agent capabilities as an MCP
 * server manifest. This enables external MCP clients (Claude Desktop,
 * Cursor, Windsurf) to discover and use PanCode's orchestration.
 *
 * PanCode becomes both an MCP client (consuming tools from external
 * servers) and an MCP server (exposing its dispatch capability).
 */

export interface McpToolSchema {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface McpResource {
  uri: string;
  name: string;
  description: string;
  mimeType: string;
}

export interface McpManifest {
  name: string;
  version: string;
  description: string;
  tools: McpToolSchema[];
  resources: McpResource[];
}

/**
 * Generate the MCP manifest for PanCode's dispatch tools.
 */
export function generateMcpManifest(version: string): McpManifest {
  return {
    name: "pancode",
    version,
    description: "PanCode multi-agent orchestrator dispatch tools",
    tools: [
      {
        name: "dispatch_agent",
        description: "Dispatch a task to a PanCode agent worker",
        inputSchema: {
          type: "object",
          properties: {
            agent: { type: "string", description: "Agent name (scout, builder, reviewer, etc.)" },
            task: { type: "string", description: "Task description" },
            model: { type: "string", description: "Model override (provider/model-id)" },
          },
          required: ["agent", "task"],
        },
      },
      {
        name: "batch_dispatch",
        description: "Dispatch multiple tasks in parallel to PanCode agents",
        inputSchema: {
          type: "object",
          properties: {
            dispatches: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  agent: { type: "string" },
                  task: { type: "string" },
                },
                required: ["agent", "task"],
              },
              description: "Array of (agent, task) pairs",
            },
          },
          required: ["dispatches"],
        },
      },
      {
        name: "dispatch_chain",
        description: "Execute a sequential chain of agent tasks",
        inputSchema: {
          type: "object",
          properties: {
            steps: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  agent: { type: "string" },
                  task: { type: "string" },
                },
                required: ["agent", "task"],
              },
              description: "Sequential steps with $INPUT placeholder for previous output",
            },
          },
          required: ["steps"],
        },
      },
    ],
    resources: [
      {
        uri: "pancode://status",
        name: "Session Status",
        description: "Current PanCode session status including active workers and budget",
        mimeType: "application/json",
      },
      {
        uri: "pancode://runs",
        name: "Dispatch Runs",
        description: "List of recent dispatch runs with results",
        mimeType: "application/json",
      },
      {
        uri: "pancode://workers",
        name: "Worker Pool",
        description: "Current worker pool state and scoring",
        mimeType: "application/json",
      },
      {
        uri: "pancode://agents",
        name: "Agent Registry",
        description: "Registered agent specifications",
        mimeType: "application/json",
      },
    ],
  };
}

/**
 * Serialize the MCP manifest as JSON.
 */
export function serializeMcpManifest(manifest: McpManifest): string {
  return JSON.stringify(manifest, null, 2);
}
