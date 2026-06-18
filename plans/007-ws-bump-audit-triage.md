# Plan 007: Resolve the `ws` advisory in the published CLI and triage the rest of `pnpm audit`

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving on. If
> anything in "STOP conditions" occurs, stop and report. When done, update the
> status row for this plan in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat 515682b..HEAD -- packages/cli/package.json pnpm-lock.yaml`
> If these changed since this plan was written, re-run `pnpm audit` to get the
> current picture before acting.

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: deps
- **Planned at**: commit `515682b`, 2026-06-17

## Why this matters

`pnpm audit` flags advisories across the workspace. The one that matters most is **`ws`** (`high` memory-exhaustion DoS + `moderate` uninitialized-memory disclosure) on the path `packages/cli > ws` — because `ws` is a **runtime dependency of the published `themelab-cli` package**, so it ships to every user. The other flagged packages (`vite`, `hono` via `shadcn`→`@modelcontextprotocol/sdk`, `esbuild`, `picomatch`, `eslint-*` resolvers, `jscodeshift`→`tmp`) are dev/build-time only under `apps/web` tooling or transitive build tools — `apps/web` is private (not published) and those don't ship in the npm package. This plan upgrades `ws` to a patched version and records the triage of the remainder so they aren't re-investigated each run.

## Current state

- `packages/cli/package.json:59` declares `"ws": "^8.18.0"`; the lockfile currently resolves `ws@8.19.0`.
- `pnpm audit` (run at `515682b`) reported, among others:
  - **high** — `ws: Memory exhaustion DoS from tiny fragments` → path `packages__cli>ws` (**runtime, shipped**)
  - **moderate** — `ws: Uninitialized memory disclosure` → path `packages__cli>ws` (**runtime, shipped**)
  - high/moderate — `vite`, `hono` (under `apps/web>shadcn>@modelcontextprotocol/sdk>hono`), `picomatch`, `esbuild`, `tmp` (under `packages__cli>jscodeshift>tmp`), various `eslint-config-next` resolvers (**dev/build-time, not shipped to CLI users**)
- The CLI's own MCP server uses `@modelcontextprotocol/sdk` directly (not via `shadcn`), so the `hono` advisory path shown (`apps/web>shadcn>...`) is the web dev tooling, not the CLI runtime. Confirm this during Step 1.

## Commands you will need

| Purpose             | Command                                          | Expected on success |
|---------------------|--------------------------------------------------|---------------------|
| Audit (full)        | `pnpm audit`                                      | prints advisory table |
| Audit (prod only)   | `pnpm audit --prod`                               | prints prod advisories |
| Why is ws here      | `pnpm why ws`                                      | shows the dep paths |
| Install             | `pnpm install`                                     | exit 0              |
| Build               | `pnpm build`                                       | exit 0              |
| CLI tests           | `pnpm --filter themelab-cli exec vitest run`       | all pass            |

## Scope

**In scope**:
- `packages/cli/package.json` — bump the `ws` range if needed.
- `pnpm-lock.yaml` — updated by `pnpm update`/`pnpm install` (this is the one lockfile change allowed for this plan).

**Out of scope** (do NOT touch):
- `apps/web` dependencies — the dev-only advisories there are tracked in the triage table below; do not mass-upgrade Next/eslint/shadcn as part of this plan (that is a separate, higher-risk migration).
- Any source code — this is a dependency change only.

## Git workflow

- Branch: `advisor/007-ws-bump`.
- Conventional commit, e.g. `chore(cli): bump ws to patch DoS/memory advisories`.
- Do NOT push or open a PR unless instructed.

## Steps

### Step 1: Re-confirm the live audit picture for `ws`

Run:

```
pnpm why ws
pnpm audit | grep -A4 -i "ws"
```

Confirm `ws` is a **direct** dependency of `packages/cli` and identify the **patched version** the advisory names (the audit output states the fixed/`Patched` version range). If the currently-resolved `ws` is already at or above the patched version and the advisory no longer appears, there may be a stale lockfile or a second `ws` copy — run `pnpm why ws` to see if multiple versions are present.

### Step 2: Upgrade `ws` to a patched version

- If a newer patched `ws` exists within `^8`, run: `pnpm --filter themelab-cli update ws` (this respects the `^8.18.0` range; bumps to the latest 8.x).
- If the patched version requires leaving `^8` (a new major), instead set the range explicitly in `packages/cli/package.json` to the patched version the audit names, then `pnpm install`. A `ws` major bump can change the `WebSocketServer`/`WebSocket` API — if so, that interacts with plan 001 (which also edits the WS server); coordinate and re-run the CLI tests.

**Verify**: `pnpm audit | grep -i "ws:"` no longer lists the `packages/cli>ws` high/moderate advisories (or `pnpm why ws` shows only the patched version).

### Step 3: Rebuild and test

**Verify**:
- `pnpm build` → exit 0.
- `pnpm --filter themelab-cli exec vitest run` → all pass (the WS server tests in `server.test.ts` confirm the upgraded `ws` still works).

### Step 4: Record the triage of the remaining advisories

This is documentation, not code. In your completion report (and the `plans/README.md` notes), record which remaining advisories were **accepted as dev-only** and why (they do not ship in `themelab-cli`): `vite`, `hono`, `esbuild`, `picomatch`, `eslint-config-next` resolvers, `jscodeshift>tmp`. Note that `jscodeshift>tmp` is a runtime transitive of the CLI but the `tmp` path-traversal advisory requires attacker-controlled prefix/postfix, which jscodeshift does not expose to external input — low reachability; flag for a future jscodeshift bump rather than action now.

## Test plan

- No new unit tests. Verification is the audit no longer flagging shipped `ws`, plus the existing CLI test suite (which includes WebSocket server tests) passing on the upgraded dependency.
- Verification: `pnpm build` + `pnpm --filter themelab-cli exec vitest run` → all green; `pnpm audit` no longer lists the `packages/cli>ws` advisories.

## Done criteria

ALL must hold:

- [ ] `pnpm why ws` shows a single, patched `ws` version for `packages/cli`
- [ ] `pnpm audit` no longer reports the `packages/cli>ws` high/moderate advisories
- [ ] `pnpm build` exits 0
- [ ] `pnpm --filter themelab-cli exec vitest run` exits 0
- [ ] Only `packages/cli/package.json` and `pnpm-lock.yaml` changed (`git status`)
- [ ] `plans/README.md` status row updated, with the dev-only triage recorded in its notes

## STOP conditions

Stop and report back if:

- The only patched `ws` requires a **major** version bump that changes the `WebSocketServer` API (coordinate with plan 001 before proceeding — do not break the WS server).
- After upgrading, the CLI WebSocket tests fail.
- `pnpm why ws` shows multiple `ws` versions that cannot be deduped without touching `apps/web` deps (report; deduping may need a `pnpm.overrides` entry, which is a broader decision).

## Maintenance notes

- The `apps/web` dev-tooling advisories (Next/eslint/shadcn/vite chain) should be addressed by a deliberate Next.js + tooling upgrade, tracked separately — not folded into a CLI dependency bump.
- Re-run `pnpm audit --prod` before each `themelab-cli` release; the prod set is the one that actually ships.
- If `@anthropic-ai/sdk` is bumped later (it lags a few minors), do it in its own change with an AI-locator smoke test, not here.
