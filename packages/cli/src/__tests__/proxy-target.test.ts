import * as http from "node:http";
import * as net from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { WebSocket, WebSocketServer } from "ws";

import { createProxyServer } from "../inject.js";

const servers: http.Server[] = [];
async function port(): Promise<number> { return new Promise((resolve, reject) => { const server = net.createServer(); server.once("error", reject); server.listen(0, "127.0.0.1", () => { const address = server.address(); server.close((error) => error ? reject(error) : resolve(typeof address === "object" && address ? address.port : 0)); }); }); }
async function listen(server: http.Server, value: number): Promise<void> { return new Promise((resolve) => server.listen(value, "127.0.0.1", resolve)); }
afterEach(async () => { await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve())))); });

describe("desktop proxy target", () => {
  it("forwards to the exact resolved target URL and injects one desktop bridge", async () => {
    const targetPort = await port();
    const upstream = http.createServer((request, response) => {
      expect(request.url).toBe("/resolved-path?themelabDesktop=1");
      response.writeHead(200, { "content-type": "text/html" });
      response.end("<html><body><main>upstream</main></body></html>");
    });
    servers.push(upstream);
    await listen(upstream, targetPort);
    const proxyPort = await port();
    const proxy = createProxyServer({ targetUrl: `http://127.0.0.1:${targetPort}`, proxyPort, wsPort: await port(), studioUrl: "https://themelab.dev", getActiveClient: () => null });
    servers.push(proxy);
    await listen(proxy, proxyPort);
    const body = await (await fetch(`http://127.0.0.1:${proxyPort}/resolved-path?themelabDesktop=1`, { headers: { accept: "text/html" } })).text();
    expect(body).toContain("upstream");
    expect(body.match(/__themelab\/overlay\.js/g)).toHaveLength(1);
    expect(body).not.toContain("#themelab-root{display:none!important}");
    expect(body).toContain("window.__THEMELAB_WS_PORT__");
  });

  it("proxies WebSocket upgrades to the exact resolved target for HMR", async () => {
    const targetPort = await port();
    const upstream = http.createServer();
    const upstreamWs = new WebSocketServer({ noServer: true });
    upstream.on("upgrade", (request, socket, head) => {
      expect(request.url).toBe("/hmr");
      upstreamWs.handleUpgrade(request, socket, head, (client) => upstreamWs.emit("connection", client, request));
    });
    upstreamWs.on("connection", (client) => client.on("message", (message) => client.send(`echo:${message.toString()}`)));
    servers.push(upstream);
    await listen(upstream, targetPort);
    const proxyPort = await port();
    const proxy = createProxyServer({ targetUrl: `http://127.0.0.1:${targetPort}`, proxyPort, wsPort: await port(), studioUrl: "https://themelab.dev", getActiveClient: () => null });
    servers.push(proxy);
    await listen(proxy, proxyPort);
    const client = new WebSocket(`ws://127.0.0.1:${proxyPort}/hmr`);
    try {
      await new Promise<void>((resolve, reject) => { client.once("open", resolve); client.once("error", reject); });
      const message = new Promise<string>((resolve, reject) => { client.once("message", (value) => resolve(value.toString())); client.once("error", reject); });
      client.send("ping");
      await expect(message).resolves.toBe("echo:ping");
    } finally {
      client.close();
      await new Promise<void>((resolve) => upstreamWs.close(() => resolve()));
    }
  });
});
