# Plan 011: Fail loud on unresolvable cn()/clsx() args instead of silent class loss

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving on. If a
> STOP condition occurs, stop and report. When done, update the status row in
> `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat c590dac..HEAD -- packages/cli/src/transform.ts`
> If `transform.ts` changed since this plan was written, compare the "Current
> state" excerpts against live code; on a mismatch, STOP.

## Status

- **Priority**: P3
- **Effort**: S
- **Risk**: MED (changes behavior of class edits on dynamic className — from silent to a typed error)
- **Depends on**: plan 009 (its characterization tests document the gaps and must be updated here)
- **Category**: bug
- **Planned at**: commit `c590dac`, 2026-06-18

## Why this matters

The spike in plan 009 confirmed three real silent-loss gaps in `mutateClassName` (`packages/cli/src/transform.ts`). When a `className` is a `cn(...)`/`clsx(...)` call whose args include shapes that `checkConflictingConditional` does not inspect — an **object** (`clsx({ "gap-4": cond })`), an **identifier** (`cn(base, "flex")`), or a **spread** (`cn("flex", ...extra)`) — and the user edits a class, the code falls through to the `firstStr` append fallback. It appends the new class to the first string-literal arg and never errors, even though the edited class may live in (or conflict with) the uninspected arg. Result: a silent duplicate (`gap-4` and `gap-6` both present) or an edit applied to the wrong argument. The fix follows the resolver's established philosophy (ROADMAP §2 #4): **fail loud** with a typed error the overlay already surfaces, rather than guessing.

## Current state

- `packages/cli/src/transform.ts` — `checkConflictingConditional` inspects only `LogicalExpression` and `ConditionalExpression`:

  ```ts
  // packages/cli/src/transform.ts:546-577
  function checkConflictingConditional(args: any[], prefix: string): boolean {
    for (const arg of args) {
      if (arg.type === "LogicalExpression") { /* checks arg.right StringLiteral */ }
      if (arg.type === "ConditionalExpression") { /* checks consequent + alternate */ }
    }
    return false;
  }
  ```

  In `mutateClassName`, the `CallExpression` branch throws `CONFLICTING_CLASS` only when `checkConflictingConditional` returns true, then mutates string-literal args, then falls back to appending to the first string literal:

  ```ts
  // packages/cli/src/transform.ts:665-702 (abridged)
  if (expr.type === "CallExpression") {
    const args = expr.arguments;
    for (const update of updates) {
      if (checkConflictingConditional(args, update.tailwindPrefix)) {
        throw new Error(`CONFLICTING_CLASS: "${update.tailwindPrefix}" appears in a conditional argument`);
      }
      let found = false;
      for (const arg of args) {
        if (arg.type === "StringLiteral") { /* update if prefix matches; found = true */ }
      }
      if (!found) {
        const firstStr = args.find((a: any) => a.type === "StringLiteral");
        if (firstStr) { /* append new class to firstStr — THIS is the silent fallback */ }
      }
    }
    return;
  }
  ```

- The error codes the overlay understands are matched in `server.ts:151` via the regex `^(DYNAMIC_CLASSNAME|FILE_CHANGED|MAPPED_ELEMENT|CONFLICTING_CLASS|AMBIGUOUS)`. **Use one of these existing codes** so the overlay surfaces it — do NOT invent a new code unless you also wire it through `server.ts` and the overlay (out of scope here).

- Plan 009's characterization tests in `packages/cli/src/__tests__/classname-dynamic-cases.test.ts` currently assert the *buggy* behavior (the object-form test asserts both `gap-4` and `gap-6` coexist; the identifier/spread tests assert no throw). These MUST be updated in this plan to assert the new throwing behavior.

## Commands you will need

| Purpose     | Command                                       | Expected |
|-------------|-----------------------------------------------|----------|
| Typecheck   | `pnpm typecheck`                              | exit 0   |
| CLI tests   | `pnpm --filter themelab-cli exec vitest run` | all pass |

## Scope

**In scope**:
- `packages/cli/src/transform.ts` — extend the guard.
- `packages/cli/src/__tests__/classname-dynamic-cases.test.ts` — flip the 3 GAP tests to assert the fix.

