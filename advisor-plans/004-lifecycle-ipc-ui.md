# Plan 004: Wire lifecycle state through validated IPC and honest UI states

> **Executor instructions**: Execute after Plans 001–003 are DONE. This plan is
> lifecycle UI only; do not redesign the Inspector or Theme Workspace.
>
> **Drift check (run first)**:
> `git diff --stat 45a8251..HEAD -- apps/desktop/src/main.ts apps/desktop/src/preload.cjs apps/desktop/src/renderer apps/desktop/src/main/project`.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: MED
- **Depends on**: Plans 001, 002, 003
- **Category**: correctness / dx
- **Planned at**: commit `45a8251`, 2026-08-08

### Implemented so far (not accepted)

- Main owns a revisioned `LifecycleSession`; lifecycle events carry the active
  session ID and stale-session actions are rejected.
- Lifecycle mutations are accepted only from the active ThemeLab shell renderer,
  then validate the active session ID. The renderer cannot provide cwd, command,
  environment, or executable arguments.
- The renderer now uses grouped `workspace`, `dependencies`, `dev`, and
  `session` bridge namespaces for every lifecycle operation. The legacy flat
  bridge surface remains only as temporary compatibility for non-lifecycle
  preview/editor calls while those APIs are separately migrated.
- The renderer gates its editor/preview shell on an owned or attached ready server;
  selected-but-idle projects render only the project-server setup state.
- `deriveLifecycleView()` now projects the complete session snapshot into explicit
  `no-project`, app-choice, setup, starting, preview-connecting, ready, and error
  phases. The renderer uses that projection for the shell branch and server label;
  the legacy local dev flag is retained only as a transient compatibility fallback.
- The projection is table-tested across all phases, including the important
  `server ready / preview not ready` state where editing remains disabled.
- Real Electron smoke checks cover launcher → recent project → server setup,
  owned start/stop/close, and attach/disconnect.

The grouped bridge and component-level lifecycle-state projection now have direct
coverage. The flat preview/editor names remain as compatibility aliases, but they
are session-scoped and sender-validated like the grouped lifecycle calls.

## Why this matters

The current renderer derives several independent strings and booleans from global
IPC calls, allowing impossible combinations such as a selected project, a blank
preview saying "connecting," and a server control whose endpoint is unknown. The UI
must render one authoritative session snapshot and offer only actions valid in that
state.

## Current state

- `apps/desktop/src/preload.cjs:3-51` exposes separate root/summary/install/start/
  attach/stop calls with no project/session ID.
- `apps/desktop/src/renderer/env.d.ts:6-20` duplicates large anonymous state shapes.
- `apps/desktop/src/renderer/App.tsx` independently tracks workspace name, summary,
  server state, logs, status strings, and preview state.
- `tasks/spec-desktop-app.md:586-614` requires grouped, narrow, validated, session-
  scoped IPC.

## Target contract

Expose a grouped bridge backed by shared domain types:

```ts
window.themelab.workspace.open();
window.themelab.workspace.chooseApp(projectId, appId);
window.themelab.workspace.close(sessionId);
window.themelab.workspace.subscribe(handler);
window.themelab.dependencies.plan(sessionId);
window.themelab.dependencies.confirm(sessionId, planId);
window.themelab.dependencies.cancel(sessionId, operationId);
window.themelab.dev.start(sessionId, scriptId);
window.themelab.dev.attach(sessionId, validatedUrl);
window.themelab.dev.stop(sessionId);
window.themelab.session.subscribe(handler);
```

Main validates request schema, sender/frame, active session ID, and allowed IDs. The
renderer never supplies executable paths, cwd, environment variables, or arbitrary
args. Events contain a monotonically increasing revision and one complete session
snapshot so stale/out-of-order updates can be ignored.

Required visible states:

- no project: Open Project + valid recents;
- inspecting project;
- app choice required for monorepo;
- runtime blocked with exact requirement/path/version and Choose Node action;
- dependencies missing with an install-plan confirmation;
- project ready with Start Dev Server and Attach Existing URL;
- starting with command/cwd/elapsed time and Stop;
- attached/owned ready with exact target URL and ownership label;
- stopping, exited, reconnecting, and actionable error;
- preview unavailable separately from server unavailable.

Do not auto-open the Inspector or show editable controls until preview status is
`ready`. Do not label an idle/error server simply "Server". Project close must await
cleanup and then atomically return to no-project state.

## Scope

**In scope**:

- shared lifecycle types under `apps/desktop/src/main/project/` or a desktop-local
  protocol module;
- `apps/desktop/src/main.ts` IPC composition and validation;
- `apps/desktop/src/preload.cjs`;
- `apps/desktop/src/renderer/env.d.ts`;
- lifecycle portions of `apps/desktop/src/renderer/App.tsx` and styles;
- IPC/state reducer tests.

**Out of scope**:

- Inspector/theme visual polish or capabilities;
- ACP;
- Change Store;
- new generic terminal UI.

## Steps

### Step 1: Define one session snapshot and reducer

Make illegal transitions reject with a structured error. Include session ID, revision,
descriptor, dependency state, server state, preview state, and bounded logs.

**Verify**: table-driven reducer tests cover every transition and stale event.

### Step 2: Replace ad-hoc IPC with grouped validated handlers

Validate sender and all arguments in main. Keep temporary compatibility methods only
until renderer migration completes, then remove them.

**Verify**: malformed payload and stale-session integration tests pass.

### Step 3: Render lifecycle states directly

Build a compact project setup/server panel using existing typography/icons. Exact
paths remain in tooltips/details; the main header shows project name, ownership,
endpoint, and status without debug wording.

**Verify**: component tests assert the valid actions for every snapshot state.

### Step 4: Gate preview/editor surfaces

Mount the native `WebContentsView` only when preview is connecting/ready. Hide or
disable editing surfaces until ready. Cleanup returns one atomic closed snapshot.

**Verify**: open → choose app → blocked runtime → ready → start → stop → close flow
has no impossible intermediate labels in renderer tests.

## Commands you will need

| Purpose | Command | Expected on success |
| --- | --- | --- |
| Desktop tests | `pnpm --filter @themelab/desktop test` | all pass |
| Typecheck | `pnpm --filter @themelab/desktop typecheck` | exit 0 |
| Build | `pnpm --filter @themelab/desktop build` | exit 0 |

## Done criteria

- [x] One session snapshot drives the lifecycle shell, server label, preview
  readiness, and editing gate; the legacy dev flag is only used before the
  initial snapshot handshake.
- [x] Every mutating IPC request includes and validates the active session ID,
  including the formerly-compatible preview/theme/source/change calls.
- [x] Renderer cannot submit arbitrary commands, paths, args, or env; project
  commands come from the inspected descriptor and source edits are containment-
  checked in main.
- [x] The exact target URL and ownership are visible in the Project server
  panel when ready (`Server` vs `Attached`).
- [x] No editing controls are active without a ready preview; lifecycle view
  tests cover server-ready/preview-connecting as a non-editable state and the
  renderer clears stale selection/inspector state.
- [x] Project close is awaited and returns atomically to the launcher.
- [x] Lifecycle projection, session guard, stale-session, and process-state
  tests pass (desktop suite: 56 tests).

## STOP conditions

- The UI needs to infer state from log text.
- A renderer action would require arbitrary command execution.
- An old event can mutate the new session.
- The work expands into Inspector/Theme redesign.

## Maintenance notes

Future ACP and Change Store events must reuse the session/revision envelope. Do not
introduce a second parallel workspace identity or status string system.
