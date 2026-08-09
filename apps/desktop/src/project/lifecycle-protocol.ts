import { randomUUID } from "node:crypto";

import type { InstallState } from "./install-controller.js";
import type { LoopbackEndpoint } from "./dev-server-service.js";
import type { ProjectDescriptor, ProjectInspection } from "./project-model.js";

export type ServerLifecycleState =
  | { status: "idle"; message?: string }
  | { status: "starting"; operationId: string; command: string; message?: string }
  | { status: "choosing-endpoint"; operationId: string; command: string; candidates: LoopbackEndpoint[]; message?: string }
  | { status: "ready"; operationId?: string; ownership: "owned" | "attached"; targetUrl: string; pid?: number; message?: string }
  | { status: "stopping"; ownership: "owned" | "attached"; message?: string }
  | { status: "exited"; operationId?: string; exitCode: number | null; signal: string | null; message?: string }
  | { status: "error"; message: string };

export type PreviewLifecycleState =
  | { status: "unavailable"; message?: string }
  | { status: "connecting"; targetUrl: string }
  | { status: "ready"; targetUrl: string }
  | { status: "error"; message: string };

export interface LifecycleSnapshot {
  sessionId: string | null;
  revision: number;
  inspection: ProjectInspection | null;
  project: ProjectDescriptor | null;
  install: InstallState;
  server: ServerLifecycleState;
  preview: PreviewLifecycleState;
}

/** Pure boundary check so main-process IPC authorization is testable without Electron. */
export function acceptsLifecycleRequest(input: {
  senderId: number;
  shellSenderId: number | null;
  sessionId: unknown;
  activeSessionId: string | null;
}): input is { senderId: number; shellSenderId: number; sessionId: string; activeSessionId: string } {
  return input.shellSenderId !== null
    && input.senderId === input.shellSenderId
    && typeof input.sessionId === "string"
    && input.sessionId === input.activeSessionId;
}

/**
 * Async work captures the session that started it. This prevents a delayed
 * process event from an old project from mutating the project selected later.
 */
export function isCurrentLifecycleSession(activeSessionId: string | null, sessionId: string | null): sessionId is string {
  return sessionId !== null && sessionId === activeSessionId;
}

export class LifecycleSession {
  private snapshot: LifecycleSnapshot = {
    sessionId: null,
    revision: 0,
    inspection: null,
    project: null,
    install: { status: "idle" },
    server: { status: "idle" },
    preview: { status: "unavailable", message: "Choose a React project." },
  };

  constructor(private readonly createId: () => string = randomUUID) {}

  current(): LifecycleSnapshot { return this.snapshot; }

  open(inspection: ProjectInspection): LifecycleSnapshot {
    const project = inspection.status === "ready" ? inspection.project : null;
    this.snapshot = { sessionId: this.createId(), revision: this.snapshot.revision + 1, inspection, project, install: { status: "idle" }, server: { status: "idle" }, preview: { status: "unavailable", message: project ? "No preview is connected." : "Choose a React app before starting a preview." } };
    return this.snapshot;
  }

  close(sessionId: string): LifecycleSnapshot | null {
    if (sessionId !== this.snapshot.sessionId) return null;
    this.snapshot = { sessionId: null, revision: this.snapshot.revision + 1, inspection: null, project: null, install: { status: "idle" }, server: { status: "idle" }, preview: { status: "unavailable", message: "Choose a React project." } };
    return this.snapshot;
  }

  update(sessionId: string, patch: Partial<Pick<LifecycleSnapshot, "inspection" | "project" | "install" | "server" | "preview">>): LifecycleSnapshot | null {
    if (sessionId !== this.snapshot.sessionId) return null;
    this.snapshot = { ...this.snapshot, ...patch, revision: this.snapshot.revision + 1 };
    return this.snapshot;
  }
}
