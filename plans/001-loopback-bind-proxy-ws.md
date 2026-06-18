# Plan 001: Bind the proxy + WebSocket servers to loopback and reject cross-origin WS clients

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat 515682b..HEAD -- packages/cli/src/index.ts packages/cli/src/server.ts`
> If either in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: security
- **Planned at**: commit `515682b`, 2026-06-17

## Why this matters

`themelab` is documented as a local dev tool ("It is built for local development"). But the HTTP proxy and the WebSocket server are started **without a bind host**, so Node binds them to *all* network interfaces (`0.0.0.0` / `::`). The WebSocket server accepts messages that **write to the user's source files** (theme edits, class edits, text edits, reorders). The result:

1. Any other machine on the same LAN/Wi-Fi can reach the user's dev server through the proxy, and can connect to the WebSocket and drive edits into the user's project source.
2. Even on a single machine, the WS server performs **no Origin check**, so any web page the user visits in their browser can open a WebSocket to `ws://localhost:<wsPort>` and send write commands (writes are confined to the project root by `path-resolver.ts`, but writing arbitrary *content* into project source files is effectively code injection on the next dev build).

The MCP server in the same codebase already binds to `127.0.0.1` (`packages/cli/src/mcp/server.ts:152`), which is direct evidence this is an oversight on the proxy/WS, not an intentional design choice. This plan closes both holes with a localhost bind plus a loopback-Origin check on the WS handshake.

## Current state

