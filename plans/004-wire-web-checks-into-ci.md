# Plan 004: Wire the web app's typecheck + lint into root scripts and CI

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving on. If
> anything in "STOP conditions" occurs, stop and report. When done, update the
> status row for this plan in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat 515682b..HEAD -- package.json .github/workflows/ci.yml apps/web`
> If `package.json` or `ci.yml` changed since this plan was written, compare the
> "Current state" excerpts against the live code; on a mismatch, STOP.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: dx
- **Planned at**: commit `515682b`, 2026-06-17

## Why this matters

`apps/web` is the public-facing theme studio (deployed to Vercel), but **nothing in CI or the root scripts type-checks or lints it**. The root `typecheck` script only covers `themelab-cli` and `@themelab/overlay`; CI runs that root script plus the package builds/tests. So the web app can accumulate TypeScript errors or lint violations and CI stays green — a false "the repo is valid" signal on the one package users actually see. The web app already *has* `typecheck` and `lint` scripts; they just aren't invoked. This plan wires them in.

## Current state

- Root `package.json` — `typecheck` deliberately filters to cli + overlay only:

  ```json
  // package.json:22
  "typecheck": "pnpm build:shared && pnpm --filter themelab-cli --filter @themelab/overlay exec tsc --noEmit",
  ```

- `apps/web/package.json` already defines the scripts to call:

  ```json
  // apps/web/package.json:11-12
  "lint": "eslint",
  "typecheck": "tsc --noEmit",
  ```

- `.github/workflows/ci.yml` has a `typecheck` job (runs `pnpm typecheck`) and a `test` job (runs `pnpm install`, `pnpm build`, `pnpm test`, overlay vitest). Neither runs anything web-specific:

  ```yaml
  # .github/workflows/ci.yml:9-27 (typecheck job)
  jobs:
    typecheck:
      runs-on: ubuntu-latest
      steps:
        - uses: actions/checkout@v5
        - uses: pnpm/action-setup@v4
          with:
            version: 10
        - uses: actions/setup-node@v5
          with:
            node-version: 22
            cache: pnpm
        - run: pnpm install --frozen-lockfile
        - name: Typecheck
          run: pnpm typecheck
  ```

## Commands you will need

| Purpose         | Command                               | Expected on success            |
|-----------------|---------------------------------------|--------------------------------|
| Install         | `pnpm install`                        | exit 0                         |
| Web typecheck   | `pnpm --filter @themelab/web typecheck` | exit 0 (see Step 1 caveat)   |
| Web lint        | `pnpm --filter @themelab/web lint`    | exit 0 (see Step 1 caveat)     |

## Scope

**In scope**:
- `package.json` (root) — add a root script that includes the web typecheck/lint.
- `.github/workflows/ci.yml` — add a CI step that runs the web checks.

**Out of scope** (do NOT touch):
- Any file under `apps/web/**` source — if the web app currently has type or lint errors, **do not fix them as part of this plan** (see Step 1 and STOP conditions). This plan only wires the gate; fixing pre-existing failures is separate work.
- The `dev`/`build`/`format` scripts.

## Git workflow

- Branch: `advisor/004-web-ci`.
- Conventional commit, e.g. `ci(web): run web typecheck + lint in CI`.
- Do NOT push or open a PR unless instructed.

## Steps

### Step 1: Establish the current web baseline (read-only)

Before wiring anything, find out whether the web app already passes its own checks:

```
pnpm install
pnpm --filter @themelab/web typecheck
pnpm --filter @themelab/web lint
```

- If **both pass** (exit 0): proceed to Step 2 — the gate can be added cleanly.
- If **either fails**: STOP and report the failures. Do not fix web source in this plan, and do not add a gate that will immediately turn CI red. The operator decides whether to fix the web app first or scope this plan differently. (Record the failing output in your report.)

### Step 2: Add a root script for the web checks

In root `package.json`, add a script (do not modify the existing `typecheck`):

```json
"typecheck:web": "pnpm --filter @themelab/web typecheck",
"lint:web": "pnpm --filter @themelab/web lint",
"check:web": "pnpm typecheck:web && pnpm lint:web"
```

**Verify**: `pnpm check:web` → exit 0.

### Step 3: Add a CI step that runs the web checks

In `.github/workflows/ci.yml`, add a step to the existing `typecheck` job (after `pnpm install --frozen-lockfile`), so it runs on the same Node-22 runner:

```yaml
      - name: Typecheck + lint web
        run: pnpm check:web
```

Match the existing indentation and YAML style in the file exactly.

**Verify**: `python3 -c "import yaml,sys; yaml.safe_load(open('.github/workflows/ci.yml'))" && echo OK` → prints `OK` (the workflow is valid YAML). If `yaml`/`python3` is unavailable, instead confirm by eye that the new step is nested under `steps:` at the same level as the other steps.

## Test plan

- No new unit tests. The verification is that the new root script and CI step run the existing web `typecheck`/`lint` and exit 0 on the current tree (Step 1 baseline).
- Verification: `pnpm check:web` → exit 0; CI YAML parses.

## Done criteria

ALL must hold:

- [ ] `pnpm check:web` exists in root `package.json` and exits 0
- [ ] `.github/workflows/ci.yml` contains a step running `pnpm check:web` in the `typecheck` job
- [ ] `ci.yml` is valid YAML
- [ ] The existing root `typecheck` script is unchanged
- [ ] No files under `apps/web/**` source were modified (`git status`)
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back if:

- Step 1 shows the web app already fails its own typecheck or lint (report the output; do not fix source here).
- Root `package.json` or `ci.yml` no longer matches the "Current state" excerpts.

## Maintenance notes

- Once `apps/web` gets tests (plan 005), add a `test:web` to the same `check:web`/CI wiring so the studio's tests run on every push too.
- The web typecheck runs on Node 22 here (matching the existing typecheck job). If the web app ever needs a different Node version, give it its own job rather than weakening this one.
- A reviewer should confirm this plan did **not** smuggle in web source fixes — the gate and the fixes must be separable.
