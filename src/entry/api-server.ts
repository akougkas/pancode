/**
 * REST API daemon for PanCode (pancode serve).
 *
 * HTTP daemon exposing PanCode's orchestration as a programmable API.
 * Uses Node.js built-in http module with no external dependencies.
 *
 * Endpoints:
 *   POST   /dispatch          Dispatch a task to an agent
 *   GET    /runs              List recent dispatch runs
 *   POST   /runs/:id/cancel   Cancel a running dispatch
 *   GET    /status            Session status
 *   GET    /workers           Worker pool state
 *   GET    /events            SSE stream for real-time monitoring
 *
 * Security:
 *   Localhost-only by default (127.0.0.1).
 *   API key auth for non-localhost via PANCODE_API_KEY.
 */

import { type IncomingMessage, type ServerResponse, createServer } from "node:http";
import { jsonError, jsonSuccess } from "../core/exit-codes";

export interface ApiServerConfig {
  /** Port to listen on. Default: 3456. */
  port: number;
  /** Host to bind to. Default: 127.0.0.1. */
  host: string;
  /** API key for authentication. Null means localhost-only, no auth. */
  apiKey: string | null;
}

export interface ApiRoute {
  method: "GET" | "POST";
  path: string;
  handler: (req: IncomingMessage, res: ServerResponse, params: RouteParams) => Promise<void>;
}

export interface RouteParams {
  pathParams: Record<string, string>;
  body: unknown;
}

/** Default API server configuration. */
export function getDefaultApiConfig(): ApiServerConfig {
  const port = Number.parseInt(process.env.PANCODE_API_PORT ?? "3456", 10) || 3456;
  const host = process.env.PANCODE_API_HOST ?? "127.0.0.1";
  const apiKey = process.env.PANCODE_API_KEY?.trim() || null;

  return { port, host, apiKey };
}

/**
 * Parse the request body as JSON.
 */
async function parseBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      if (!raw.trim()) {
        resolve(null);
        return;
      }
      try {
        resolve(JSON.parse(raw));
      } catch (err) {
        reject(err);
      }
    });
    req.on("error", reject);
  });
}

/**
 * Check API key authentication.
 * Returns true if auth passes, false if unauthorized.
 */
function checkAuth(req: IncomingMessage, config: ApiServerConfig): boolean {
  if (!config.apiKey) return true; // No auth required for localhost-only

  const authHeader = req.headers.authorization;
  if (!authHeader) return false;

  // Support both "Bearer <key>" and raw key
  const key = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : authHeader;
  return key === config.apiKey;
}

/**
 * Send a JSON response.
 */
function sendJson(res: ServerResponse, statusCode: number, data: unknown): void {
  const body = JSON.stringify(data);
  res.writeHead(statusCode, {
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(body),
  });
  res.end(body);
}

/**
 * Match a request URL against registered routes.
 */
function matchRoute(
  method: string,
  url: string,
  routes: ApiRoute[],
): { route: ApiRoute; pathParams: Record<string, string> } | null {
  for (const route of routes) {
    if (route.method !== method) continue;

    // Simple path matching with :param support
    const routeParts = route.path.split("/");
    const urlParts = url.split("?")[0].split("/");

    if (routeParts.length !== urlParts.length) continue;

    const params: Record<string, string> = {};
    let match = true;

    for (let i = 0; i < routeParts.length; i++) {
      if (routeParts[i].startsWith(":")) {
        params[routeParts[i].slice(1)] = urlParts[i];
      } else if (routeParts[i] !== urlParts[i]) {
        match = false;
        break;
      }
    }

    if (match) return { route, pathParams: params };
  }

  return null;
}

/**
 * Create and start the API server.
 * Returns a cleanup function to stop the server.
 */
export function createApiServer(
  config: ApiServerConfig,
  routes: ApiRoute[],
): { stop: () => Promise<void>; port: number } {
  const server = createServer(async (req, res) => {
    // CORS headers for browser-based clients
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    // Auth check
    if (!checkAuth(req, config)) {
      sendJson(res, 401, jsonError("auth", "Unauthorized: invalid or missing API key"));
      return;
    }

    const matched = matchRoute(req.method ?? "GET", req.url ?? "/", routes);
    if (!matched) {
      sendJson(res, 404, jsonError("route", `Not found: ${req.method} ${req.url}`));
      return;
    }

    try {
      const body = req.method === "POST" ? await parseBody(req) : null;
      await matched.route.handler(req, res, {
        pathParams: matched.pathParams,
        body,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Internal server error";
      sendJson(res, 500, jsonError("internal", message));
    }
  });

  server.listen(config.port, config.host);

  return {
    port: config.port,
    stop: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
      }),
  };
}

/**
 * Create default API routes.
 * These are stubs that will be wired to actual domain logic
 * when the server is integrated with the orchestrator.
 */
export function createDefaultRoutes(): ApiRoute[] {
  return [
    {
      method: "GET",
      path: "/status",
      handler: async (_req, res) => {
        sendJson(res, 200, jsonSuccess("/status", { status: "running" }));
      },
    },
    {
      method: "GET",
      path: "/runs",
      handler: async (_req, res) => {
        sendJson(res, 200, jsonSuccess("/runs", { runs: [] }));
      },
    },
    {
      method: "GET",
      path: "/workers",
      handler: async (_req, res) => {
        sendJson(res, 200, jsonSuccess("/workers", { workers: [] }));
      },
    },
    {
      method: "POST",
      path: "/dispatch",
      handler: async (_req, res, params) => {
        const body = params.body as { agent?: string; task?: string } | null;
        if (!body?.agent || !body?.task) {
          sendJson(res, 400, jsonError("/dispatch", "Missing required fields: agent, task"));
          return;
        }
        // Dispatch logic will be wired when integrated with orchestrator
        sendJson(res, 202, jsonSuccess("/dispatch", { queued: true, agent: body.agent }));
      },
    },
    {
      method: "POST",
      path: "/runs/:id/cancel",
      handler: async (_req, res, params) => {
        sendJson(res, 200, jsonSuccess("/runs/cancel", { cancelled: params.pathParams.id }));
      },
    },
  ];
}
