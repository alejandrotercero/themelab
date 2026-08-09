# Plan 003: Rebuild dev-server start, attach, endpoint, and process ownership

> **Executor instructions**: Execute after Plan 001. Do not use conventional
> framework ports as runtime truth. Update `advisor-plans/README.md` when done.
>
> **Drift check (run first)**:
> `git diff --stat 45a8251..HEAD -- apps/desktop/src/main.ts apps/desktop/src/main/project packages/cli/src/detect.ts packages/cli/src/inject.ts`.

## Status

- **Priority**: P1
- **Effort**: L
- **Risk**: HIGH
- **Depends on**: `advisor-plans/001-model-workspace-runtime.md`
- **Category**: bug / architecture
- **Planned at**: commit `45a8251`, 2026-08-08

## Why this matters

The current implementation checks and proxies `detect(root).port`, so a Next.js
project is effectively identified as whatever happens to answer on port 3000. It
also kills only the package-manager parent process, allowing framework children to
survive. Server target, ownership, and process lifecycle must become one explicit,
session-scoped state machine.

## Current state

- `packages/cli/src/detect.ts:41-55` returns framework default ports.
- `apps/desktop/src/main.ts:297-342` probes that guessed port before spawning and
  waits less than four seconds for it after spawning.
- `apps/desktop/src/main.ts:276-295` sends signals only to the immediate child.
- `apps/desktop/src/main.ts:613-645` recomputes the guessed port and passes host/port
  into the proxy instead of receiving the actual server endpoint.
- `apps/desktop/src/main.ts:712-727` attaches without an explicit URL.
- `packages/cli/src/inject.ts:17-40` accepts only `targetHost` + `targetPort`.

## Target state machine

```ts
type ServerState =
  | { status: "idle"; projectId: string }
  | { status: "starting"; projectId: string; operationId: string; command: DevCommandPlan }
  | { status: "choosing-endpoint"; projectId: string; candidates: LoopbackEndpoint[] }
  | { status: "ready"; projectId: string; ownership: "owned" | "attached"; targetUrl: string; pid?: number }
  | { status: "stopping"; projectId: string; ownership: "owned" | "attached" }
  | { status: "exited"; projectId: string; exitCode: number | null; signal: string | null }
  | { status: "error"; projectId: string; message: string };
```

Endpoint policy:

- Runtime target is always a validated loopback `http://` or `https://` URL,
  including its actual port and optional base path.
- Attach requires a user-supplied or previously persisted URL. Validate host as
  `localhost`, `127.0.0.0/8`, or `[::1]`; reject credentials and non-loopback hosts.
- Starting a known framework allocates a free loopback port first and passes it
  through a framework adapter:
  - Next.js: append `--hostname 127.0.0.1 --port <port>` to the selected `dev` script;
  - Vite: append `--host 127.0.0.1 --port <port> --strictPort`;
  - CRA: set constant `HOST=127.0.0.1`, `PORT=<port>`, `BROWSER=none` env values.
- Do not automatically select `start`; default only to a `dev` script. Other scripts
  require explicit user selection from detected package scripts.
- For wrapper/custom scripts that cannot accept an adapter, parse ANSI-stripped
  stdout/stderr for loopback URLs. If zero or multiple viable endpoints remain after
  the readiness timeout, enter `choosing-endpoint` or error; never guess.
- Readiness timeout is configurable and defaults to 30 seconds. A process exit ends
  readiness immediately with captured output.
- A port already occupied before an owned start is an allocation retry, not an
  attach signal.

Ownership policy:

- Spawn owned dev servers without a shell and with a process group/job object.
- POSIX: create a separate process group and signal the group with `SIGTERM`, then
  `SIGKILL` after a bounded timeout.
- Windows: terminate the owned tree using a tested Job Object helper or `taskkill`
  invoked through `execFile` with fixed arguments.
- An attached server has no PID ownership and is never signalled.
- Every callback captures project/session/operation IDs and becomes a no-op after a
  switch or stop.
- Stop is idempotent and ordered: detach preview, close proxy/Sketch server, stop
  owned dev tree, release state/listeners. App quit waits for the same controller.

Proxy policy:

