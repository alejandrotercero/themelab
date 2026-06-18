# Plan 003: Give the `reorder` batch op the same error boundary as its sibling ops

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving on. If
> anything in "STOP conditions" occurs, stop and report. When done, update the
> status row for this plan in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat 515682b..HEAD -- packages/cli/src/batch-transform.ts packages/cli/src/transform.ts`
> If either in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code; on a mismatch, STOP.

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: bug
- **Planned at**: commit `515682b`, 2026-06-17

## Why this matters

In the batch transform engine, every structural op catches exceptions from its mutation and returns an error string so that **one bad op fails just that op**, not the whole batch. The `reorder` op is the exception — it calls `mutateReorder` with no try/catch. `mutateReorder` throws on several ordinary conditions (element not found at a line, elements not siblings). When it throws, the exception escapes the per-op handler and propagates to the batch's outer catch, which marks **every operation in the batch as failed** (see `server.ts:475-489`, where the catch maps all `msg.operations` to failures). So a single un-reorderable element poisons an otherwise-valid multi-edit batch. This is a one-line-shaped fix that makes `reorder` behave like the ops right next to it.

## Current state

- `packages/cli/src/batch-transform.ts` — the op dispatch. `reorder` has no try/catch, unlike the adjacent `reorderArrayItem` and `moveSibling`:

  ```ts
  // packages/cli/src/batch-transform.ts:714-738
      case "reorder": {
        mutateReorder(j, root, op.fromLine, op.toLine);
        return undefined;
      }

      case "reorderArrayItem": {
        try {
          swapArrayElementAt(j, root, op.line, op.col, op.direction);
        } catch (err) {
          return err instanceof Error ? err.message : String(err);
        }
        return undefined;
      }

      case "moveSibling": {
        if (!node) {
          return `Could not resolve element at ${op.line}:${op.col} to move`;
        }
        try {
          swapWithAdjacentSibling(node, op.direction);
        } catch (err) {
          return err instanceof Error ? err.message : String(err);
        }
        return undefined;
      }
  ```

  (Returning `undefined` from this function means "success"; returning a string means "this op failed with this message".)

- `packages/cli/src/transform.ts` — `mutateReorder` throws on normal failure conditions:

  ```ts
  // packages/cli/src/transform.ts:117-118
    if (!fromNode) throw new Error(`Component not found at line ${fromLine}. ...`);
    if (!toNode) throw new Error(`Component not found at line ${toLine}. ...`);
  ```

  ```ts
  // packages/cli/src/transform.ts:146-148
    if (fromIndex === -1 || toIndex === -1 || fromParent.node !== toParent.node) {
      throw new Error("Elements are not siblings in the same parent");
    }
  ```

- `packages/cli/src/__tests__/batch-transform.test.ts` is the test file; it already exercises `executeBatch` with the `five-siblings.tsx` fixture (see the `moveSibling`/reorder happy-path tests around lines 132-178). Its setup helper `useFixture(name)` copies a fixture to a temp file; `findPosition(source, tag)` returns 1-indexed line / 0-indexed col. Import is `import { executeBatch } from "../batch-transform.js";`.

## Commands you will need

| Purpose            | Command                                              | Expected on success |
|--------------------|-----------------------------------------------------|---------------------|
| Install            | `pnpm install`                                       | exit 0              |
| Build shared       | `pnpm build:shared`                                  | exit 0              |
| Typecheck          | `pnpm typecheck`                                     | exit 0, no errors   |
| CLI tests          | `pnpm --filter themelab-cli exec vitest run`         | all pass            |

## Scope

**In scope**:
- `packages/cli/src/batch-transform.ts` — wrap the `reorder` case.
- `packages/cli/src/__tests__/batch-transform.test.ts` — add a regression test.

**Out of scope** (do NOT touch):
- `packages/cli/src/transform.ts` — `mutateReorder` should keep throwing; the boundary belongs in the caller, matching the sibling ops. Do not change its error messages.
- The `server.ts` batch handler — no change needed; once the op returns a string instead of throwing, the existing per-op result path handles it.

## Git workflow

- Branch: `advisor/003-reorder-boundary`.
- Conventional commit, e.g. `fix(cli): catch reorder mutation errors per-op instead of failing the batch`.
- Do NOT push or open a PR unless instructed.

## Steps

### Step 1: Wrap `mutateReorder` in a try/catch

In `packages/cli/src/batch-transform.ts`, change the `reorder` case (lines ~714-717) to mirror `reorderArrayItem`:

```ts
case "reorder": {
  try {
    mutateReorder(j, root, op.fromLine, op.toLine);
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  }
  return undefined;
}
```

**Verify**: `pnpm typecheck` → exit 0.

### Step 2: Add a regression test

In `packages/cli/src/__tests__/batch-transform.test.ts`, add a test that a `reorder` op which cannot succeed returns a failed op result **without throwing**. The simplest trigger is a non-sibling / not-found line. Model it on the existing reorder tests:

- Use `useFixture("five-siblings.tsx")`.
- Build a `reorder` `BatchOperation` whose `fromLine`/`toLine` point at lines that are not reorderable siblings (e.g. `fromLine: 1, toLine: 9999`, or two elements known not to be siblings in the fixture).
- Assert: `expect(() => executeBatch([op], projectRoot)).not.toThrow();` and that the returned `result.results[0].success === false` with a non-empty `result.results[0].error`.

Determine the correct `projectRoot` argument from how the existing tests call `executeBatch` (they pass the fixtures dir or temp dir as the second arg — match that exactly).

**Verify**: `pnpm --filter themelab-cli exec vitest run` → all pass, including the new test. To confirm the test actually guards the bug, you may temporarily revert Step 1 and observe the new test fail (then re-apply Step 1).

## Test plan

- One new test in `packages/cli/src/__tests__/batch-transform.test.ts`: a failing `reorder` op returns `{ success: false, error }` and `executeBatch` does not throw.
- Structural pattern to follow: the existing reorder/`moveSibling` tests in the same file.
- Verification: `pnpm --filter themelab-cli exec vitest run` → all pass.

## Done criteria

ALL must hold:

- [ ] `pnpm typecheck` exits 0
- [ ] `pnpm --filter themelab-cli exec vitest run` exits 0; the new reorder-failure test exists and passes
- [ ] The `reorder` case in `batch-transform.ts` is wrapped in try/catch returning the error string
- [ ] No files outside the in-scope list are modified (`git status`)
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back if:

- The `reorder` case no longer matches the "Current state" excerpt (drift).
- You cannot construct a `reorder` op that fails deterministically from the available fixtures — report what you tried (do not weaken the assertion to make it pass).
- The new test passes even with Step 1 reverted (means the bug is not where described — report).

## Maintenance notes

- If a new structural op is added to this dispatch, it should follow the same try/catch-and-return-string contract; a reviewer should check for that.
- The deeper inconsistency (some functions throw, some return error strings, some return null) is real but out of scope here — it is captured separately as a tech-debt finding; this plan only fixes the one op that diverges from its immediate neighbors.
