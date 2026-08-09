import { describe, expect, it } from "vitest";

import type { ProjectDescriptor } from "./project-model.js";
import type { LifecycleSnapshot } from "./lifecycle-protocol.js";
import { deriveLifecycleView } from "./lifecycle-view-model.js";

const project = { dependencyStatus: "ready", runtime: { compatible: true } } as ProjectDescriptor;
const base = (patch: Partial<LifecycleSnapshot> = {}): LifecycleSnapshot => ({
  sessionId: "session-1",
  revision: 1,
  inspection: { status: "ready", workspaceRoot: "/workspace", project, diagnostics: [] },
  project,
  install: { status: "idle" },
  server: { status: "idle" },
  preview: { status: "unavailable" },
  ...patch,
});

describe("deriveLifecycleView", () => {
  it.each([
    [{ sessionId: null }, "no-project", false, false],
    [{ inspection: { status: "needs-app-choice", workspaceRoot: "/workspace", candidates: [], diagnostics: [] } }, "app-choice", false, false],
    [{}, "setup", false, true],
    [{ server: { status: "starting", operationId: "op", command: "pnpm dev" } }, "starting", false, false],
    [{ server: { status: "ready", ownership: "owned", targetUrl: "http://127.0.0.1:4400/" }, preview: { status: "connecting", targetUrl: "http://127.0.0.1:4400/" } }, "preview-connecting", false, false],
    [{ server: { status: "ready", ownership: "attached", targetUrl: "http://127.0.0.1:4400/" }, preview: { status: "ready", targetUrl: "http://127.0.0.1:4400/" } }, "ready", true, false],
    [{ server: { status: "error", message: "failed" } }, "error", false, true],
  ] satisfies Array<[Partial<LifecycleSnapshot>, string, boolean, boolean]>)
    ("projects %s as %s", (patch, phase, canEdit, canStart) => {
      const view = deriveLifecycleView(base(patch));
      expect(view.phase).toBe(phase);
      expect(view.canEdit).toBe(canEdit);
      expect(view.canStart).toBe(canStart);
    });

  it("does not allow editing when the server is ready but the preview is not", () => {
    const view = deriveLifecycleView(base({ server: { status: "ready", ownership: "owned", targetUrl: "http://127.0.0.1:4400/" } }));
    expect(view.serverReady).toBe(true);
    expect(view.previewReady).toBe(false);
    expect(view.canEdit).toBe(false);
  });
});
