import type { LifecycleSnapshot } from "./lifecycle-protocol.js";

export type LifecycleViewPhase =
  | "no-project"
  | "app-choice"
  | "setup"
  | "starting"
  | "preview-connecting"
  | "ready"
  | "error";

export interface LifecycleViewModel {
  phase: LifecycleViewPhase;
  serverReady: boolean;
  previewReady: boolean;
  canEdit: boolean;
  canStart: boolean;
  canAttach: boolean;
  serverLabel: "Connect" | "Starting" | "Server" | "Attached" | "Error";
}

/**
 * The renderer's lifecycle affordances are a pure projection of one session
 * snapshot. Keeping this decision out of JSX prevents impossible combinations
 * such as an editable inspector while the preview is still connecting.
 */
export function deriveLifecycleView(snapshot: LifecycleSnapshot): LifecycleViewModel {
  if (!snapshot.sessionId) {
    return { phase: "no-project", serverReady: false, previewReady: false, canEdit: false, canStart: false, canAttach: false, serverLabel: "Connect" };
  }
  if (snapshot.inspection?.status === "needs-app-choice") {
    return { phase: "app-choice", serverReady: false, previewReady: false, canEdit: false, canStart: false, canAttach: false, serverLabel: "Connect" };
  }
  if (snapshot.server.status === "error") {
    return { phase: "error", serverReady: false, previewReady: false, canEdit: false, canStart: Boolean(snapshot.project?.dependencyStatus === "ready"), canAttach: true, serverLabel: "Error" };
  }
  if (snapshot.server.status === "starting" || snapshot.server.status === "choosing-endpoint" || snapshot.server.status === "stopping") {
    return { phase: "starting", serverReady: false, previewReady: false, canEdit: false, canStart: false, canAttach: false, serverLabel: "Starting" };
  }
  if (snapshot.server.status === "ready") {
    const previewReady = snapshot.preview.status === "ready";
    return { phase: previewReady ? "ready" : "preview-connecting", serverReady: true, previewReady, canEdit: previewReady, canStart: false, canAttach: false, serverLabel: snapshot.server.ownership === "attached" ? "Attached" : "Server" };
  }
  const canStart = snapshot.project?.dependencyStatus === "ready" && snapshot.project.runtime.compatible !== false;
  return { phase: "setup", serverReady: false, previewReady: false, canEdit: false, canStart, canAttach: true, serverLabel: "Connect" };
}
