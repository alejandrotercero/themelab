# Plan 002: Make dependency installation explicit, cancellable, and package-manager-correct

> **Executor instructions**: Execute only after Plan 001 is DONE. Run each gate and
> update `advisor-plans/README.md`. Do not add dev-server startup here.
>
> **Drift check (run first)**:
> `git diff --stat 45a8251..HEAD -- apps/desktop/src/main.ts apps/desktop/src/main/project apps/desktop/src/preload.cjs apps/desktop/src/renderer`.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: MED
- **Depends on**: `advisor-plans/001-model-workspace-runtime.md`
- **Category**: correctness / dx
- **Planned at**: commit `45a8251`, 2026-08-08

## Why this matters

The current installer guesses a package manager from a lockfile in the selected
folder and immediately spawns it. It can install from the wrong directory in a
monorepo, uses the ambient GUI PATH, reverses npm clean-install behavior, and cannot
be cancelled or associated safely with a workspace switch.

## Current state

- `apps/desktop/src/main.ts:196-214` constructs install commands directly from
  `workspaceRoot` and a boolean `node_modules` check.
- npm currently chooses `install` when dependencies exist and `ci` when they do not,
  regardless of lockfile semantics.
- Install output shares the same unscoped global log array as the dev server.
- The renderer invokes installation without a configuration object or confirmation
  of exact command/cwd.

## Target behavior

Add a `DependencyService` that consumes Plan 001's immutable descriptor and exposes:

```ts
interface InstallPlan {
  projectId: string;
  executable: string;
  args: string[];
  cwd: string;
  displayCommand: string;
  lockfileMode: "frozen" | "mutable";
  mutatesLockfile: boolean;
}

type InstallState =
  | { status: "idle" }
  | { status: "needs-confirmation"; plan: InstallPlan }
  | { status: "installing"; operationId: string; plan: InstallPlan }
  | { status: "ready" }
  | { status: "cancelled" }
  | { status: "error"; message: string; exitCode?: number };
```

Command policy:

- npm + lockfile: `npm ci`; npm without lockfile: `npm install` and mark
  `mutatesLockfile: true`.
- pnpm + lockfile: `pnpm install --frozen-lockfile`; without lockfile:
  `pnpm install`, marked mutable.
- Yarn Berry: `yarn install --immutable`; Yarn classic:
  `yarn install --frozen-lockfile`.
- Bun + lockfile: `bun install --frozen-lockfile`; otherwise `bun install` mutable.
- Use the exact resolved executable and `installRoot` from Plan 001. Never call a
  package manager by an unresolved bare name.
- Do not auto-install Node, Corepack, or a package manager. Missing/incompatible tools
  return an actionable blocked state.
- Show exact command and cwd before confirmation. Only an explicit user action runs it.
- Allow cancel. Installation is an owned process tree and is terminated on workspace
  close, project switch, or app quit.
- Tag every log and completion event with project ID and operation ID; stale events are
  ignored.
- On success, rerun dependency readiness. Do not equate exit code 0 with readiness.

## Scope

**In scope**:

- `apps/desktop/src/main/project/dependency-service.ts` (new)
- focused unit/integration tests
- project model additions required for install state
- narrow main/preload IPC for `plan`, `confirm`, `cancel`, and subscribed logs
- minimal renderer state needed to present the exact plan and result

**Out of scope**:

- dev-server start/attach;
- arbitrary terminal commands;
- automatic package-manager/Node installation;
- Inspector/Theme/ACP work.

## Steps

### Step 1: Characterize command generation

Write table-driven tests for npm, pnpm, Yarn 1, Yarn Berry, and Bun with and
without lockfiles, plus monorepo app/install-root separation.

**Verify**: all generated executable paths, args, cwd, and mutation flags match the
policy above.

### Step 2: Implement explicit install planning

Return a plan without spawning. Reject runtime mismatch, missing executable, project
ID mismatch, and install roots outside the authorized workspace.

**Verify**: rejection tests pass; planning causes no filesystem mutation.

### Step 3: Add owned install execution and cancellation

Spawn without a shell, capture bounded structured logs, and own the full process tree
using the platform process-group strategy defined in Plan 003. Make completion
idempotent and session-scoped.

**Verify**: a fixture install process with a child is fully terminated on cancel.

### Step 4: Expose narrow validated IPC

Use request schemas and sender validation. The renderer may choose only a previously
generated plan ID; it cannot submit executable paths or arbitrary args.

**Verify**: malformed/stale plan IDs are rejected in integration tests.

## Commands you will need

| Purpose | Command | Expected on success |
| --- | --- | --- |
| Focused tests | `pnpm --filter @themelab/desktop test -- dependency-service` | all pass |
| Typecheck | `pnpm --filter @themelab/desktop typecheck` | exit 0 |
| Build | `pnpm --filter @themelab/desktop build` | exit 0 |

## Done criteria

- [x] No dependency install can begin without a generated plan and explicit
  confirm; install-controller tests cover plan IDs, confirmation, cancellation,
  and stale-plan rejection.
- [x] Exact executable, args, cwd, and lockfile mutation are exposed in the
  install plan and rendered in the desktop setup/server surfaces.
- [x] All four package-manager policies are tested (pnpm, npm, Yarn, and Bun
  command generation).
- [x] Workspace switch/close/app quit cancels the owned install tree through the
  shared shutdown path; the owned-process and install-controller suites cover
  descendant cleanup and cancellation.
- [x] A successful command reruns dependency readiness and refreshes the
  workspace summary.
- [x] No Node/package-manager downloader exists; runtime resolution reports an
  existing executable requirement instead.

## STOP conditions

- A package manager cannot be resolved to an existing executable.
- Supporting a project would require executing an arbitrary shell string.
- The install root lies outside the authorized workspace.

## Maintenance notes

Install and dev-server processes need separate operation IDs and logs. They may share
the low-level owned-process primitive introduced in Plan 003, but never one mutable
global child-process variable.
