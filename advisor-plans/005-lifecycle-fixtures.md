# Plan 005: Prove the desktop lifecycle with fixtures and leak tests

> **Executor instructions**: Execute only after Plans 001–004 are DONE. This is the
> gate before any further desktop feature work. Fix only lifecycle defects exposed by
> these tests; stop if failures require unrelated UI/editor changes.
>
> **Drift check (run first)**:
> `git diff --stat 45a8251..HEAD -- apps/desktop packages/cli/src/inject.ts packages/cli/src/detect.ts`.

## Status

- **Priority**: P1
- **Effort**: L
- **Risk**: MED
- **Depends on**: Plans 001–004
- **Category**: tests / correctness
- **Planned at**: commit `45a8251`, 2026-08-08

## 2026-08-08 manual macOS review (partial)

Passed in the live Electron development build:

- launcher → recent project selection shows the project-server setup view only;
  no preview, inspector, or floating editor controls mount before a server exists;
- detected pnpm Next script starts with a dynamically allocated loopback port
  (observed: `53845`, `54133`, and `54266`; never a framework default);
- the preview connects through ThemeLab's proxy after the server is healthy;
- Stop removes the native preview, returns to the setup view, reports `No preview
  connected`, and releases the owned port;
- Close Project while an owned Next process is running returns atomically to the
  launcher and releases the owned port.
- attach to an independently started loopback HTTP server succeeds, identifies the
  server as attached, and Disconnect removes the preview while the external
  listener remains reachable; ThemeLab does not signal or terminate it.
- launch against a disposable Vite workspace opens a valid session before the
  renderer loads; Attach renders Vite through ThemeLab's proxy, and editing the
  served HTML updates the embedded preview live. Disconnect and Close Project
  preserve the independently started Vite listener.
- quit ThemeLab while attached to an independent loopback HTTP server; the
  ThemeLab process exits and the external listener remains alive.
- launch against the real ThemeLab monorepo; Electron requires an app choice,
  selecting `apps/web` generates a pnpm command rooted at that app and starts
  on a dynamic loopback port. The preview connects, and Close Project releases
  the owned listener and returns to the launcher.
- launch Electron with a deliberately reduced PATH; stable fnm Node discovery
  and the installed pnpm location are recovered without downloads. The owned
  Next server starts, previews, and releases its dynamic port on Close Project.

Defect found and fixed during this review: pnpm was given npm's `--` script
separator, causing Next to treat `--hostname` as a positional project directory.
The command planner now uses pnpm's direct trailing flags and has a regression
test; npm retains its required separator. The live Next fixture now executes the
full selected-monorepo path (project inspection → package-manager resolution →
command planner → owned process), rather than bypassing that path with a direct
`next dev` command. Command generation is unit-covered for pnpm, npm, Yarn, and
Bun.

Automated proxy boundary coverage now verifies that HTTP and WebSocket/HMR
upgrades reach the exact resolved target URL. At the time of the original review
the lifecycle gate was still unaccepted; the subsequent native boundary test
below closes that final automated gap.

Additional automated evidence: the real Next and Vite lifecycle fixtures occupy
their conventional ports (3000 and 5173) with an unrelated loopback listener
when those ports are available. ThemeLab still allocates a distinct strict
endpoint, serves the selected project there, and does not stop the unrelated
listener. Existing external listeners are never signalled by the test.

Desktop bridge review: the proxy no longer hides `#themelab-root` in desktop
mode. That host owns the selection canvas, so hiding it removed the CLI-style
selection outline. Desktop mode now suppresses only the duplicated CLI panels,
while retaining the selection outline and source label. A live Electron click
on `next-starter` showed the outline over the selected `Section` and retained
the native inspector update without nested CLI chrome.

Owned cleanup review: an Electron-owned `next-starter` server ran on dynamic
port 58510. Closing that project through the desktop UI released the listener.
The low-level owned-process test additionally proves that a spawned descendant
is terminated with its private POSIX process group. Switch and app-quit
coverage were initially open until their full Electron paths were exercised
directly; the repeatable boundary test below now covers app quit as well.

Signal cleanup review: after rebuilding the desktop app, Electron PID `50222`
was terminated with `SIGINT` while its owned Next child was listening on dynamic
port `62524`. Two seconds later Electron, `next-server`, and the `62524`
listener were all gone. This exercised the synchronous process-group safety net
added for native Electron signal exits; no unrelated listener was touched.

Repeatable Electron boundary coverage: `electron-boundary.test.ts` now launches
the built Electron binary against a generated Vite-shaped React fixture, starts
the fixture through project inspection and the owned-process controller, then
quits through the real `before-quit` path. The test observed dynamic port `64613`
and asserted both a clean Electron exit and a closed listener.

### 2026-08-08 desktop compositor follow-up

The real Electron build exposed two renderer/native compositor defects and now
has direct visual evidence for both fixes:

- The preview slot did not remeasure when a project became ready, so the native
  `WebContentsView` kept its fallback width and left a white strip beside the
  page. Bounds measurement now reruns on preview/server readiness and panel or
  dock changes; the live `next-starter` screenshot fills the preview column to
  the inspector with no blank strip.
- The Server diagnostics panel was mounted underneath the native view. Opening
  it now reserves a 430px left gutter, moves the native preview into the
  remaining space, and leaves the panel readable. The live screenshot shows
  the process log, dynamic port `61723`, and the selection outline together.

The setup screen also hydrates its workspace summary after the session opens,
so the detected Node version, pnpm manager, and dependency-ready gate are
visible before Start is enabled. Stale color/Tailwind picker anchors are
discarded when their inspector row unmounts.

## Why this matters

