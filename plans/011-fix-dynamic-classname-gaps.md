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

The spike in plan 009 confirmed three silent-loss situations in `mutateClassName` (`packages/cli/src/transform.ts`) involving `cn(...)`/`clsx(...)` args that `checkConflictingConditional` does not inspect. But the three are NOT equivalent, and the right fix differs:

- **Object form** (`clsx({ "gap-4": cond })`) — the conflict is **statically detectable**: the object's keys ARE the class names. Editing `gap` here silently duplicates (`gap-4` in the object + `gap-6` appended). This we can and should catch precisely.
- **Identifier** (`cn(base, "flex")`) and **spread** (`cn("flex", ...extra)`) — these are **opaque**: we cannot see what classes they contribute at build time.

**Critical constraint:** `cn("<base classes>", className)` — a static literal plus a `className` prop passthrough — is the single most common shadcn component pattern. Adding a brand-new class to such an element by appending it to the literal (`cn("flex p-4", className)`) is correct and is exactly what the user wants. The pre-existing code did this correctly. Therefore the fix must **NOT** blanket-reject every opaque arg — doing so would break class edits on a huge fraction of real shadcn components (a far worse regression than the rare duplicate it would prevent).

So this plan: **precisely catches the detectable object-key conflict** (fail loud with `CONFLICTING_CLASS`, per ROADMAP §2 #4's fail-loud philosophy), and **leaves the opaque identifier/spread append path as-is** (accepted residual — appending a new static class is the correct common operation, and the rare "edited class actually lived in the opaque arg" case is fundamentally undetectable statically).

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

### Step 1: Extend `checkConflictingConditional` to inspect object-expression keys

Do NOT add a blanket "any unresolvable arg" throw. Instead, extend the EXISTING `checkConflictingConditional` (`packages/cli/src/transform.ts:546-577`) to also handle `ObjectExpression` args — mirroring how it already handles `LogicalExpression`/`ConditionalExpression`. For each object property, read the key's class string and, if any class matches the prefix, return `true` (which makes the existing `if (checkConflictingConditional(...)) throw CONFLICTING_CLASS` at the top of the update loop fire).

Object key AST shapes (jscodeshift tsx parser): a quoted key `"gap-4"` is a `StringLiteral` with `.value`; an unquoted key `flex` is an `Identifier` with `.name`. Skip computed keys and spread/rest properties (can't statically read them — leave them to the append path).

Target shape (added inside the existing `for (const arg of args)` loop in `checkConflictingConditional`):

```ts
// ObjectExpression: `clsx({ "gap-4": cond })` — keys are the class names
if (arg.type === "ObjectExpression") {
  for (const prop of arg.properties ?? []) {
    if (prop.computed) continue;
    const key = prop.key;
    const keyStr =
      key?.type === "StringLiteral" ? key.value :
      key?.type === "Identifier" ? key.name : null;
    if (keyStr && keyStr.split(/\s+/).some((c: string) => classMatchesPrefix(c, prefix))) {
      return true;
    }
  }
}
```

Do NOT change the `firstStr` append fallback — identifier/spread args must keep appending (the common `cn(base, className)` pattern).

**Verify**: `pnpm typecheck` → exit 0.

### Step 2: Update the 009 characterization tests to match the precise fix

In `packages/cli/src/__tests__/classname-dynamic-cases.test.ts`:
- **object form, editing a class whose key matches** (`clsx("flex", { "gap-4": cond })` editing `gap`): change from asserting the silent duplicate to `expect(() => updateClassName(...)).toThrow(/CONFLICTING_CLASS/)`.
- **object form, ADDING a class whose key does NOT match** (e.g. `clsx("flex", { "hidden": cond })` adding `p-4`): assert it does NOT throw and the new class is appended to the literal. (Add this case if a suitable fixture exists, or reuse the object fixture editing a non-conflicting prefix.)
- **identifier arg** (`cn(base, "flex")`): change to assert it **does NOT throw** and appends the new class to the `"flex"` literal (this documents the accepted residual — opaque args keep appending). Update the describe/comment from "GAP" to "accepted residual (opaque arg — appends)".
- **spread** (`cn("flex", ...extra)`): same as identifier — assert append, no throw, document as accepted residual.
- Leave the SAFE and GUARDED tests (string literal, template literal, ternary, logical-AND, pure cn()) unchanged.

**Verify**: `pnpm --filter themelab-cli exec vitest run` → all pass.

### Step 3: Add/confirm the regression guard for the common pattern

Add a test (or confirm an existing one) that `cn("flex", className)` (a literal + an identifier `className` prop) **+ adding a new prefix** appends to the literal and does NOT throw — this is the dominant shadcn pattern and must keep working. Also confirm the existing `update-classname.test.ts` cases still pass.

**Verify**: `pnpm --filter themelab-cli exec vitest run` → all pass, including `update-classname.test.ts`.

## Done criteria

ALL must hold:
- [ ] `pnpm typecheck` exits 0
- [ ] `pnpm --filter themelab-cli exec vitest run` exits 0
- [ ] Editing a class whose name matches an **object key** (`clsx({ "gap-4": cond })`) throws `CONFLICTING_CLASS`
- [ ] Adding a class to a `cn()`/`clsx()` with an **identifier or spread** arg (e.g. `cn("flex", className)`) still appends — NO throw (regression guard for the common shadcn pattern)
- [ ] Adding a new class to an all-string-literal `cn()` still works (no false-positive throw)
- [ ] `transform.ts` change is confined to `checkConflictingConditional` (object-key handling only)
- [ ] No files outside the in-scope list modified
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report if:
- The object-key check causes existing `update-classname.test.ts` cases to fail (report the failing case — the rule may be too broad).
- Adding a class to `cn("flex", className)` (identifier arg) throws — that means the change wrongly rejected the common pattern; the object-key handling must NOT affect identifier/spread args.
- `transform.ts` no longer matches the "Current state" excerpts.

## Maintenance notes

- This makes dynamic-arg class edits fail loud; the user-facing effect is an error message instead of a silently wrong edit. If product later wants these handled (e.g., the AI locator resolving which arg owns the class), that's a larger feature, not this fix.
- A reviewer should confirm the guard didn't over-broaden: an all-string-literal `cn("a", "b")` adding a new prefix must still append, not throw.
