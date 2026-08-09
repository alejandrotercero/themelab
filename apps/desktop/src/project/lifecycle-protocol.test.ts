import { describe, expect, it } from "vitest";

import { acceptsLifecycleRequest, isCurrentLifecycleSession, LifecycleSession } from "./lifecycle-protocol.js";

const inspection = { status: "unsupported" as const, workspaceRoot: "/workspace", diagnostics: [{ code: "no-app-found" as const, message: "No app" }] };

describe("LifecycleSession", () => {
  it("monotonically revises one authoritative snapshot", () => {
    const session = new LifecycleSession((() => { let id = 0; return () => `session-${++id}`; })());
    const opened = session.open(inspection);
    expect(opened).toMatchObject({ sessionId: "session-1", revision: 1, server: { status: "idle" } });
    const updated = session.update("session-1", { server: { status: "error", message: "failed" } });
    expect(updated).toMatchObject({ revision: 2, server: { status: "error" } });
  });

  it("ignores stale events after a project switch or close", () => {
    const session = new LifecycleSession((() => { let id = 0; return () => `session-${++id}`; })());
    const first = session.open(inspection);
    const second = session.open(inspection);
    expect(session.update(first.sessionId!, { server: { status: "error", message: "late" } })).toBeNull();
    expect(session.close(first.sessionId!)).toBeNull();
    expect(session.close(second.sessionId!)).toMatchObject({ sessionId: null, revision: 3 });
  });

  it("accepts mutations only from the active shell and active session", () => {
    expect(acceptsLifecycleRequest({ senderId: 8, shellSenderId: 8, sessionId: "session-1", activeSessionId: "session-1" })).toBe(true);
    expect(acceptsLifecycleRequest({ senderId: 9, shellSenderId: 8, sessionId: "session-1", activeSessionId: "session-1" })).toBe(false);
    expect(acceptsLifecycleRequest({ senderId: 8, shellSenderId: 8, sessionId: "old-session", activeSessionId: "session-1" })).toBe(false);
    expect(acceptsLifecycleRequest({ senderId: 8, shellSenderId: null, sessionId: "session-1", activeSessionId: "session-1" })).toBe(false);
  });

  it("does not apply delayed work from the project that was switched away", () => {
    expect(isCurrentLifecycleSession("session-2", "session-1")).toBe(false);
    expect(isCurrentLifecycleSession("session-2", "session-2")).toBe(true);
    expect(isCurrentLifecycleSession(null, "session-2")).toBe(false);
  });
});
