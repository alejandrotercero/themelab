# Plan 006: Harden project-root containment against symlink escape

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving on. If
> anything in "STOP conditions" occurs, stop and report. When done, update the
> status row for this plan in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat 515682b..HEAD -- packages/cli/src/path-resolver.ts packages/cli/src/__tests__/path-resolver.test.ts`
> If either changed since this plan was written, compare the "Current state"
> excerpts against the live code; on a mismatch, STOP.

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: MED
- **Depends on**: none
- **Category**: security
- **Planned at**: commit `515682b`, 2026-06-17

## Why this matters

Every file write the CLI performs is supposed to be confined to the project root — the README states "Only files inside the current project are eligible for writes." Containment is enforced by `resolveProjectFilePath` in `path-resolver.ts`, which uses a **string prefix check** on `path.resolve(...)` output. `path.resolve` normalizes `..` (so plain traversal is blocked, and there are tests for it), but it does **not** resolve symlinks. If the project contains a symlink that points outside the root (e.g. a user runs `themelab` inside an untrusted cloned repo that ships `./theme -> /Users/you/.ssh`), a write through that symlink passes the prefix check and lands outside the project. This plan adds `realpath`-based containment so the *canonical* destination must be inside the *canonical* root, and adds a symlink-escape test (the existing tests cover `..` and real-absolute-outside, but not symlinks).

## Current state

- `packages/cli/src/path-resolver.ts` — containment is a string prefix test; no `realpath`:

  ```ts
  // packages/cli/src/path-resolver.ts:1-6
  import * as fs from "node:fs";
  import * as path from "node:path";

  function isWithinProjectRoot(resolvedPath: string, projectRoot: string): boolean {
    return resolvedPath === projectRoot || resolvedPath.startsWith(projectRoot + path.sep);
  }
  ```

  `resolveProjectFilePath(filePath, projectRoot)` (lines 22-53) returns an absolute path inside the root, or `null`. `isProjectFilePathSafe` (line 55) is the boolean wrapper used by `server.ts` on every write path.

- `packages/cli/src/__tests__/path-resolver.test.ts` — tests cover project-relative, leading-slash, absolute-inside, `../` traversal rejection, and real-absolute-outside rejection. **No symlink test.** The helper `makeProject()` creates a temp dir via `fs.mkdtempSync` and `afterEach` cleans them up.

- Note on **macOS temp dirs**: `os.tmpdir()` is itself often a symlink (`/var` → `/private/var`). The current tests pass because both sides go through `path.resolve` without realpath. When you introduce realpath, you must realpath the **root** too (compare canonical-to-canonical), or the existing tests will break on macOS.

- Write call sites that rely on this (for context — not to modify): `server.ts` `updateTheme`/`reorder`/`updateProperty`/`updateText` all gate on `isProjectFilePathSafe` before resolving and writing.

## Commands you will need

| Purpose            | Command                                         | Expected on success |
|--------------------|-------------------------------------------------|---------------------|
| Install            | `pnpm install`                                  | exit 0              |
| Build shared       | `pnpm build:shared`                             | exit 0              |
| Typecheck          | `pnpm typecheck`                                | exit 0, no errors   |
| CLI tests          | `pnpm --filter themelab-cli exec vitest run`    | all pass            |

## Scope

**In scope**:
- `packages/cli/src/path-resolver.ts` — add realpath-based containment.
- `packages/cli/src/__tests__/path-resolver.test.ts` — add symlink-escape + symlink-inside tests.

**Out of scope** (do NOT touch):
- `server.ts`, `batch-transform.ts`, `theme-writer.ts` — they already call `isProjectFilePathSafe`/`resolveProjectFilePath`; tightening the resolver covers them. Do not sprinkle extra checks at call sites in this plan.
- The public signatures of `resolveProjectFilePath` / `isProjectFilePathSafe` — keep them identical so callers are unaffected.

## Git workflow

- Branch: `advisor/006-realpath-containment`.
- Conventional commit, e.g. `fix(cli): canonicalize paths to block symlink escape from project root`.
- Do NOT push or open a PR unless instructed.

## Steps

### Step 1: Add realpath canonicalization to the containment check

The challenge: a write target may not exist yet, and `fs.realpathSync` throws on a non-existent path. The robust approach is to canonicalize the **deepest existing ancestor** of the candidate, then re-append the non-existent tail, and compare against the canonicalized root.

In `packages/cli/src/path-resolver.ts`, add a helper and use it inside `resolveProjectFilePath` as a **final gate** after the existing logic produces a candidate. Suggested shape:

```ts
/** Canonical path of the deepest existing ancestor + the non-existent tail. */
function canonicalize(p: string): string {
  let cur = p;
  const tail: string[] = [];
  // Walk up until an existing path is found (or we hit the filesystem root).
  while (!fs.existsSync(cur)) {
    const parent = path.dirname(cur);
    if (parent === cur) return p; // reached root; nothing exists — return as-is
    tail.unshift(path.basename(cur));
    cur = parent;
  }
  const realBase = fs.realpathSync(cur);
  return tail.length ? path.join(realBase, ...tail) : realBase;
}
```

Then, in `resolveProjectFilePath`, after you have the in-root `candidate` (the value currently returned), gate it:

```ts
const canonicalRoot = canonicalize(normalizedRoot);
const canonicalCandidate = canonicalize(candidate);
if (!isWithinProjectRoot(canonicalCandidate, canonicalRoot)) return null;
return candidate; // return the pre-canonical path so call-site display/relativization is unchanged
```

Apply this gate to **every** return path that currently returns a non-null candidate (the absolute-inside branch, the leading-slash reinterpretation branch, and the relative branch). Keep returning `null` for the existing rejection cases.

**Verify**: `pnpm typecheck` → exit 0.

### Step 2: Add symlink tests

In `packages/cli/src/__tests__/path-resolver.test.ts`, add tests (use `fs.symlinkSync`; skip gracefully on platforms where symlink creation is not permitted):

1. **Symlink escape is rejected**: create `projectRoot`, create an outside dir with a file, create a symlink `projectRoot/escape` → outside dir. Assert `resolveProjectFilePath("escape/secret.txt", projectRoot)` and `isProjectFilePathSafe("escape/secret.txt", projectRoot)` are `null`/`false`.
2. **Symlink staying inside is allowed**: create `projectRoot/real/Button.tsx` and a symlink `projectRoot/link` → `projectRoot/real`. Assert `resolveProjectFilePath("link/Button.tsx", projectRoot)` is non-null.
3. **Regression**: the existing tests (relative, leading-slash, absolute-inside, `../` rejection, absolute-outside rejection) still pass — run the whole file.

**Verify**: `pnpm --filter themelab-cli exec vitest run` → all pass, including the new symlink tests AND all pre-existing path-resolver tests (especially on macOS, confirm the `/var`→`/private/var` symlink did not break the in-root tests — this is why Step 1 canonicalizes the root too).

## Test plan

- New tests in `packages/cli/src/__tests__/path-resolver.test.ts`: symlink-escape rejected, symlink-inside allowed.
- Structural pattern: the existing tests in the same file (`makeProject()` + `afterEach` cleanup).
- Verification: `pnpm --filter themelab-cli exec vitest run` → all pass.

## Done criteria

ALL must hold:

- [ ] `pnpm typecheck` exits 0
- [ ] `pnpm --filter themelab-cli exec vitest run` exits 0; new symlink-escape and symlink-inside tests pass; all pre-existing path-resolver tests still pass
- [ ] `resolveProjectFilePath` / `isProjectFilePathSafe` keep their existing signatures
- [ ] No files outside the in-scope list are modified (`git status`)
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back if:

- Adding realpath causes pre-existing tests to fail and you cannot resolve it by canonicalizing the root as well (do not delete or weaken the existing assertions to make them pass).
- `path-resolver.ts` no longer matches the "Current state" excerpt.
- You discover legitimate project setups that rely on a symlink pointing outside the root (e.g. a monorepo layout where the dev server's source genuinely lives outside `cwd`). If so, report it — silently blocking those would be a regression, and the operator may want an allowlist/flag instead.

## Maintenance notes

- pnpm workspaces use symlinks heavily under `node_modules`, but those are never write targets here (the resolver only ever resolves source files the overlay points at). Still, a reviewer should sanity-check that a normal pnpm project's writable source files (under `src/`, `app/`, etc.) still resolve.
- If file *creation* (new files) is ever added to the write paths, revisit `canonicalize`'s "nothing exists" branch.
- This is defense-in-depth: the primary protection against remote abuse is the loopback bind + Origin check (plan 001). This plan addresses the local-untrusted-repo vector.