**Out of scope**:
- `server.ts` / overlay — do not add new error codes; reuse `CONFLICTING_CLASS` / `DYNAMIC_CLASSNAME`.
- The `LogicalExpression`/`ConditionalExpression`/`StringLiteral`/`TemplateLiteral` paths — they already work; don't change them.
- The `firstStr` append fallback itself when all other args are string literals (the legitimate "append a brand-new class" case must keep working).

## Steps

### Step 1: Make the `CallExpression` branch fail loud on unresolvable args

In `mutateClassName`'s `CallExpression` branch, before the `firstStr` append fallback runs (i.e., when `found` is false), detect whether any arg is a shape we cannot safely reason about — `ObjectExpression`, `Identifier`, `SpreadElement`, `MemberExpression`, or a nested `CallExpression` — and if so, throw a typed error instead of appending. Prefer extending `checkConflictingConditional` to also return true for these arg types when the prefix can't be proven absent, OR add a focused pre-check. The simplest robust rule: **if the prefix isn't found in a string literal AND any arg is a non-(StringLiteral|Logical|Conditional) type, throw `CONFLICTING_CLASS`** (the class may live in the unresolvable arg). Keep the pure-string-literal append path working (when every arg is a StringLiteral and the prefix is genuinely new, append as today).

Target shape:

```ts
if (!found) {
  const hasUnresolvableArg = args.some((a: any) =>
    a.type !== "StringLiteral" && a.type !== "LogicalExpression" && a.type !== "ConditionalExpression"
  );
  if (hasUnresolvableArg) {
    throw new Error(`CONFLICTING_CLASS: "${update.tailwindPrefix}" cannot be safely applied — className uses a dynamic argument (object/identifier/spread)`);
  }
  const firstStr = args.find((a: any) => a.type === "StringLiteral");
  if (firstStr) { /* unchanged append */ }
}
```

**Verify**: `pnpm typecheck` → exit 0.

### Step 2: Update the 009 characterization tests to assert the fix

In `packages/cli/src/__tests__/classname-dynamic-cases.test.ts`, change the three GAP tests:
- **object form** (`clsx({ "gap-4": cond })`): was asserting the silent duplicate — change to `expect(() => updateClassName(...)).toThrow(/CONFLICTING_CLASS/)`.
- **identifier arg** (`cn(base, "flex")`): was asserting no-throw — change to assert it throws `CONFLICTING_CLASS`.
- **spread** (`cn("flex", ...extra)`): same — assert it throws `CONFLICTING_CLASS`.
- Leave the SAFE and GUARDED tests (string literal, template literal, ternary, logical-AND, pure cn()) unchanged — they must still pass.

**Verify**: `pnpm --filter themelab-cli exec vitest run` → all pass (the 3 flipped tests now assert throws; everything else green).

### Step 3: Confirm no regression in the legitimate append path

Confirm the existing `update-classname.test.ts` cases (which include `cn(...)` with string literals and a brand-new-class append) still pass — the guard must not break adding a genuinely new class to an all-string-literal `cn()`.

**Verify**: `pnpm --filter themelab-cli exec vitest run` → all pass, including `update-classname.test.ts`.

## Done criteria

ALL must hold:
- [ ] `pnpm typecheck` exits 0
- [ ] `pnpm --filter themelab-cli exec vitest run` exits 0
- [ ] Editing a class on object/identifier/spread `cn()`/`clsx()` args throws `CONFLICTING_CLASS` (asserted by the updated 009 tests)
- [ ] Adding a new class to an all-string-literal `cn()` still works (no false-positive throw)
- [ ] `transform.ts` change is confined to the `CallExpression` branch / `checkConflictingConditional`
- [ ] No files outside the in-scope list modified
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report if:
- The guard causes existing `update-classname.test.ts` cases to fail (it's catching a legitimate append — the rule is too broad; report the failing case).
- Throwing `CONFLICTING_CLASS` here is not surfaced acceptably by the overlay (check `server.ts:149-155` `extractErrorCode` — it should map it).
- `transform.ts` no longer matches the "Current state" excerpts.

## Maintenance notes

- This makes dynamic-arg class edits fail loud; the user-facing effect is an error message instead of a silently wrong edit. If product later wants these handled (e.g., the AI locator resolving which arg owns the class), that's a larger feature, not this fix.
- A reviewer should confirm the guard didn't over-broaden: an all-string-literal `cn("a", "b")` adding a new prefix must still append, not throw.