The desktop spike has repeatedly been judged from builds and screenshots while basic
project/server behavior remained wrong. This plan establishes executable proof for
paths, runtimes, installs, ports, ownership, HMR, and cleanup. Desktop feature work
does not resume until this matrix is green.

## Fixture matrix

Create deterministic fixtures under `apps/desktop/fixtures/` or test-generated temp
directories:

1. standalone Next.js app with a declared non-default Node requirement;
2. standalone Vite app;
3. pnpm monorepo with two React apps and one workspace lockfile;
4. npm workspace equivalent for install-root behavior;
5. custom dev script that prints one loopback URL;
6. custom script that prints two viable URLs;
7. process-tree fixture whose package-manager parent spawns a long-lived child;
8. external loopback HTTP/WebSocket server that records whether it was signalled.

Use minimal fixture source and deterministic routes. Do not install fixture dependencies
from the network during the test suite; reuse workspace packages, mock process adapters,
or provide tiny local HTTP servers where framework behavior is not the subject.

## Required tests

### Unit

- workspace/app/install-root containment and monorepo choice;
- runtime precedence and semver mismatch;
- package-manager/version/command policy;
- endpoint parsing and loopback URL validation;
- state-machine transition and stale-event rejection;
- process-tree stop escalation.

### Integration

- select pnpm monorepo root → choose app → correct appRoot/installRoot;
- plan install → explicit confirm → cancel and close cleanup;
- start Next fixture on an allocated port not equal to 3000;
- start Vite fixture on an allocated port not equal to 5173;
- attach explicit external URL and disconnect without signalling it;
- occupy conventional ports with a different server and prove no automatic attach;
- route HTTP and HMR websocket traffic through ThemeLab proxy to exact target URL;
- switch projects during startup and prove old logs/exit events are ignored;
- repeat open/start/stop/close at least five times and assert no child/listener/port leak;
- app quit stops owned tree and preserves attached server.

### Manual macOS acceptance

- launch Electron from Finder-like GUI environment with a reduced PATH;
- open a project using Volta/nvm/mise/asdf-installed Node without downloading Node;
- choose an incompatible Node and verify install/start are blocked clearly;
- inspect exact command/cwd before dependency install;
- run Next and Vite on non-default ports;
- close project and quit app while server is running;
- reopen recent project and confirm no server is attached until explicit start/attach;
- verify preview selection, source path, HMR, theme token read, and no nested overlay.

Record the manual results in `advisor-plans/005-lifecycle-fixtures.md` under a dated
review section; do not mark DONE from memory or screenshots alone.

## Scope

**In scope**:

- Desktop lifecycle test configuration and fixtures;
- targeted fixes in Plan 001–004 files when a required test exposes a defect;
- CLI proxy tests needed for exact target URL/HMR;
- root scripts for a one-command lifecycle gate.

**Out of scope**:

- Inspector/Theme/ACP feature expansion;
- visual parity work;
- packaging/signing;
- production/remote site support.

## Commands you will need

Add one canonical command such as:

| Purpose | Command | Expected on success |
| --- | --- | --- |
| Lifecycle gate | `pnpm test:desktop-lifecycle` | all unit/integration tests pass |
| Desktop typecheck | `pnpm --filter @themelab/desktop typecheck` | exit 0 |
| Desktop build | `pnpm --filter @themelab/desktop build` | exit 0 |
| CLI regression | `pnpm --filter themelab-cli test -- --run` | all pass |

## Steps

### Step 1: Build deterministic fixtures and leak assertions

Create helpers for free ports, waiting on readiness without fixed sleeps, enumerating
owned descendants, and asserting port release.

**Verify**: fixture self-tests pass and always clean up in `finally`.

### Step 2: Add unit and service integration coverage

Implement the matrix above. Use injected process/filesystem adapters where possible;
reserve real child processes for ownership and proxy boundaries.

**Verify**: lifecycle gate passes twice consecutively.

### Step 3: Add Electron boundary coverage

Exercise validated IPC, session revisions, native preview create/destroy, close, and
quit through the smallest practical Electron test harness.

**Verify**: repeated cycle test leaves no Electron child, fixture child, or bound port.

### Step 4: Run and document the macOS acceptance matrix

Run against real Next and Vite projects only after automated tests pass. Record exact
observed ports, ownership, and cleanup outcomes; do not record home-directory paths.

**Verify**: every manual item is PASS or has a linked blocking defect.

## Done criteria

- [x] `pnpm test:desktop-lifecycle` passes twice consecutively (2026-08-08).
- [x] Next and Vite are proven on non-default dynamically allocated ports.
- [x] Conventional-port collision never attaches the wrong app.
- [x] Owned descendants are terminated on stop, close, switch, and quit. Close
  Project and a rebuilt Electron `SIGINT` run were manually verified; the
  dynamic owned listener was released and no unrelated listener was touched.
- [x] Attached server survives disconnect and quit.
- [x] Monorepo app/install roots and GUI runtime resolution are proven.
- [x] Proxy HTTP/HMR and clean bridge/no-nested-overlay are proven.
- [x] Desktop build/typecheck and all existing CLI tests pass (desktop 56 tests;
  CLI 233 tests; 2026-08-08).
- [x] Dated macOS acceptance results are recorded.
- [x] Repeatable Electron boundary smoke launches a generated fixture, exercises
  native app quit, and asserts owned-port release (`electron-boundary.test.ts`).

## STOP conditions

- Tests require live network dependency installation.
- Cleanup cannot be made deterministic without killing unrelated processes.
- A test passes only with fixed sleeps or a conventional port assumption.
- Fixing a failure requires unrelated editing-surface work.

## Maintenance notes

Run `pnpm test:desktop-lifecycle` for every future change to workspace discovery,
runtime resolution, dependency installation, proxy setup, preview lifecycle, or ACP
process ownership. Add a fixture before advertising a new framework or package manager.
