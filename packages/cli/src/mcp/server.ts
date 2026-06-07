// packages/cli/src/mcp/server.ts
//
// An MCP server that surfaces ThemeLab's live overlay context to coding agents
// (Claude Code, Cursor, etc.). It runs in-process inside the main `themelab`
// command over Streamable HTTP, reading state the WS server already holds — it
// does NOT open a second overlay connection (the WS server allows one client).
//
// Stateless transport: a fresh McpServer + transport per request, so there's no
// per-session state to track and no request-id collisions across concurrent
// agents. Only POST is served (no server-initiated SSE streams in this mode).
import { createServer, type IncomingMessage, type ServerResponse, type Server as HttpServer } from "node:http";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import type { ComponentInfo, ThemeStyles, ThemeSource, TailwindTokenMap } from "@themelab/shared";
import { logger } from "../logger.js";

/** Live state the MCP tools read — backed by the running WS server. */
export interface McpServerDeps {
  getSelection: () => ComponentInfo | null;
  getTheme: () => { theme: ThemeStyles; source: ThemeSource | null } | null;
  getTailwindTokens: () => TailwindTokenMap | null;
  discoverComponentFile: (componentName: string) => Promise<string | null>;
  isOverlayConnected: () => boolean;
}

const SERVER_INFO = { name: "themelab", version: "0.1.0" };

/** Wrap a JSON-serializable payload as MCP tool text content. */
function jsonResult(data: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
}

/** Wrap a plain status string as MCP tool text content. */
function textResult(text: string) {
  return { content: [{ type: "text" as const, text }] };
}

const NOT_CONNECTED =
  "The ThemeLab overlay is not connected. Open the proxied app in a browser (the URL printed by `themelab`) so the overlay can attach.";

function buildMcpServer(deps: McpServerDeps): McpServer {
  const server = new McpServer(SERVER_INFO);

  server.registerTool(
    "get_selection",
    {
      title: "Get selected component",
      description:
        "Returns the component the user has currently selected in the ThemeLab browser overlay: its name, source file path, line/column, the ancestor component stack, and a structural JSX path. Use this to learn exactly which file and line the user is pointing at instead of guessing.",
    },
    async () => {
      if (!deps.isOverlayConnected()) return textResult(NOT_CONNECTED);
      const sel = deps.getSelection();
      if (!sel) return textResult("Nothing is selected in the overlay right now. Ask the user to click a component.");
      return jsonResult({
        componentName: sel.componentName,
        tagName: sel.tagName,
        filePath: sel.filePath,
        lineNumber: sel.lineNumber,
        columnNumber: sel.columnNumber,
        stack: sel.stack,
        jsxPath: sel.jsxPath,
      });
    },
  );

  server.registerTool(
    "get_theme",
    {
      title: "Get project theme tokens",
      description:
        "Returns the project's resolved design-token theme — the light and dark CSS-variable maps — plus the source file they came from. Use these tokens when writing styles so new code matches the project's existing theme rather than hardcoding colors.",
    },
    async () => {
      if (!deps.isOverlayConnected()) return textResult(NOT_CONNECTED);
      const t = deps.getTheme();
      if (!t) return textResult("No theme has been resolved for this project.");
      return jsonResult(t);
    },
  );

  server.registerTool(
    "get_tailwind_tokens",
    {
      title: "Get Tailwind tokens",
      description:
        "Returns the project's resolved Tailwind token map (colors, spacing, radii, etc.) as understood by ThemeLab. Use it to map design values to the project's Tailwind scale.",
    },
    async () => {
      if (!deps.isOverlayConnected()) return textResult(NOT_CONNECTED);
      const tokens = deps.getTailwindTokens();
      if (!tokens) return textResult("No Tailwind tokens have been resolved for this project.");
      return jsonResult(tokens);
    },
  );

  server.registerTool(
    "find_component",
    {
      title: "Find component source file",
      description:
        "Resolves a React component name to its source file path within the project (grep-based discovery). Use when you know a component's name but not where it lives.",
      inputSchema: { componentName: z.string().describe('The component name to locate, e.g. "Button".') },
    },
    async ({ componentName }) => {
      const filePath = await deps.discoverComponentFile(componentName);
      if (!filePath) return textResult(`No source file found for component "${componentName}".`);
      return jsonResult({ componentName, filePath });
    },
  );

  return server;
}

/**
 * Start the MCP HTTP server. Binds loopback only. Returns the Node http server
 * so the caller can close it on shutdown.
 */
export function createMcpHttpServer(deps: McpServerDeps, port: number): HttpServer {
  const httpServer = createServer((req: IncomingMessage, res: ServerResponse) => {
    void handle(req, res);
  });

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (req.method !== "POST") {
      res
        .writeHead(405, { "Content-Type": "application/json", Allow: "POST" })
        .end(JSON.stringify({ jsonrpc: "2.0", error: { code: -32000, message: "Method not allowed — use POST." }, id: null }));
      return;
    }
    // Fresh server + transport per request (stateless).
    const server = buildMcpServer(deps);
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    res.on("close", () => {
      void transport.close();
      void server.close();
    });
    try {
      await server.connect(transport);
      await transport.handleRequest(req, res);
    } catch (err) {
      logger.warn("[ThemeLab] MCP request failed:", err);
      if (!res.headersSent) {
        res
          .writeHead(500, { "Content-Type": "application/json" })
          .end(JSON.stringify({ jsonrpc: "2.0", error: { code: -32603, message: "Internal server error" }, id: null }));
      }
    }
  }

  httpServer.listen(port, "127.0.0.1");
  return httpServer;
}
