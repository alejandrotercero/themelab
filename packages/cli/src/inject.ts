// packages/cli/src/inject.ts
import * as http from "node:http";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
// http-proxy-3: maintained TypeScript fork of http-proxy (same API). The
// original calls the deprecated util._extend on every request, spamming
// DEP0060 warnings on Node 22+.
import httpProxy from "http-proxy-3";
import { WebSocket } from "ws";
import { OVERLAY_JS } from "./generated/overlay-bundle.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

interface ProxyServerOptions {
  targetPort: number;
  targetHost: string;
  proxyPort: number;
  wsPort: number;
  /** Base URL of the ThemeLab studio, for the overlay's "Open in editor". */
  studioUrl: string;
  getActiveClient: () => WebSocket | null;
}

export function createProxyServer(
  options: ProxyServerOptions
): http.Server {
  const { targetPort, targetHost, proxyPort, wsPort, studioUrl, getActiveClient } = options;

  const proxy = httpProxy.createProxyServer({
    target: `http://${targetHost}:${targetPort}`,
    ws: true,
    selfHandleResponse: true,
  });

  // Locate the overlay bundle. Prefer the on-disk copy (workspace build → hot
  // reload in dev; the published package ships it next to this file), and fall
  // back to the constant embedded at build time when no file exists — the case
  // for a standalone compiled binary, where there is no overlay.js on disk.
  const workspaceOverlayPath = path.resolve(__dirname, "../../overlay/dist/overlay.js");
  const bundledOverlayPath = path.join(__dirname, "overlay.js");
  const overlayPath = fs.existsSync(workspaceOverlayPath)
    ? workspaceOverlayPath
    : fs.existsSync(bundledOverlayPath)
      ? bundledOverlayPath
      : null;
  let upstreamDown = false;

  const server = http.createServer((req, res) => {
    // Normalize URL to prevent path traversal
    const normalizedUrl = new URL(req.url || "/", "http://localhost").pathname;

    // Serve overlay bundle — never cache it, so a plain reload always gets the
    // freshly built code (otherwise the browser caches it and stale overlay UI
    // persists across rebuilds even after a refresh).
    if (normalizedUrl === "/__themelab/overlay.js") {
      res.writeHead(200, {
        "Content-Type": "application/javascript",
        "Cache-Control": "no-store, no-cache, must-revalidate",
        "Pragma": "no-cache",
        "Expires": "0",
      });
      // Disk copy when present (fresh on every reload in dev), else the embedded bundle.
      if (overlayPath) {
        fs.createReadStream(overlayPath).pipe(res);
      } else {
        res.end(OVERLAY_JS);
      }
      return;
    }

    // For HTML requests: disable caching so we always get the full response
    // to inject into (prevents 304 Not Modified with empty body)
    if (req.headers.accept?.includes("text/html")) {
      req.headers["accept-encoding"] = "identity";
      delete req.headers["if-none-match"];
      delete req.headers["if-modified-since"];
    }

    proxy.web(req, res);
  });

  // Handle proxy response — inject script into HTML
  proxy.on("proxyRes", (proxyRes, _req, res) => {
    const contentType = proxyRes.headers["content-type"] || "";
    const isHtml = contentType.includes("text/html");
    const outRes = res as unknown as http.ServerResponse;

    if (!isHtml) {
      // Pass through non-HTML responses
      outRes.writeHead(proxyRes.statusCode || 200, proxyRes.headers);
      proxyRes.pipe(outRes);
      return;
    }

    // Buffer HTML response for script injection
    const chunks: Uint8Array[] = [];
    proxyRes.on("data", (chunk: Uint8Array) => chunks.push(chunk));
    proxyRes.on("end", () => {
      let body = Buffer.concat(chunks).toString("utf-8");

      const injectedScript = `
<script src="/__themelab/overlay.js"></script>
<script>window.__THEMELAB_WS_PORT__ = ${wsPort}; window.__THEMELAB_STUDIO_URL__ = ${JSON.stringify(studioUrl)};</script>`;

      if (body.includes("</body>")) {
        body = body.replace("</body>", `${injectedScript}\n</body>`);
      } else {
        body += injectedScript;
      }


      // We've buffered the whole body and are re-sending it with an explicit
      // length, so strip the streaming/encoding headers from upstream. Leaving
      // `transfer-encoding: chunked` alongside our `content-length` is a malformed
      // (conflicting) response: Node tolerated it, but Bun emits an empty body —
      // a blank page. Drop it (and content-encoding, since the body is now plain).
      const headers = { ...proxyRes.headers };
      delete headers["content-encoding"];
      delete headers["content-length"];
      delete headers["transfer-encoding"];
      headers["content-length"] = String(Buffer.byteLength(body));

      outRes.writeHead(proxyRes.statusCode || 200, headers);
      outRes.end(body);
    });
  });

  // Proxy WebSocket upgrades (for HMR)
  server.on("upgrade", (req, socket, head) => {
    proxy.ws(req, socket, head);
  });

  proxy.on("error", (_err, _req, res) => {
    if (!upstreamDown) {
      upstreamDown = true;
      const client = getActiveClient();
      if (client && client.readyState === WebSocket.OPEN) {
        client.send(JSON.stringify({ type: "devServerDisconnected" }));
      }
    }
    if (res && "writeHead" in res) {
      const errRes = res as unknown as http.ServerResponse;
      // With selfHandleResponse the proxyRes handler may have already written
      // headers/streamed the body before the upstream error fired. Writing them
      // again throws ERR_HTTP_HEADERS_SENT and crashes the proxy, so only send a
      // 502 when nothing has been written yet; otherwise just terminate cleanly.
      if (errRes.headersSent) {
        if (!errRes.writableEnded) errRes.end();
      } else {
        errRes.writeHead(502, { "Content-Type": "text/plain" });
        errRes.end("Dev server unavailable");
      }
    }
  });

  // Periodically check if upstream recovered
  const recoveryInterval = setInterval(async () => {
    if (!upstreamDown) return;
    try {
      const resp = await fetch(`http://${targetHost}:${targetPort}`, {
        signal: AbortSignal.timeout(1000),
      });
      if (resp.ok || resp.status < 500) {
        upstreamDown = false;
        const client = getActiveClient();
        if (client && client.readyState === WebSocket.OPEN) {
          client.send(JSON.stringify({ type: "devServerReconnected" }));
        }
      }
    } catch {
      // Still down
    }
  }, 3000);

  // Clean up interval when server closes
  server.on("close", () => clearInterval(recoveryInterval));

  return server;
}
