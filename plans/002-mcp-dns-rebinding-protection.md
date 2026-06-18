# Plan 002: Enable DNS-rebinding / Host protection on the MCP server

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving on. If
> anything in "STOP conditions" occurs, stop and report. When done, update the
> status row for this plan in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat 515682b..HEAD -- packages/cli/src/mcp/server.ts`
> If the file changed since this plan was written, compare the "Current state"
> excerpt against the live code before proceeding; on a mismatch, STOP.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none (independent of plan 001)
- **Category**: security
- **Planned at**: commit `515682b`, 2026-06-17

## Why this matters

While `themelab` runs, it exposes an MCP server over Streamable HTTP on `127.0.0.1:<mcpPort>` (default 3458). It correctly binds to loopback, but the `StreamableHTTPServerTransport` is constructed **without DNS-rebinding protection and without a Host/Origin allowlist**. That means a malicious web page open in the user's browser can use DNS rebinding (point an attacker hostname at `127.0.0.1`) and POST to the loopback MCP endpoint. The MCP tools then disclose project context: the currently selected component's **source file path and line**, the project's resolved **theme tokens**, the **Tailwind token map**, and **component→file** resolutions. This is local information disclosure (no write capability), but it leaks the structure and file layout of whatever the user is working on. The MCP SDK provides a built-in defense; this plan turns it on.

## Current state

- `packages/cli/src/mcp/server.ts` — the MCP HTTP server. The transport is created per request with no rebinding protection, and the server binds loopback:

  ```ts
  // packages/cli/src/mcp/server.ts:132-134
  // Fresh server + transport per request (stateless).
  const server = buildMcpServer(deps);
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  ```

  ```ts
  // packages/cli/src/mcp/server.ts:120
  export function createMcpHttpServer(deps: McpServerDeps, port: number): HttpServer {
  ```

  ```ts
  // packages/cli/src/mcp/server.ts:152
  httpServer.listen(port, "127.0.0.1");
  ```

  The `port` is already a parameter of `createMcpHttpServer`, so it is available where the transport is built (it is defined inside that function, in the `handle` closure).

- The SDK is `@modelcontextprotocol/sdk@^1.29.0` (`packages/cli/package.json:48`). `StreamableHTTPServerTransport` in this version accepts `enableDnsRebindingProtection?: boolean`, `allowedHosts?: string[]`, and `allowedOrigins?: string[]`. **Confirm these option names against the installed types before using them** (see Step 1).

- Legitimate clients (Claude Code, Cursor) connect to the URL printed at startup, `http://localhost:<mcpPort>/mcp` (see `README.md`), so `localhost:<port>` and `127.0.0.1:<port>` must both be allowed Hosts.

## Commands you will need

| Purpose            | Command                                              | Expected on success     |
|--------------------|-----------------------------------------------------|-------------------------|
| Install            | `pnpm install`                                       | exit 0                  |
| Inspect SDK types  | `grep -rn "enableDnsRebindingProtection\|allowedHosts" node_modules/@modelcontextprotocol/sdk/dist/esm/server/streamableHttp.d.ts` | shows the option fields |
| Typecheck          | `pnpm typecheck`                                     | exit 0, no errors       |
| CLI tests          | `pnpm --filter themelab-cli exec vitest run`         | all pass                |

## Scope

**In scope** (the only file you should modify):
- `packages/cli/src/mcp/server.ts`

**Out of scope** (do NOT touch):
- `packages/cli/src/server.ts` and `index.ts` — the WS/proxy hardening is plan 001.
- The MCP tool definitions (`get_selection`, `get_theme`, etc.) — behavior is unchanged; only transport config changes.

## Git workflow

- Branch: `advisor/002-mcp-rebinding`.
- Conventional commit, e.g. `fix(mcp): enable DNS-rebinding protection on the MCP transport`.
- Do NOT push or open a PR unless instructed.

## Steps

### Step 1: Confirm the SDK option names

Run:

```
grep -rn "enableDnsRebindingProtection\|allowedHosts\|allowedOrigins" node_modules/@modelcontextprotocol/sdk/dist/esm/server/streamableHttp.d.ts
```

You should see these as optional fields on the transport options type. If the field names differ in the installed version, use whatever the `.d.ts` actually declares. If no such options exist at all, STOP and report (the SDK version does not support this and the plan needs revisiting).

### Step 2: Pass the protection options when constructing the transport

In `packages/cli/src/mcp/server.ts`, update the transport construction (line ~134) to enable rebinding protection and allow only the loopback hosts for the known port:

```ts
const transport = new StreamableHTTPServerTransport({
  sessionIdGenerator: undefined,
  enableJsonResponse: true,
  enableDnsRebindingProtection: true,
  allowedHosts: [`127.0.0.1:${port}`, `localhost:${port}`],
});
```

Notes:
- Use the `port` parameter already in scope (`createMcpHttpServer(deps, port)`).
- Do **not** set `allowedOrigins`: non-browser MCP clients (Claude Code/Cursor) typically send no `Origin` header, and constraining origins could break them. Host-based rebinding protection is the needed defense here; the Host header must match `localhost`/`127.0.0.1` and an attacker page cannot forge a loopback Host while pointing at the user's machine.

**Verify**: `pnpm typecheck` → exit 0. `grep -n "enableDnsRebindingProtection: true" packages/cli/src/mcp/server.ts` → one match.

### Step 3: Confirm existing behavior still type-checks and tests pass

**Verify**: `pnpm --filter themelab-cli exec vitest run` → all pass (no MCP tests may exist; this just confirms nothing regressed).

## Test plan

- No new automated test is required (the SDK enforces the check internally and an end-to-end Host-spoofing test is disproportionate for this change). If you want a guard, add a unit test that calls `createMcpHttpServer(stubDeps, port)`, then makes a `fetch` POST to `http://127.0.0.1:<port>/mcp` with a `Host: evil.example.com` header and asserts a non-2xx response — but only if it can be written quickly with the existing test harness. Otherwise rely on typecheck + manual confirmation.
- Manual confirmation (optional, document the result): start `themelab` against a sample app, run `claude mcp add --transport http themelab http://localhost:3458/mcp` and confirm a tool call still succeeds (legitimate localhost Host is allowed).

## Done criteria

ALL must hold:

- [ ] `pnpm typecheck` exits 0
- [ ] `pnpm --filter themelab-cli exec vitest run` exits 0
- [ ] `grep -n "enableDnsRebindingProtection: true" packages/cli/src/mcp/server.ts` returns one match
- [ ] `allowedHosts` includes both `127.0.0.1:${port}` and `localhost:${port}`
- [ ] No files outside the in-scope list are modified (`git status`)
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back if:

- The installed SDK does not expose `enableDnsRebindingProtection` / `allowedHosts` (Step 1 finds nothing).
- The "Current state" excerpt no longer matches the live code.
- Enabling the option causes the typecheck to fail in a way that can't be resolved by matching the SDK's declared field names.

## Maintenance notes

- If the MCP server is ever changed to bind a non-loopback host or to support remote agents, `allowedHosts` must be revisited deliberately (with auth), not widened casually.
- If a future SDK upgrade renames or removes these options, this is the place to update; keep the loopback `allowedHosts` invariant.
- A reviewer should confirm `port` (not a hardcoded value) is interpolated into `allowedHosts`, so a non-default `--mcp-port` still works.
