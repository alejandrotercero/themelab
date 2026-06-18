# Plan 010: Clean up the web app's eslint errors and turn on the lint gate

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving on. If
> anything in "STOP conditions" occurs, stop and report. When done, update the
> status row for this plan in `plans/README.md`.
>
> **Drift check (run first)**: `pnpm install && pnpm --filter @themelab/web exec eslint . --format compact`
> Note the current error count and rules before changing anything; this plan is
> written against the 31-error baseline below.

## Status

- **Priority**: P3
- **Effort**: M
- **Risk**: MED (some flagged code is an intentional, documented patch — wrong "fixes" can reintroduce a bug)
- **Depends on**: plan 004 (this extends 004's `check:web` wiring to include lint)
- **Category**: dx
- **Planned at**: commit `515682b` + advisor plans, 2026-06-18

## Why this matters

`apps/web` is the user-facing studio, but its lint never runs in CI. Plan 004 wired the web **typecheck** into CI and deferred lint to here because the web app currently has **31 eslint errors**. Until they're resolved, a lint gate can't be enforced. This plan fixes (or justifiably suppresses) the errors and then turns the gate on, so future lint regressions in the studio are caught.

## Current state

Baseline at the time of writing (`pnpm --filter @themelab/web lint`): **31 errors, 14 warnings, 0 auto-fixable, across 7 files**. Error breakdown by rule:

- `react-hooks/refs` — **21** (errors). Reads/writes of refs in render-phase or compiler-unsafe positions.
- `react-hooks/set-state-in-effect` — **6** (errors). `setState` called inside `useEffect`.
- `react/no-unescaped-entities` — **4** (errors). Literal `'`/`"`/`>` in JSX text.

Warnings (do NOT block lint, leave for later unless trivial): `@typescript-eslint/no-unused-vars` ×10, `@next/next/no-img-element` ×4.

**Critical caution — intentional patches:** `apps/web/CLAUDE.md` documents that the **kibo color picker** (`apps/web/components/kibo-ui/color-picker/index.tsx`) deliberately uses a **mount effect that calls setState** and a controlled-value workaround ("we seed `defaultValue` + a mount effect"). Some of the `set-state-in-effect` and `refs` errors are almost certainly that intentional code. Do **not** refactor those to "fix" the lint — that risks reintroducing the exact bug the patch works around. For documented-intentional cases, use a **scoped `// eslint-disable-next-line <rule> -- <reason>`** with a comment pointing at `apps/web/CLAUDE.md`.

To find which files/lines: `pnpm --filter @themelab/web exec eslint . --format compact` lists `file:line:col rule`.

## Commands you will need

| Purpose          | Command                                                       | Expected on success |
|------------------|--------------------------------------------------------------|---------------------|
| Install          | `pnpm install`                                                | exit 0              |
| List lint issues | `pnpm --filter @themelab/web exec eslint . --format compact` | the file:line:rule list |
| Web lint         | `pnpm --filter @themelab/web lint`                           | exit 0 (goal)       |
| Web typecheck    | `pnpm --filter @themelab/web typecheck`                      | exit 0 (must stay)  |
| Web tests        | `pnpm --filter @themelab/web exec vitest run`               | all pass (if plan 005 landed) |

## Scope

**In scope**:
- `apps/web/**` source files that carry the eslint **errors** (the 7 files).
- Root `package.json` — extend `check:web` to include lint (final step).

**Out of scope** (do NOT touch):
- The 14 **warnings** (`no-unused-vars`, `no-img-element`) — leave them; this plan only clears errors that block the gate. (You may remove an unused var if it's a one-line obvious deletion, but don't go hunting.)
- `apps/web/lib/theme-engine/radix/generate-radix-colors.ts` — vendored.
- Behavior changes beyond what a lint fix strictly requires.

## Git workflow

- Branch: `advisor/010-web-lint`.
- Conventional commit, e.g. `style(web): resolve eslint errors and enable web lint gate`.
- Do NOT push or open a PR unless instructed.

## Steps

### Step 1: Fix `react/no-unescaped-entities` (4) — safe, do first

For each flagged location, replace the bare entity in JSX text with its escaped form (`'`→`&apos;` or use a curly string `{"don't"}`; `"`→`&quot;`). These are presentational-only and safe.

**Verify**: `pnpm --filter @themelab/web exec eslint . --format compact | grep -c no-unescaped-entities` → `0`.

### Step 2: Resolve `react-hooks/set-state-in-effect` (6)

For each location, decide:
- **Documented-intentional (kibo color picker mount effect)** → add `// eslint-disable-next-line react-hooks/set-state-in-effect -- intentional controlled-value sync, see apps/web/CLAUDE.md`. Do not refactor.
- **Genuinely avoidable** (e.g. state that could be derived during render, or initialized via `useState` initializer) → make the minimal safe refactor. If unsure whether a refactor changes behavior, prefer the justified disable over a risky rewrite.

**Verify**: `pnpm --filter @themelab/web exec eslint . --format compact | grep -c set-state-in-effect` → `0`. `pnpm --filter @themelab/web typecheck` → exit 0.

### Step 3: Resolve `react-hooks/refs` (21)

Read each flagged site. Common safe resolutions: move a ref read out of render into an effect/event handler; or, for the documented kibo picker, a justified `// eslint-disable-next-line react-hooks/refs -- <reason, see CLAUDE.md>`. **Prefer disables-with-justification for the vendored kibo component; prefer real fixes elsewhere.** Do not change runtime behavior to satisfy the linter.

**Verify**: `pnpm --filter @themelab/web exec eslint . --format compact | grep -c "react-hooks/refs"` → `0`.

### Step 4: Confirm the web app still type-checks and (if present) tests pass

**Verify**:
- `pnpm --filter @themelab/web typecheck` → exit 0.
- `pnpm --filter @themelab/web lint` → exit 0 (errors cleared; warnings may remain and are allowed).
- If plan 005 has landed: `pnpm --filter @themelab/web exec vitest run` → all pass.

### Step 5: Turn the lint gate on

In root `package.json`, extend the `check:web` script (added by plan 004) to include lint:

```json
"lint:web": "pnpm --filter @themelab/web lint",
"check:web": "pnpm typecheck:web && pnpm lint:web"
```

**Verify**: `pnpm check:web` → exit 0 (runs both typecheck and lint, both green).

## Test plan

- No new unit tests (this is lint/quality work). The verification is `pnpm --filter @themelab/web lint` exiting 0 with no behavior change.
- Manual smoke (document the result): the kibo color picker still renders and selecting a color still works — confirm the documented-intentional patches were not altered.

## Done criteria

ALL must hold:

- [ ] `pnpm --filter @themelab/web lint` exits 0 (0 errors; warnings allowed)
- [ ] `pnpm --filter @themelab/web typecheck` exits 0
- [ ] Root `check:web` runs both typecheck and lint and exits 0
- [ ] Any `eslint-disable` added is scoped to one line and carries a `-- <reason>` comment
- [ ] No behavior change beyond lint compliance (intentional kibo patches preserved)
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back if:

- Clearing an error requires a refactor you cannot prove is behavior-preserving (especially in the kibo color picker) — use a justified disable, or stop and report which one needs a human call.
- The error count is materially different from the 31-error baseline (the code changed) — re-survey before proceeding.
- Fixing lint breaks `typecheck` or any existing test.

## Maintenance notes

- After this, lint runs in CI via plan 004's wiring on every push; new lint errors will block CI.
- The remaining warnings (`no-img-element`, `no-unused-vars`) are a reasonable next cleanup but were intentionally left out of scope to keep this change reviewable.
- If the kibo picker is ever de-vendored or rewritten, revisit its eslint-disable comments.
