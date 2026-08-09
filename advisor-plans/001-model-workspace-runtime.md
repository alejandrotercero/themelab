# Plan 001: Model workspace, app, install, and runtime paths explicitly

> **Executor instructions**: Follow this plan step by step. Run every verification
> command before moving on. Update the status row in `advisor-plans/README.md` when
> done. Do not implement dependency installation or dev-server spawning here.
>
> **Drift check (run first)**:
> `git diff --stat 45a8251..HEAD -- apps/desktop packages/cli/src/detect.ts`
> and `git diff --stat -- apps/desktop packages/cli/src/detect.ts`.
> This plan was written against a dirty desktop working tree. Preserve those
> changes and stop if the current symbols no longer match the Current state.

## Status

- **Priority**: P1
- **Effort**: L
- **Risk**: MED
- **Depends on**: none
- **Category**: tech-debt / correctness
- **Planned at**: commit `45a8251`, 2026-08-08

## Why this matters

Desktop currently treats one selected directory as project root, package-manager
root, runtime root, source-write boundary, and dev-server identity. That works only
for the simplest single-package project. A trustworthy desktop app must resolve and
display each path separately, never widen authorization implicitly, and refuse to
install or run when the required local runtime is unavailable.

## Current state

- `apps/desktop/src/main.ts:32-43` stores mutable global `workspaceRoot`, preview,
  proxy, sketch server, and child process state.
- `apps/desktop/src/main.ts:159-193` calls CLI framework detection, checks lockfiles
  only in the selected directory, uses `which node`, and treats existence of
  `node_modules` as dependency readiness.
- `apps/desktop/src/main.ts:217-246` persists only an array of recent paths.
- `packages/cli/src/detect.ts:37-55` returns conventional framework ports (`3000`
  or `5173`). Those are useful CLI suggestions, not Desktop runtime endpoints.
- `tasks/spec-desktop-app.md:204-212` requires a confirmation step showing
  framework, package manager, candidate commands, port, Git state, and chosen
  existing-server URL before preview startup.
- `tasks/spec-desktop-app.md:359-374` makes the canonical real path the privileged
  filesystem boundary.

## Target model

Create Electron-independent types and discovery functions under
`apps/desktop/src/main/project/`:

```ts
type DependencyStatus = "unknown" | "checking" | "ready" | "missing" | "error";

interface ProjectDescriptor {
  id: string;
  workspaceRoot: string;   // canonical path explicitly authorized by user
  appRoot: string;         // runnable React package, inside workspaceRoot
  installRoot: string;     // lockfile/package-manager root, inside workspaceRoot
  displayName: string;
  framework: "nextjs" | "vite" | "cra" | "unknown";
  packageJsonPath: string;
  packageManager: PackageManagerResolution;
  runtime: RuntimeResolution;
  scripts: DevScriptCandidate[];
  dependencyStatus: DependencyStatus;
  git: { root: string | null; branch: string | null; changedFiles: number };
}

interface RuntimeResolution {
  requirement: string | null;
  requirementSource: string | null;
  executable: string | null;
  version: string | null;
  compatible: boolean | null;
  source: "path" | "login-shell" | "volta" | "mise" | "asdf" | "user" | null;
}
```

Rules:

- `workspaceRoot` is the selected canonical real path and never changes without a
  new user authorization.
- If the selected folder is a monorepo root, discover runnable React packages below
  it and require the user to choose `appRoot`.
- If the selected folder is an app whose controlling lockfile is in an ancestor,
  do not silently widen access. Return a diagnostic asking the user to reopen the
  monorepo root, while still allowing external-server attach without installation.
- Resolve `installRoot` from `pnpm-workspace.yaml`, `package-lock.json`,
  `npm-shrinkwrap.json`, `yarn.lock`, `bun.lock`, or `bun.lockb`, bounded by
  `workspaceRoot`.
- Prefer `package.json#packageManager` over lockfile inference. Record both name and
  declared version.
- Runtime requirement precedence: `package.json#volta.node`, `.nvmrc`,
  `.node-version`, `.tool-versions`, then `package.json#engines.node`.
- Resolve existing Node executables only. Check the Electron environment, validated
  login-shell `command -v node` output, common installed shim paths, and an explicit
  user-selected executable. Never run a version-manager install command.
- Validate the exact executable with `execFile(nodePath, ["--version"])` and semver.
  A mismatch yields `compatible: false`; it does not switch or download silently.
- Dependency readiness must resolve the selected app's required packages from
  `appRoot` using the resolved Node executable. It is not equivalent to testing for
  an arbitrary `node_modules` directory.
- Generate a stable project ID from canonical workspace/app paths without exposing
  full home paths to the renderer logs.

