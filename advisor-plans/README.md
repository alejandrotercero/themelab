# Desktop Project Lifecycle Replan

Generated on 2026-08-08 against commit `45a8251` and the current uncommitted
desktop working tree. These plans supersede the workspace/dev-process portion of
Phase 2 in `tasks/spec-desktop-app.md`. They do not supersede the Change Store,
Theme Workspace, Inspector, or ACP plans.

## Why this replan exists

The current desktop spike collapses several different identities into one global
`workspaceRoot` and one framework default port:

- the directory the user authorized ThemeLab to access;
- the runnable React package inside that directory;
- the package-manager/lockfile root used for installation;
- the exact Node and package-manager executables;
- the actual URL of the running development server;
- whether that server is owned by ThemeLab or merely attached.

That model is not safe or reliable for monorepos, non-default ports, GUI-launched
Electron environments, external servers, or process cleanup. Do not add more
desktop editing UI until all five plans below are complete.

## Execution protocol

This is a reset, not permission to keep layering patches onto the old flow. The
partial lifecycle code currently in the working tree is **unverified**. It may be
used as a starting point, but none of it advances a plan's status until that
plan's complete test and review gate passes.

- Work one plan at a time and update its status only after its listed checks pass.
- Do not launch Electron, connect a preview, or judge behavior from a screenshot
  until Plan 005's automated fixture gate is green.
- Do not work on the Inspector, Theme Workspace, toolbar, or ACP while a lifecycle
  plan remains incomplete.
- A build/typecheck is a regression check, never lifecycle acceptance evidence.

## Execution order

| Plan | Title | Priority | Effort | Depends on | Status |
| --- | --- | --- | --- | --- | --- |
| 001 | Model workspace, app, install, and runtime paths explicitly | P1 | L | — | ACCEPTED — automated gates passed 2026-08-08 |
| 002 | Make dependency installation explicit, cancellable, and package-manager-correct | P1 | M | 001 | ACCEPTED — automated gates passed 2026-08-08 |
| 003 | Rebuild dev-server start, attach, endpoint, and process ownership | P1 | L | 001 | ACCEPTED — automated dynamic-port and owned-stop gates passed 2026-08-08 |
| 004 | Wire the lifecycle state machine through validated IPC and honest UI states | P1 | M | 001, 002, 003 | ACCEPTED — session-scoped grouped/compatibility bridge, sender validation, lifecycle projection tests, and native setup/preview smoke pass 2026-08-08 |
| 005 | Prove lifecycle behavior with Next.js/Vite fixtures and process-leak tests | P1 | L | 001–004 | ACCEPTED — automated fixtures, native Electron boundary smoke, and macOS cleanup review passed 2026-08-08 |

## Non-negotiable decisions

1. ThemeLab never downloads or installs Node.
2. Selecting a directory never silently expands filesystem access to an ancestor.
3. Dependency installation is a separate, explicit user action that previews the
   exact package-manager command and working directory.
4. Starting a server never uses the framework's conventional port as proof of
   identity. The actual target is an explicit `http://` or `https://` loopback URL.
5. Attaching never grants ThemeLab ownership of the external process.
6. Closing a project or quitting the app stops the complete process tree for
   ThemeLab-owned installs/dev servers and only disconnects attached servers.
7. Every async event carries a workspace/session ID so output from an old process
   cannot mutate the newly opened project.
8. The renderer never receives raw environment variables, arbitrary executable
   access, or a generic shell command API.
9. `packages/cli/src/detect.ts` may suggest a framework; its default port is never
   consumed by Desktop as the runtime endpoint.
10. Inspector and Theme work may proceed only as lifecycle-aware surfaces; ACP
    remains deferred until its own plan is accepted.

## Working-tree warning

The plans were written while these existing files were dirty:

- `apps/desktop/src/main.ts`
- `apps/desktop/src/preload.cjs`
- `apps/desktop/src/renderer/App.tsx`
- `apps/desktop/src/renderer/env.d.ts`
- `apps/desktop/src/renderer/styles.css`
- `packages/cli/src/inject.ts`

Before execution, preserve or commit that work intentionally. Do not reset or
discard it. Every executor must compare the live code with the excerpts in its
plan and stop on meaningful drift.

## Completion gate

The project lifecycle is not complete merely because the Electron build passes.
Plan 005 must demonstrate all of the following with automated evidence:

- app selected inside a monorepo without confusing app and install roots;
- Node mismatch blocks install/start without downloading anything;
- npm, pnpm, Yarn, and Bun command generation is unit tested;
- Next.js and Vite start on dynamically allocated non-default ports;
- explicit attach works on a user-supplied loopback URL;
- a port occupied by another app is never silently treated as the selected app;
- project close and app quit terminate owned process trees;
- attached processes survive disconnect and app quit;
- proxy, selection bridge, HMR, and preview all use the resolved target URL;
- repeated open/start/close cycles leave no listeners, child processes, or ports.