- `packages/cli/src/index.ts` — CLI entry. Starts the WS server, MCP server, and proxy. The proxy is started here without a host:

  ```ts
  // packages/cli/src/index.ts:113
  proxyServer.listen(proxyPort, () => {
    logger.info(
      chalk.dim("  Proxy: ") +
        chalk.green(`http://localhost:${proxyPort}`)
    );
  ```

  The second argument is the *callback*, not a host — so the proxy binds to all interfaces.

- `packages/cli/src/server.ts` — the WebSocket server. Constructed without a host or Origin check:

  ```ts
  // packages/cli/src/server.ts:74-77
  export function createSketchServer(portOrOptions: number | SketchServerOptions): SketchServer {
    const port = typeof portOrOptions === "number" ? portOrOptions : portOrOptions.port;
    const wss = new WebSocketServer({ port });
    const projectRoot = path.resolve(process.cwd());
  ```

  All write message types (`reorder`, `moveSibling`, `updateTheme`, `updateProperty`, `updateProperties`, `updateText`, `commitBatch`, …) are processed for any connected client (`server.ts:117-129`, `server.ts:660-664`).

- The overlay (the only legitimate client) connects with a **literal `localhost`** URL — so a `127.0.0.1` bind plus a loopback-Origin allowlist will not break it:

  ```ts
  // packages/overlay/src/bridge.ts:28
  ws = new WebSocket(`ws://localhost:${port}`);
  ```

- The existing precedent to match (already correct) is the MCP server:

  ```ts
  // packages/cli/src/mcp/server.ts:152
  httpServer.listen(port, "127.0.0.1");
  ```

- Existing tests live in `packages/cli/src/__tests__/server.test.ts` (35 lines) and use the `ws` client. The `ws` library is `^8.18.0` (resolved `8.19.0`); its `WebSocketServer` supports the `host` option and the `verifyClient` option, and its client supports an `origin` option.

## Commands you will need

| Purpose            | Command                                              | Expected on success     |
|--------------------|-----------------------------------------------------|-------------------------|
| Install            | `pnpm install`                                       | exit 0                  |
| Build shared       | `pnpm build:shared`                                  | exit 0 (needed for types)|
| Typecheck          | `pnpm typecheck`                                     | exit 0, no errors       |
| CLI tests          | `pnpm --filter themelab-cli exec vitest run`         | all pass                |

## Scope

**In scope** (the only files you should modify):
- `packages/cli/src/index.ts` — add the proxy bind host.
- `packages/cli/src/server.ts` — add the WS bind host + a loopback-Origin `verifyClient`.
- `packages/cli/src/__tests__/server.test.ts` — add Origin-rejection / acceptance tests.

**Out of scope** (do NOT touch):
- `packages/cli/src/mcp/server.ts` — already binds loopback; its DNS-rebinding hardening is a separate plan (002).
- `packages/cli/src/inject.ts` — the proxy *forwards* HMR WebSockets for the app; do not add Origin checks there (it would break the proxied app's own sockets).
- The proxy's own request handling / overlay injection logic.

## Git workflow

- Branch: `advisor/001-loopback-bind` (or the repo's convention if one is evident).
- Commit message style is conventional commits (see `git log`, e.g. `fix(cli): …`). Suggested: `fix(cli): bind proxy + websocket to loopback and check WS origin`.
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Bind the proxy server to loopback

In `packages/cli/src/index.ts`, change the proxy `listen` call (line ~113) to pass `"127.0.0.1"` as the host argument before the callback:

```ts
proxyServer.listen(proxyPort, "127.0.0.1", () => {
  // ...unchanged callback body...
});
```

**Verify**: `pnpm typecheck` → exit 0. Then `grep -n 'listen(proxyPort, "127.0.0.1"' packages/cli/src/index.ts` → one match.

### Step 2: Bind the WS server to loopback and add a loopback-Origin check

In `packages/cli/src/server.ts`:

1. Add a small helper near the top of the file (after the imports), which treats a missing Origin as allowed (non-browser local clients such as tests/CLIs send no Origin and already have local access) and a present Origin as allowed only if its hostname is loopback:

```ts
/** Allow only same-machine browser origins. Missing Origin (non-browser
 * clients) is allowed; a present Origin must resolve to a loopback hostname,
 * which blocks any real website (and DNS-rebinding, since Origin carries the
 * page's hostname, not the resolved IP). */
function isAllowedWsOrigin(origin: string | undefined): boolean {
  if (!origin) return true;
  try {
    const { hostname } = new URL(origin);
    return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1" || hostname === "[::1]";
  } catch {
    return false;
  }
}
```

2. Change the `WebSocketServer` construction (line ~76) to bind loopback and verify the Origin:

```ts
const wss = new WebSocketServer({
  port,
  host: "127.0.0.1",
  verifyClient: ({ origin }) => isAllowedWsOrigin(origin),
});
```

**Verify**: `pnpm typecheck` → exit 0. `grep -n 'host: "127.0.0.1"' packages/cli/src/server.ts` → one match. `grep -n 'verifyClient' packages/cli/src/server.ts` → one match.

### Step 3: Add tests for Origin handling

In `packages/cli/src/__tests__/server.test.ts`, add a test block that:
- starts a server via `createSketchServer({ port })` on an ephemeral port (follow the existing test's setup/teardown),
- connects a `ws` client with `new WebSocket(url, { origin: "http://evil.example.com" })` and asserts the connection is **rejected** (the client emits `error` / `close` without ever reaching `open`),
- connects a `ws` client with `new WebSocket(url, { origin: "http://localhost:12345" })` and asserts it reaches `open`,
- (optional) connects with no `origin` option and asserts it reaches `open`.

Use a short timeout (e.g. 2s) per connection attempt so a hung connect fails the test rather than hanging the suite.

**Verify**: `pnpm --filter themelab-cli exec vitest run` → all tests pass, including the new ones.

## Test plan

- New tests in `packages/cli/src/__tests__/server.test.ts`, modeled on the existing connection test in that file:
  - rejects a non-loopback Origin,
  - accepts a loopback Origin,
  - accepts a missing Origin.
- Verification: `pnpm --filter themelab-cli exec vitest run` → all pass.

## Done criteria

ALL must hold:

- [ ] `pnpm typecheck` exits 0
- [ ] `pnpm --filter themelab-cli exec vitest run` exits 0; the new Origin tests exist and pass
- [ ] `grep -n 'listen(proxyPort, "127.0.0.1"' packages/cli/src/index.ts` returns one match
- [ ] `grep -n 'host: "127.0.0.1"' packages/cli/src/server.ts` returns one match
- [ ] `grep -n 'verifyClient' packages/cli/src/server.ts` returns one match
- [ ] No files outside the in-scope list are modified (`git status`)
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- The code at the locations in "Current state" doesn't match the excerpts (drift since this plan was written).
- After binding to `127.0.0.1`, you find evidence the overlay can no longer connect (e.g., the overlay resolves `localhost` to IPv6 `::1` only). If so, report it — the fix would be to bind to `"localhost"` or to listen on both `127.0.0.1` and `::1`, which is a design choice for the operator. Do NOT silently revert to an all-interfaces bind.
- `verifyClient` is not accepted by the installed `ws` types.
- A step's verification fails twice after a reasonable fix attempt.

## Maintenance notes

- If `themelab` ever needs to legitimately serve to another device on the LAN (e.g., testing on a physical phone), this loopback bind will block it; that should become an explicit opt-in flag (e.g. `--host 0.0.0.0`) with the security trade-off documented — never the default.
- The Origin allowlist rejects a browser that loaded the proxied page via a non-loopback hostname (e.g. a LAN IP). That is intended; note it if a user reports the overlay "not connecting" when they browsed via a LAN address.
- A reviewer should confirm the `inject.ts` HMR WebSocket forwarding was left untouched (it must keep working for the proxied app).
