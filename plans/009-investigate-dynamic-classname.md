# Plan 009: Investigate whether class edits silently drop dynamic `className` parts

> **Executor instructions**: This is an INVESTIGATION (spike), not a fix. Your
> deliverable is (a) a set of characterization tests that document the *current*
> behavior for each `className` shape, and (b) a short written report of any case
> where a class is silently lost or a conditional is clobbered, with a
> recommendation. **Do not change `transform.ts` behavior.** Run every
> verification command. If anything in "STOP conditions" occurs, stop and report.
> When done, update the status row for this plan in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat 515682b..HEAD -- packages/cli/src/transform.ts`
> If `transform.ts` changed since this plan was written, compare the "Current
> state" excerpts against the live code before reasoning about behavior.

## Status

- **Priority**: P3
- **Effort**: M (timebox the investigation; see Step 5)
- **Risk**: LOW (tests only; no behavior change)
- **Depends on**: none
- **Category**: bug (investigate)
- **Planned at**: commit `515682b`, 2026-06-17

## Why this matters

When the user edits a Tailwind class, the change is applied by `mutateClassName` in `transform.ts`. For `className` values that are dynamic expressions — template literals with interpolations, or `cn(...)`/`clsx(...)` calls mixing string literals with conditionals/variables — there is a risk that editing one class silently discards a conditional branch or a dynamic part (e.g. `cn("flex", isMobile ? "gap-2" : "gap-4")` losing the conditional). The code already has *some* guards (`checkConflictingConditional` throws `CONFLICTING_CLASS`; a fully dynamic expression throws `DYNAMIC_CLASSNAME`), so the obvious case may already be handled. This spike determines, with tests, whether any real silent-loss gap remains — and only then is a fix scoped. We are NOT assuming a bug exists; we are characterizing reality.

## Current state

`mutateClassName` handles four `className` value shapes (`packages/cli/src/transform.ts:584-710`):

1. **No `className`** → appends a new one (lines 595-604).
2. **String literal** → `updateClassString` (lines 609-612).
3. **`JSXExpressionContainer` → `TemplateLiteral`** → updates matching quasis, else appends to the last quasi; interpolations live in `expr.expressions` and are not mutated (lines 617-663).
4. **`JSXExpressionContainer` → `CallExpression`** (`cn`/`clsx`) → for each update, **throws `CONFLICTING_CLASS`** if `checkConflictingConditional` matches, otherwise mutates only `StringLiteral` args; if no literal matches, appends to the first string literal (lines 665-702).
5. Any other expression → **throws `DYNAMIC_CLASSNAME`** (lines 704-706).

Key conditional guard (read it in full):

```ts
// packages/cli/src/transform.ts:665-673
    if (expr.type === "CallExpression") {
      const args = expr.arguments;
      for (const update of updates) {
        if (checkConflictingConditional(args, update.tailwindPrefix)) {
          throw new Error(
            `CONFLICTING_CLASS: "${update.tailwindPrefix}" appears in a conditional argument`
          );
        }
        // ... mutates only StringLiteral args ...
```

**The crux of the investigation**: does `checkConflictingConditional` cover *all* conditional forms — ternary `a ? "x" : "y"`, logical `cond && "x"`, nested objects `clsx({ "x": cond })`, spreads `cn(...arr)`, and identifier args referencing class strings (`cn(base, sizeClass)`)? Find its definition (`grep -n "function checkConflictingConditional" packages/cli/src/transform.ts`) and read it. A gap there is where silent loss could hide. The relevant test fixtures already exist: `packages/cli/src/__tests__/fixtures/classname-*.tsx` (e.g. `classname-cn.tsx`, `classname-template.tsx`, `classname-dynamic.tsx`, `classname-variants.tsx`, `classname-pattern.tsx`). There are existing className tests in `packages/cli/src/__tests__/update-classname.test.ts` (455 lines) — read it to see what's already covered and avoid duplicating.

## Commands you will need

| Purpose            | Command                                              | Expected on success |
|--------------------|-----------------------------------------------------|---------------------|
| Find the guard     | `grep -n "checkConflictingConditional" packages/cli/src/transform.ts` | shows def + call |
| List fixtures      | `ls packages/cli/src/__tests__/fixtures/classname-*` | the className fixtures |
| Existing coverage  | `grep -n "describe\|it(" packages/cli/src/__tests__/update-classname.test.ts` | current cases |
| Typecheck          | `pnpm typecheck`                                     | exit 0              |
| CLI tests          | `pnpm --filter themelab-cli exec vitest run`         | all pass            |

## Scope

**In scope**:
- `packages/cli/src/__tests__/` — add a new characterization test file (e.g. `classname-dynamic-cases.test.ts`) and, if needed, new fixtures under `__tests__/fixtures/`.
- Your written report (in the completion message and `plans/README.md` notes).

**Out of scope** (do NOT modify in this plan):
- `packages/cli/src/transform.ts` — no behavior change. If you find a gap, document it and recommend a follow-up fix plan; do not implement it here.
- Any non-className transform logic.

## Git workflow

- Branch: `advisor/009-investigate-classname`.
- Conventional commit, e.g. `test(cli): characterize dynamic className edit behavior`.
- Do NOT push or open a PR unless instructed.

## Steps

### Step 1: Read the guard and map the shapes

Read `checkConflictingConditional` and `mutateClassName` fully. Enumerate every `className` shape and, for each, predict from the code what happens when a user edits (a) a class that is present as a static literal, and (b) a class governed by a dynamic/conditional part. Write this prediction down.

### Step 2: Write characterization tests for each shape

Add tests (model them on `update-classname.test.ts`) that run `updateClassName` against fixtures covering at least:
- string literal (baseline),
- template literal with an interpolation, editing a class in a static quasi,
- template literal, editing a class that only appears via an interpolation (expect: append to tail, interpolation preserved),
- `cn("flex", "gap-4")` editing `gap` (expect: literal updated, no loss),
- `cn("flex", isMobile ? "gap-2" : "gap-4")` editing `gap` (expect: `CONFLICTING_CLASS` thrown — confirm),
- `cn("flex", cond && "gap-4")` editing `gap` (**the key case — does the logical-`&&` form also throw, or is it silently ignored / lost?**),
- `cn(base, "flex")` where `base` is an identifier, editing a class in `base` (expect: cannot resolve → what happens?),
- `clsx({ "gap-4": cond })` object form, editing `gap` (what happens?).

Assert the **actual** observed behavior. Where the behavior is "throws", assert the error code. Where it's "appends", assert the resulting source string. **Do not assert what you think is correct — assert what the code does.** Each test that reveals a silent loss (a class disappears with no error and no replacement) is the finding.

### Step 3: Confirm the existing suite still passes

**Verify**: `pnpm --filter themelab-cli exec vitest run` → all pass (your new tests + the existing ones). `pnpm typecheck` → exit 0.

### Step 4: Write the findings report

In your completion message, for each shape state: *safe* (edits cleanly), *guarded* (throws a typed error the UI surfaces), or *GAP* (silently loses a class or clobbers a conditional). For any GAP, give the minimal repro (fixture + edit), the line in `transform.ts` responsible, and a one-paragraph recommendation for a follow-up fix plan (e.g. "extend `checkConflictingConditional` to also detect `LogicalExpression`"). If there are **no** gaps, say so plainly — "guards cover all tested shapes" is a valid and valuable outcome.

### Step 5: Timebox

Spend at most a focused session on this. If the shape space is larger than the fixtures allow you to characterize confidently, document what you covered and what remains, rather than padding.

## Test plan

- New characterization test file under `packages/cli/src/__tests__/` plus any needed fixtures.
- Structural pattern: `packages/cli/src/__tests__/update-classname.test.ts`.
- These tests lock in current behavior; if a follow-up fix changes behavior, it must update them deliberately.
- Verification: `pnpm --filter themelab-cli exec vitest run` → all pass.

## Done criteria

ALL must hold:

- [ ] A new characterization test file exists covering the shapes in Step 2 and passes
- [ ] `pnpm typecheck` exits 0 and `pnpm --filter themelab-cli exec vitest run` exits 0
- [ ] `transform.ts` is unchanged (`git diff --stat` shows no change to it)
- [ ] A written findings report classifies each shape as safe / guarded / GAP, with repros for any GAP
- [ ] `plans/README.md` status row updated with the verdict (and a pointer to a follow-up plan if a GAP was found)

## STOP conditions

Stop and report back if:

- You find a clear silent-loss GAP and are tempted to fix `transform.ts` — stop and write it up instead; the fix is a separate, reviewed plan.
- The existing className tests fail before you change anything (pre-existing breakage — report it).
- `transform.ts` no longer matches the "Current state" excerpts.

## Maintenance notes

- `className` edits are core to the product; this characterization suite is worth keeping as a regression net regardless of whether a gap is found.
- If a GAP is found, the natural follow-up is to make the dynamic case **fail loudly** (a typed error the overlay already knows how to show, like `DYNAMIC_CLASSNAME`/`CONFLICTING_CLASS`) rather than attempt a clever rewrite — failing loud matches the resolver's documented philosophy (see ROADMAP §2 #4).
