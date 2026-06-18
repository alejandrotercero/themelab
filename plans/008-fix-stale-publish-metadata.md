# Plan 008: Fix stale "not publishing" claim and incorrect package author

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving on. If
> anything in "STOP conditions" occurs, stop and report. When done, update the
> status row for this plan in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat 515682b..HEAD -- ROADMAP.md packages/cli/package.json`
> If either changed since this plan was written, compare the "Current state"
> excerpts against the live code; on a mismatch, STOP.

## Status

- **Priority**: P3
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: docs
- **Planned at**: commit `515682b`, 2026-06-17

## Why this matters

Two pieces of published-package metadata are now actively wrong, which is worse than missing — they mislead contributors and npm users:

1. `ROADMAP.md` repeatedly states the project is **not** publishing ("this isn't our repo to release"). But `themelab-cli@0.2.0` **is** published to npm, the repo *is* the canonical source (`repository`/`homepage` point at `alejandrotercero/themelab`, and the git history shows the deliberate `ReactRewrite → ThemeLab` rebrand and active changeset releases). A contributor reading the ROADMAP would wrongly conclude work stays local.
2. `packages/cli/package.json` lists `"author": "Dongha Kim"` — leftover from the project's origin. The published npm package therefore attributes authorship to someone who is not the current maintainer.

## Current state

- `ROADMAP.md` — the contradictory claims:

  ```markdown
  // ROADMAP.md (M0 section, ~line 162-163)
  - **Not publishing** — this isn't our repo to release. Work stays local / goes back as a contribution if/when upstream wants it.
  ```

  ```markdown
  // ROADMAP.md (§5 "Decisions", ~line 191-192)
  **Decided:**
  - **No publishing** — not our repo to release (§4 M0).
  ```

  (Confirm exact line numbers with `grep -n "publishing\|No publishing\|not our repo\|not publishing" ROADMAP.md` before editing.)

- `packages/cli/package.json` — the author field and the (correct) repo fields:

  ```json
  // packages/cli/package.json
  "version": "0.2.0",
  "homepage": "https://github.com/alejandrotercero/themelab",
  "repository": {
    "type": "git",
    "url": "git+https://github.com/alejandrotercero/themelab.git",
    "directory": "packages/cli"
  },
  "license": "MIT",
  "author": "Dongha Kim",          // ← line 27, stale
  ```

- The release path is real: root `package.json` has `"release": "pnpm build && changeset publish"` and `.github/workflows/release.yml` uses the changesets action.

## Commands you will need

| Purpose          | Command                                              | Expected on success |
|------------------|-----------------------------------------------------|---------------------|
| Find ROADMAP refs| `grep -n "publishing\|not our repo" ROADMAP.md`     | shows the lines     |
| Git identity     | `git config user.name; git config user.email`       | prints the maintainer |
| Validate JSON    | `node -e "require('./packages/cli/package.json')"`  | exit 0 (valid JSON) |

## Scope

**In scope**:
- `ROADMAP.md` — correct both "not publishing" statements.
- `packages/cli/package.json` — fix the `author` field.

**Out of scope** (do NOT touch):
- `repository`, `homepage`, `license`, `version` — already correct.
- The npm registry itself / any actual publish — this plan only fixes the metadata in the repo.
- README.md (its install/publish instructions are already consistent with publishing).

## Git workflow

- Branch: `advisor/008-publish-metadata`.
- Conventional commit, e.g. `docs: correct stale "not publishing" claim and package author`.
- Do NOT push or open a PR unless instructed.

## Steps

### Step 1: Correct the ROADMAP publishing statements

Replace both "not publishing" statements with the accurate current state. Suggested replacements (keep the surrounding bullet structure):

- M0 bullet → something like:
  > - **Publishing**: `packages/cli` is published to npm as `themelab-cli` via changesets (`pnpm release`). This is the canonical source repo.
- §5 "Decided" bullet → something like:
  > - **Publishing** — `themelab-cli` ships from this repo (changesets); this is the source of record.

Do not invent new roadmap scope — just make the two statements factual.

**Verify**: `grep -n "Not publishing\|No publishing\|not our repo to release" ROADMAP.md` → **no matches** remain.

### Step 2: Fix the package author

Determine the current maintainer from git identity:

```
git config user.name
git config user.email
```

Set `packages/cli/package.json` `author` to the current maintainer (e.g. `"<git user.name> <<git user.email>>"`). If you want to preserve original-author credit, you may additionally add a `"contributors": ["Dongha Kim"]` array — but only the `author` change is required.

**Verify**: `node -e "console.log(require('./packages/cli/package.json').author)"` → prints the current maintainer, not "Dongha Kim". `node -e "require('./packages/cli/package.json')"` → exit 0 (still valid JSON).

## Test plan

- No automated tests (docs/metadata only).
- Verification: the greps and the JSON-validity check in the Done criteria.

## Done criteria

ALL must hold:

- [ ] `grep -n "Not publishing\|No publishing\|not our repo to release" ROADMAP.md` returns no matches
- [ ] `packages/cli/package.json` `author` is the current maintainer (not "Dongha Kim") and the file is valid JSON
- [ ] `repository`, `homepage`, `version`, `license` are unchanged
- [ ] No files outside the in-scope list are modified (`git status`)
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back if:

- `git config user.name`/`user.email` are empty or clearly not the maintainer — report and let the operator supply the intended author string rather than guessing.
- The operator's intent for crediting "Dongha Kim" is unclear (e.g., they were a substantial original author) — make the ROADMAP fix and report the author question rather than guessing.
- The ROADMAP text no longer matches the "Current state" excerpts.

## Maintenance notes

- Keep `repository.url`, `homepage`, and `author` consistent with the actual owner if the repo ever moves.
- This is the kind of drift that recurs after a rebrand; a reviewer of any future rename should check `package.json` author/repository fields and the ROADMAP together.
