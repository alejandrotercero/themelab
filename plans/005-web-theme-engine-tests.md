# Plan 005: Add a test runner + characterization tests for the web theme engine

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving on. If
> anything in "STOP conditions" occurs, stop and report. When done, update the
> status row for this plan in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat 515682b..HEAD -- apps/web/lib/theme-engine`
> If any theme-engine file changed since this plan was written, compare the
> "Current state" excerpts against the live code; on a mismatch, re-derive the
> expected values from the live code before asserting them.

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: LOW
- **Depends on**: none (pairs with plan 004 for the CI wiring)
- **Category**: tests
- **Planned at**: commit `515682b`, 2026-06-17

## Why this matters

`apps/web` is the theme studio (`/100r` and `/create`). Its entire reason to exist is the **pure color math** in `apps/web/lib/theme-engine/` — OKLCH conversion/interpolation, Tailwind-scale generation, the HR→shadcn luminance gate, and theme synthesis. There is **zero test coverage** anywhere under `apps/web`, and no test runner is even configured. A rounding change, a flipped token mapping, or a broken interpolation would ship silently. These functions are pure, deterministic, and trivial to characterize. This plan stands up `vitest` in the web package and adds characterization tests for the most load-bearing, stable functions (`oklch.ts`, `scale.ts`, `validate.ts`), plus a light smoke test for `transpile.ts`.

## Current state

The engine is pure TS (no React). Functions to cover, with their real signatures/behavior (verified at `515682b` — re-confirm against live code per the drift check):

- `apps/web/lib/theme-engine/oklch.ts`
  - `toOklch(input: string): Oklch | null` — parse any CSS color to `{mode:"oklch", l, c, h}`, or `null` if unparseable.
  - `lStar(input: string): number` — OKLCH L × 100, rounded to 1 dp; `0` for unparseable.
  - `oklchCss(o: Oklch): string` — `oklch(L C H)`, 3-dp precision, **hue forced to 0 when chroma < 0.0005**; clamps L to [0,1], c to ≥0.
  - `lerpOklch(a, b, t): Oklch` — linear interp; **hue takes the shortest path** (wraps across 0/360); `t` clamped to [0,1].
  - `sampleRamp(anchors: Oklch[], targetL01: number): Oklch` — empty anchors → `{l: targetL01, c:0, h:0}`; in-range → lerp between bracketing anchors then pin exact L; out-of-range → extrapolate L off nearest anchor; **chroma damped to 0 at the extremes** (L>0.92 or L<0.08 scales chroma toward 0 at L=1/L=0).
  - `hslTriple(value: string): string` — `"H S% L%"` (no wrapper), `"0 0% 0%"` for unparseable.
  - `reformat(value, format): string` — re-serialize into `"oklch"|"hsl"|"rgb"|"hex"`.

- `apps/web/lib/theme-engine/scale.ts`
  - `TAILWIND_STOPS` = `[50,100,200,300,400,500,600,700,800,900,950]` (length 11).
  - `STOP_LIGHTNESS` = `[0.971,0.936,0.885,0.808,0.704,0.637,0.577,0.505,0.444,0.396,0.262]`.
  - `buildScale(anchor: string, opts?: {neutral?: boolean}): Scale` — returns 11 `{stop, value}` where `value` is an `oklch(...)` string at `STOP_LIGHTNESS[i]`. Neutral clamps the anchor chroma to ≤0.02; chromatic uses ≥0.04. Hue is preserved from the anchor.
  - `scalesToThemeStyles(primary, neutral): ThemeStyles` — maps stops onto the 31 shadcn tokens. Known anchors to assert: `light.primary === primary[600].value`, `dark.primary === primary[500].value`, `light.background === neutral[50].value`, `dark.background === neutral[950].value`, `light.destructive === "oklch(0.577 0.245 27.325)"`, `dark.destructive === "oklch(0.704 0.191 22.216)"`.
  - `scaleToCss(scales, format?)` — emits a `@theme { --color-<name>-<stop>: <value>; }` block.

- `apps/web/lib/theme-engine/validate.ts`
  - `analyze(theme: HrTheme): LuminanceReport` — `MIN_UNIQUE_LEVELS = 5`, `MIN_RANGE = 70`. Verdict: `"pass"` when `uniqueCount >= 5 && range >= 70`; `"partial"` when `uniqueCount >= 3`; else `"fail"`. `nativeMode` is `"dark"` when `bg < fHigh` (background slot lighter-than check), else `"light"`. `score = round((min(unique,8)/8 * 0.6 + min(range,100)/100 * 0.4) * 100)`.
  - `HrTheme` type: `apps/web/lib/theme-engine/types.ts:29` — `{ slots: Partial<Record<HrSlot, string>>; ... }` where `HrSlot` are the 9 Hundred Rabbits slot ids (`types.ts:4`). Use **real fixtures** from `apps/web/lib/theme-engine/presets.ts` (`PRESETS`, `presets.ts:32`) rather than hand-building slot maps — read that file to get a valid `HrTheme` and the slot names (`background`, `f_high`, …).

- `apps/web/lib/theme-engine/transpile.ts` — `hrToThemeStyles`, `paletteToThemeStyles`, `paletteToScales`, `THEME_TOKENS`. For these, a **smoke test** is enough: output contains all expected tokens and every value parses via `toOklch(...)` (i.e., no `null`).

There is **no** `vitest.config.ts` and **no** `test` script under `apps/web`. The other packages use this exact config shape:

```ts
// packages/overlay/vitest.config.ts
import { defineConfig } from "vitest/config";
export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
  },
});
```

`vitest@^3` is already a devDependency in `packages/cli` and `packages/overlay` (so it resolves in the monorepo), but **not** in `apps/web` — add it there.

## Commands you will need

| Purpose          | Command                                           | Expected on success     |
|------------------|---------------------------------------------------|-------------------------|
| Install          | `pnpm install`                                     | exit 0                  |
| Build shared     | `pnpm build:shared`                                | exit 0 (web imports `@themelab/shared`) |
| Web tests        | `pnpm --filter @themelab/web exec vitest run`     | all pass                |
| Web typecheck    | `pnpm --filter @themelab/web typecheck`           | exit 0                  |

## Scope

**In scope**:
- `apps/web/package.json` — add `vitest` devDependency and a `test` script.
- `apps/web/vitest.config.ts` — new file (mirror the overlay's).
- New test files under `apps/web/lib/theme-engine/__tests__/`:
  - `oklch.test.ts`, `scale.test.ts`, `validate.test.ts`, `transpile.test.ts`.

**Out of scope** (do NOT touch):
- Any engine source under `apps/web/lib/theme-engine/**` — these are **characterization** tests: assert the *current* behavior. If a current value looks "wrong," do NOT change source; note it in your report.
- `apps/web/lib/theme-engine/radix/generate-radix-colors.ts` — vendored verbatim (`@ts-nocheck`), do not test or modify.
- React components, routes, `lib/saved-themes.ts` (separate concern).

## Git workflow

- Branch: `advisor/005-web-engine-tests`.
- Conventional commit, e.g. `test(web): add vitest + theme-engine characterization tests`.
- Do NOT push or open a PR unless instructed.

## Steps

### Step 1: Add the test runner to the web package

1. In `apps/web/package.json`, add `"vitest": "^3.0.0"` to `devDependencies` and add a script `"test": "vitest run"`.
2. Create `apps/web/vitest.config.ts` mirroring the overlay config but scoped to the engine:

```ts
import { defineConfig } from "vitest/config";
export default defineConfig({
  test: {
    include: ["lib/theme-engine/**/*.test.ts"],
  },
});
```

3. `pnpm install` to link vitest.

**Verify**: `pnpm --filter @themelab/web exec vitest run` → runs and reports "no test files found" (or passes with 0 tests) without a config error.

### Step 2: Write `oklch.test.ts`

Create `apps/web/lib/theme-engine/__tests__/oklch.test.ts`. Cover, deriving expected numbers by running the function once and pinning the observed value where exact math is fiddly (characterization):
- `toOklch("#000000")` → `l` ≈ 0; `toOklch("not-a-color")` → `null`.
- `lStar("#ffffff")` → 100 (± rounding); `lStar("bad")` → 0.
- `oklchCss({mode:"oklch", l:0.5, c:0, h:200})` → hue rendered as `0` (achromatic rule); confirm 3-dp formatting.
- `lerpOklch` shortest-path hue: interp between hue 350 and hue 10 at `t=0.5` yields a hue near 0/360 (≈0), **not** ≈180. Assert it is within (340..360) ∪ (0..20).
- `sampleRamp([], 0.5)` → `{l:0.5, c:0, h:0}`. `sampleRamp(anchors, 1)` → chroma ≈ 0 (extreme damping), with `anchors` built from `toOklch` of two colors.
- `reformat("#ff0000", "hex")` round-trips to a hex string; `reformat("#ff0000","hsl")` starts with `hsl`.

### Step 3: Write `scale.test.ts`

Create `apps/web/lib/theme-engine/__tests__/scale.test.ts`:
- `buildScale("#3b82f6")` returns 11 stops whose `stop` values equal `TAILWIND_STOPS`, and each `value` matches `/^oklch\(/`.
- A neutral scale (`buildScale(anchor, {neutral:true})`) has lower chroma at stop 500 than the chromatic scale of the same anchor (parse both 500 values via `toOklch` and compare `c`).
- `scalesToThemeStyles(buildScale("#3b82f6"), buildScale("#71717a", {neutral:true}))` produces a `ThemeStyles` whose `light` and `dark` each have all the token keys present in the existing output, and where `light.primary === primary[600].value` and `dark.primary === primary[500].value`, `light.destructive === "oklch(0.577 0.245 27.325)"`.
- `scaleToCss({ brand: buildScale("#3b82f6") })` contains `--color-brand-500:` and opens with `@theme {`.

### Step 4: Write `validate.test.ts`

Create `apps/web/lib/theme-engine/__tests__/validate.test.ts`. Read `presets.ts` first and import a real preset's `HrTheme` (or its `.slots`) as the "pass" fixture:
- A rich preset → `verdict === "pass"`, `uniqueCount >= 5`, `range >= 70`, `score` in 0..100.
- A hand-made sparse theme with only 2 distinct slot colors → `verdict === "fail"`.
- A theme with 3–4 distinct levels but `range < 70` → `verdict === "partial"`.
- `nativeMode`: build a theme where `background` is darker than `f_high` → `"dark"`; the reverse → `"light"`.

(If the preset shape differs from what you expect, adapt the fixture from the actual `presets.ts` contents — do not invent slot names.)

### Step 5: Write `transpile.test.ts` (smoke)

Create `apps/web/lib/theme-engine/__tests__/transpile.test.ts`:
- Call `hrToThemeStyles` with a real preset and assert the result has non-empty `light` and `dark` maps and that **every** value parses (`toOklch(value) !== null`).
- Call `paletteToThemeStyles` / `paletteToScales` (read `transpile.ts` for exact signatures) with a simple primary+neutral and assert the same "all values parse" invariant and that the expected token set is present.

### Step 6: Run the full suite + typecheck

**Verify**:
- `pnpm --filter @themelab/web exec vitest run` → all tests pass.
- `pnpm --filter @themelab/web typecheck` → exit 0 (the new test files must type-check too).

## Test plan

- New files under `apps/web/lib/theme-engine/__tests__/`: `oklch.test.ts`, `scale.test.ts`, `validate.test.ts`, `transpile.test.ts`.
- Structural pattern to follow: `packages/overlay/src/utils/color-format.test.ts` and `packages/overlay/src/__tests__/canvas-math.test.ts` (same vitest `describe`/`it`/`expect` style).
- These are characterization tests — they lock in current behavior so future refactors of the engine are safe.
- Verification: `pnpm --filter @themelab/web exec vitest run` → all pass.

## Done criteria

ALL must hold:

- [ ] `apps/web/vitest.config.ts` exists and scopes to the theme engine
- [ ] `apps/web/package.json` has `vitest` in devDependencies and a `test` script
- [ ] `pnpm --filter @themelab/web exec vitest run` exits 0 with the four new test files all passing
- [ ] `pnpm --filter @themelab/web typecheck` exits 0
- [ ] No engine source under `apps/web/lib/theme-engine/**` was modified (`git status`)
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back if:

- A theme-engine file changed since `515682b` such that the asserted constants (e.g. `STOP_LIGHTNESS`, the destructive reds, the primary 600/500 mapping) no longer match — re-derive from live code, and if the *behavior* looks wrong, report rather than "fixing" source.
- vitest cannot resolve `@themelab/shared` or the relative engine imports even after `pnpm build:shared` + `pnpm install` (a resolver/alias issue) — report the error; the fix may be a `resolve.alias` in `vitest.config.ts`, which is a design decision.
- A characterization assertion you wrote from the spec disagrees with the actual output — trust the actual output (pin it), and flag the discrepancy in your report.

## Maintenance notes

- After this lands, add `pnpm --filter @themelab/web test` to the CI wiring from plan 004 so the studio's tests run on every push.
- These tests pin current numeric output; an intentional change to the color math will require updating them — that is by design (it forces the author to acknowledge the visual change).
- A reviewer should confirm the tests assert *behavior/values*, not just "function returns truthy."