- Change the proxy API to consume a normalized `targetUrl` rather than reconstructing
  one from a guessed port. Keep a compatibility adapter for CLI host/port options.
- Preserve HMR websocket proxying and optional base path.
- `startThemeLabRuntime` receives the ready `ServerState`; it never calls `detect()`.

## Scope

**In scope**:

- `apps/desktop/src/main/project/owned-process.ts` (new)
- `apps/desktop/src/main/project/dev-command.ts` (new)
- `apps/desktop/src/main/project/dev-server-service.ts` (new)
- focused tests and child-process fixtures
- `apps/desktop/src/main.ts` lifecycle composition
- `packages/cli/src/inject.ts` target-URL support and tests
- CLI compatibility call-site changes required by the proxy API

**Out of scope**:

- dependency installation beyond sharing the owned-process primitive;
- visual editing UI;
- arbitrary remote URLs or production sites;
- automatic shell-script execution.

## Steps

### Step 1: Add failing lifecycle characterizations

Cover non-default port start, occupied-port retry, early exit, timeout, multiple URL
candidates, attached disconnect, and a spawned parent with a long-lived child.

**Verify**: tests fail against the current implementation for the intended reasons.

### Step 2: Implement command plans and framework adapters

Generate executable/args/cwd/env from the immutable project descriptor and selected
script ID. Do not accept renderer-provided arbitrary args.

**Verify**: exact command snapshots for Next, Vite, CRA, and custom scripts pass.

### Step 3: Implement owned process trees

Add platform-specific start/stop with bounded escalation, operation IDs, bounded logs,
and idempotent cleanup.

**Verify**: the child-process fixture leaves no descendant after stop, close, or quit.

### Step 4: Resolve actual endpoints

Use allocated ports for known adapters and URL parsing for custom scripts. Health-check
the exact candidate URL. Never consume `DetectionResult.port` in Desktop.

**Verify**: Next and Vite fixtures become ready on dynamically allocated ports that
are not 3000 or 5173.

### Step 5: Route the exact target URL through proxy and preview

Update proxy options, compatibility adapter, HMR websocket target, and Desktop runtime.

**Verify**: CLI tests remain green; proxy integration test proves HTTP + websocket
traffic reaches the non-default target URL.

### Step 6: Make shutdown one idempotent controller path

Workspace switch, explicit stop, close project, window close, and app quit must call
the same awaited cleanup method with ownership-aware behavior.

**Verify**: repeated cleanup calls pass and leave no ports/processes.

## Commands you will need

| Purpose | Command | Expected on success |
| --- | --- | --- |
| Desktop lifecycle tests | `pnpm --filter @themelab/desktop test -- dev-server` | all pass |
| CLI proxy tests | `pnpm --filter themelab-cli test -- --run` | all pass |
| Desktop typecheck | `pnpm --filter @themelab/desktop typecheck` | exit 0 |
| Desktop build | `pnpm --filter @themelab/desktop build` | exit 0 |

## Done criteria

- [x] `rg 'detect\([^)]*\)\.port|detection\.port' apps/desktop/src` finds no
  runtime endpoint use (source audit 2026-08-08).
- [x] Attach takes and validates an explicit loopback URL.
- [x] Owned Next/Vite fixtures start on non-default allocated ports and release
  them on stop (4 live lifecycle tests).
- [x] Custom scripts never cause silent endpoint guessing; ambiguous endpoints
  enter an explicit chooser state.
- [x] Owned process descendants are gone after stop/close/quit, including the
  rebuilt Electron `SIGINT` run on dynamic port `62524`.
- [x] Attached fixture remains alive after disconnect/quit (manual macOS review).
- [x] Proxy HTTP and HMR websocket tests pass against the exact target URL.
- [x] CLI behavior remains compatible (233 CLI tests pass).

## STOP conditions

- Supporting a script requires executing renderer-supplied shell text.
- Cleanup cannot prove descendant termination on the primary macOS target.
- Proxy target-URL support regresses existing CLI tests or HMR.
- An implementation proposes attaching automatically because a conventional port answered.

## Maintenance notes

Treat framework adapters as data-producing modules, not conditional branches spread
through Electron main. New frameworks must add command, endpoint, readiness, and
cleanup tests before being advertised.