## Commands you will need

| Purpose | Command | Expected on success |
| --- | --- | --- |
| Desktop typecheck | `pnpm --filter @themelab/desktop typecheck` | exit 0 |
| Desktop build | `pnpm --filter @themelab/desktop build` | exit 0 |
| Existing CLI tests | `pnpm --filter themelab-cli test -- --run` | all pass |

## Scope

**In scope**:

- `apps/desktop/src/main/project/project-model.ts` (new)
- `apps/desktop/src/main/project/project-discovery.ts` (new)
- `apps/desktop/src/main/project/runtime-resolver.ts` (new)
- `apps/desktop/src/main/project/project-store.ts` (new)
- focused tests beside those files
- `apps/desktop/src/main.ts` only to replace `WorkspaceSummary`/recent-path
  discovery with the new service
- `apps/desktop/src/preload.cjs` and `renderer/env.d.ts` only for the typed read-only
  project descriptor
- `apps/desktop/package.json` only for test dependencies/scripts

**Out of scope**:

- installing dependencies;
- starting, attaching, or stopping servers;
- preview/proxy changes;
- Inspector, Theme, Changes, or ACP UI;
- changing CLI default-port behavior.

## Git workflow

- Branch: `advisor/desktop-project-lifecycle`
- Use conventional commits; example: `feat: establish desktop workspace foundation`.
- Do not push or open a PR unless instructed.

## Steps

### Step 1: Add characterization tests for current discovery inputs

Create temporary-fixture tests for single-package Next/Vite projects, pnpm/npm
monorepos, an app with an ancestor lockfile outside the authorized root, missing
`package.json`, malformed JSON, symlinked roots, and multiple React packages.

**Verify**: run the new focused test file; every fixture is removed after the test.

### Step 2: Introduce the typed project descriptor and pure discovery service

Keep filesystem access injected or isolated so discovery can be tested without
Electron. Validate every candidate root with `realpath` and containment checks.
Return structured diagnostics rather than swallowing exceptions.

**Verify**: project-discovery tests pass and contain no Electron imports.

### Step 3: Resolve existing runtimes without installation

Implement the provider chain and semver compatibility result. All executable calls
must use `execFile`; never build a shell command from project input. If a login shell
is consulted, execute only a constant `command -v` probe and validate that stdout is
one absolute executable path before using it.

**Verify**: tests cover compatible, incompatible, missing, malformed, and explicit
user-selected Node paths. A fake provider must prove no install command is invoked.

### Step 4: Persist versioned project records

Replace the path-only state with schema version 2 records containing canonical
workspace/app/install roots and non-secret choices. Add migration from version 1
recents. Missing paths become unavailable recents; they are not silently deleted.

**Verify**: migration and atomic-write tests pass.

### Step 5: Integrate read-only discovery into main/preload

Replace renderer-facing duplicated anonymous types with exported project-domain
types. Opening a folder produces `needs-app-choice`, `ready`, or `unsupported`; it
does not start a process or preview.

**Verify**: Desktop typecheck and build pass.

## Test plan

- Unit-test path containment, monorepo discovery, install-root bounds, runtime source
  precedence, semver compatibility, dependency readiness, record migration, and
  stale/missing recents.
- Use temporary directories; do not depend on the developer's real Node managers.
- Mock executable probing behind an injected interface.

## Done criteria

- [x] No Desktop start/install code calls `detect(root).port` (source audit
  2026-08-08: no matches under `apps/desktop/src`).
- [x] Renderer can distinguish workspace root, app root, and install root via the
  workspace summary and lifecycle project descriptor.
- [x] Selecting an app below an external ancestor lockfile never widens access;
  `project-discovery.test.ts` covers the bounded install-root result.
- [x] Node mismatch is a structured blocking state and no Node download exists;
  runtime resolver tests cover the existing-runtime-only policy.
- [x] Project-store v1 migration tests pass (`project-store.test.ts`, 3 tests).
- [x] Desktop typecheck/build and existing CLI tests pass (desktop 56 tests;
  CLI 233 tests; 2026-08-08).
- [x] No unplanned changes remain relative to the cumulative 001–005 replan;
  desktop compositor and lifecycle fixes are explicitly tracked by Plans 004–005.

## STOP conditions

- The plan would require widening filesystem access without user confirmation.
- Runtime resolution would need to source arbitrary project shell scripts.
- A Node/package-manager installation is proposed as part of discovery.
- Existing dirty desktop changes cannot be preserved cleanly.

## Maintenance notes

Every future privileged IPC call must carry the active project/session ID and be
checked against the canonical `workspaceRoot`. Framework default ports remain
display-only suggestions until Plan 003 resolves an actual endpoint.
