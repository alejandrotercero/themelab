import type { ComponentInfo, ThemeSource, ThemeStyles } from "@themelab/shared";
import type { LifecycleSnapshot } from "../project/lifecycle-protocol.js";

declare global {
  interface Window {
    themelabDesktop: {
      getWorkspaceRoot: () => Promise<string | null>;
      getWorkspaceSummary: () => Promise<{ root: string; framework: "nextjs" | "vite" | "cra" | null; port: number | null; detectionError: string | null; project: { id: string; workspaceRoot: string; appRoot: string; installRoot: string; displayName: string; framework: "nextjs" | "vite" | "cra" | "unknown"; packageJsonPath: string; packageManager: { name: "pnpm" | "npm" | "yarn" | "bun" | null; declaredVersion: string | null; source: string | null; lockfile: string | null }; runtime: { requirement: string | null; requirementSource: string | null; executable: string | null; version: string | null; compatible: boolean | null; source: string | null; diagnostic: string | null }; scripts: Array<{ id: string; name: string; command: string; recommended: boolean }>; dependencyStatus: string; diagnostics: Array<{ code: string; message: string }> } | null; appChoices: Array<{ appRoot: string; displayName: string; framework: "nextjs" | "vite" | "cra" | "unknown" }>; git: { available: boolean; root: string | null; branch: string | null; changedFiles: number }; runtime: { nodeRequirement: string | null; nodeSource: string | null; nodePath: string | null; nodeVersion: string | null; packageManager: "pnpm" | "npm" | "yarn" | "bun" | null; dependenciesInstalled: boolean } | null } | null>;
      getWorkspaceSession: () => Promise<LifecycleSnapshot>;
      chooseWorkspace: () => Promise<string | null>;
      getRecentWorkspaces: () => Promise<string[]>;
      openRecentWorkspace: (root: string) => Promise<string | null>;
      chooseWorkspaceApp: (sessionId: string, appRoot: string) => ReturnType<Window["themelabDesktop"]["getWorkspaceSummary"]>;
      chooseNodeExecutable: (sessionId: string) => ReturnType<Window["themelabDesktop"]["getWorkspaceSummary"]>;
      closeWorkspace: (sessionId: string) => Promise<boolean>;
      planWorkspaceDependencies: (sessionId: string) => Promise<{ ok: boolean; message?: string; planId?: string; plan?: { projectId: string; executable: string; args: string[]; cwd: string; displayCommand: string; lockfileMode: "frozen" | "mutable"; mutatesLockfile: boolean } }>;
      confirmWorkspaceDependencies: (sessionId: string, planId: string) => Promise<{ ok: boolean; message: string }>;
      cancelWorkspaceDependencies: (sessionId: string) => Promise<{ ok: boolean; message: string }>;
      getInstallStatus: () => Promise<{ status: "idle" | "needs-confirmation" | "installing" | "ready" | "cancelled" | "error"; operationId?: string; planId?: string; message?: string; plan?: { projectId: string; displayCommand: string; cwd: string; mutatesLockfile: boolean } }>;
      getInstallLogs: () => Promise<Array<{ stream: "stdout" | "stderr"; text: string; at: number }>>;
      startWorkspace: () => Promise<{ root?: string; workspace?: { root: string; framework: "nextjs" | "vite" | "cra" | null; port: number | null; detectionError: string | null; project: { id: string; workspaceRoot: string; appRoot: string; installRoot: string; displayName: string; framework: "nextjs" | "vite" | "cra" | "unknown"; packageJsonPath: string; packageManager: { name: "pnpm" | "npm" | "yarn" | "bun" | null; declaredVersion: string | null; source: string | null; lockfile: string | null }; runtime: { requirement: string | null; requirementSource: string | null; executable: string | null; version: string | null; compatible: boolean | null; source: string | null; diagnostic: string | null }; scripts: Array<{ id: string; name: string; command: string; recommended: boolean }>; dependencyStatus: string; diagnostics: Array<{ code: string; message: string }> } | null; git: { available: boolean; root: string | null; branch: string | null; changedFiles: number }; runtime: { nodeRequirement: string | null; nodeSource: string | null; nodePath: string | null; nodeVersion: string | null; packageManager: "pnpm" | "npm" | "yarn" | "bun" | null; dependenciesInstalled: boolean } }; error?: string }>;
      getDevStatus: () => Promise<{ status: "idle" | "starting" | "choosing-endpoint" | "running" | "attached" | "error" | "stopped"; command?: string; message?: string; targetUrl?: string; candidates?: Array<{ url: string; host: "127.0.0.1" | "localhost" | "[::1]"; port: number }> }>;
      getDevLogs: () => Promise<Array<{ stream: "stdout" | "stderr"; text: string; at: number }>>;
      startDevServer: (sessionId: string) => Promise<{ status: "idle" | "starting" | "choosing-endpoint" | "running" | "attached" | "error" | "stopped"; command?: string; message?: string; targetUrl?: string; candidates?: Array<{ url: string; host: "127.0.0.1" | "localhost" | "[::1]"; port: number }> }>;
      chooseDevEndpoint: (sessionId: string, url: string) => ReturnType<Window["themelabDesktop"]["getDevStatus"]>;
      attachDevServer: (sessionId: string, url: string) => Promise<{ status: "idle" | "starting" | "choosing-endpoint" | "running" | "attached" | "error" | "stopped"; command?: string; message?: string; targetUrl?: string; candidates?: Array<{ url: string; host: "127.0.0.1" | "localhost" | "[::1]"; port: number }> }>;
      stopDevServer: (sessionId: string) => Promise<{ status: "idle" | "starting" | "choosing-endpoint" | "running" | "attached" | "error" | "stopped"; command?: string; message?: string; targetUrl?: string; candidates?: Array<{ url: string; host: "127.0.0.1" | "localhost" | "[::1]"; port: number }> }>;
      onDevStatus: (callback: (status: { status: "idle" | "starting" | "choosing-endpoint" | "running" | "attached" | "error" | "stopped"; command?: string; message?: string; targetUrl?: string; sessionId?: string | null; candidates?: Array<{ url: string; host: "127.0.0.1" | "localhost" | "[::1]"; port: number }> }) => void) => () => void;
      onDevLog: (callback: (entry: { stream: "stdout" | "stderr"; text: string; at: number }) => void) => () => void;
      onSessionSnapshot: (callback: (snapshot: LifecycleSnapshot) => void) => () => void;
      onInstallStatus: (callback: (status: { status: "idle" | "needs-confirmation" | "installing" | "ready" | "cancelled" | "error"; operationId?: string; planId?: string; message?: string; plan?: { projectId: string; displayCommand: string; cwd: string; mutatesLockfile: boolean } }) => void) => () => void;
      onInstallLog: (callback: (entry: { stream: "stdout" | "stderr"; text: string; at: number }) => void) => () => void;
      proposeTheme: (edits: Record<string, string>) => Promise<{ id: string; label: string; createdAt: number; origin: "theme" | "inspector" | "agent" | "other"; operation: string | null; selectionKey: string | null; diff: string; files: string[] } | null>;
      applyThemeProposal: (proposalId: string) => Promise<{ proposalId?: string; recoveryPath?: string; files?: string[]; error?: string } | null>;
      discardThemeProposal: (proposalId: string) => Promise<boolean>;
      listChanges: () => Promise<Array<{ id: string; label: string; createdAt: number; origin: "theme" | "inspector" | "agent" | "other"; operation: string | null; selectionKey: string | null; diff: string; files: string[] }>>;
      listChangeHistory: () => Promise<Array<{ proposalId: string; label: string; createdAt: number; origin: "theme" | "inspector" | "agent" | "other"; operation: string | null; selectionKey: string | null; files: string[]; status: "undoable" | "undone" | "conflicted" }> | { error: string }>;
      applyChange: (proposalId: string) => Promise<{ proposalId?: string; recoveryPath?: string; files?: string[]; error?: string } | null>;
      discardChange: (proposalId: string) => Promise<boolean>;
      undoChange: (proposalId: string) => Promise<{ proposalId?: string; files?: string[]; error?: string } | null>;
      workspace: {
        getRoot: Window["themelabDesktop"]["getWorkspaceRoot"];
        summary: Window["themelabDesktop"]["getWorkspaceSummary"];
        choose: Window["themelabDesktop"]["chooseWorkspace"];
        recents: Window["themelabDesktop"]["getRecentWorkspaces"];
        openRecent: Window["themelabDesktop"]["openRecentWorkspace"];
        chooseApp: Window["themelabDesktop"]["chooseWorkspaceApp"];
        chooseNode: Window["themelabDesktop"]["chooseNodeExecutable"];
        close: Window["themelabDesktop"]["closeWorkspace"];
        start: Window["themelabDesktop"]["startWorkspace"];
      };
      dependencies: {
        status: Window["themelabDesktop"]["getInstallStatus"];
        logs: Window["themelabDesktop"]["getInstallLogs"];
        plan: Window["themelabDesktop"]["planWorkspaceDependencies"];
        confirm: Window["themelabDesktop"]["confirmWorkspaceDependencies"];
        cancel: Window["themelabDesktop"]["cancelWorkspaceDependencies"];
        subscribe: Window["themelabDesktop"]["onInstallStatus"];
        subscribeLogs: Window["themelabDesktop"]["onInstallLog"];
      };
      dev: {
        status: Window["themelabDesktop"]["getDevStatus"];
        logs: Window["themelabDesktop"]["getDevLogs"];
        start: Window["themelabDesktop"]["startDevServer"];
        chooseEndpoint: Window["themelabDesktop"]["chooseDevEndpoint"];
        attach: Window["themelabDesktop"]["attachDevServer"];
        stop: Window["themelabDesktop"]["stopDevServer"];
        subscribe: Window["themelabDesktop"]["onDevStatus"];
        subscribeLogs: Window["themelabDesktop"]["onDevLog"];
      };
      session: {
        current: Window["themelabDesktop"]["getWorkspaceSession"];
        subscribe: Window["themelabDesktop"]["onSessionSnapshot"];
      };
      proposeClassChange: (selection: Pick<ComponentInfo, "filePath" | "lineNumber" | "columnNumber">, className: string) => Promise<{ id?: string; label?: string; createdAt?: number; origin?: "theme" | "inspector" | "agent" | "other"; operation?: string | null; selectionKey?: string | null; diff?: string; files?: string[]; error?: string } | null>;
      proposeTailwindChanges: (selection: ComponentInfo, updates: Array<{ tailwindPrefix: string; tailwindToken: string | null; value: string; relatedPrefixes?: string[]; classPattern?: string; standalone?: boolean; variant?: string }>) => Promise<{ id?: string; label?: string; createdAt?: number; origin?: "theme" | "inspector" | "agent" | "other"; operation?: string | null; selectionKey?: string | null; diff?: string; files?: string[]; error?: string } | null>;
      setPreviewBounds: (bounds: {
        x: number;
        y: number;
        width: number;
        height: number;
      }) => void;
      onRequestPreviewBounds: (callback: () => void) => () => void;
      onPreviewStatus: (callback: (status: { status: string; message?: string }) => void) => () => void;
      onPreviewSelection: (callback: (selection: ComponentInfo | null) => void) => () => void;
      onPreviewTheme: (callback: (theme: { theme: ThemeStyles; source: ThemeSource | null } | null) => void) => () => void;
      applyPreviewStyle: (property: string, value: string) => Promise<ComponentInfo | null>;
      clearPreviewStyles: () => Promise<ComponentInfo | null>;
      applyPreviewTheme: (mode: "light" | "dark", name: string, value: string) => Promise<boolean>;
      setPreviewThemeMode: (mode: "light" | "dark") => Promise<boolean>;
      resetPreviewTheme: () => Promise<boolean>;
      commitPreviewTheme: () => Promise<boolean>;
      navigatePreview: (direction: "up" | "down" | "left" | "right") => Promise<boolean>;
      movePreview: (direction: "up" | "down") => Promise<boolean>;
      bindPreviewToken: (key: string, token: string) => Promise<boolean>;
      pickPreviewTailwind: (key: string, token: string, css: string) => Promise<boolean>;
      undoPreview: () => Promise<boolean>;
      canvasUndoPreview: () => Promise<boolean>;
      resetPreview: () => Promise<boolean>;
      togglePreviewCanvas: () => Promise<boolean>;
      togglePreviewHistory: () => Promise<boolean>;
      closePreview: () => Promise<boolean>;
      commitPreview: () => Promise<boolean>;
      commitPreviewAi: () => Promise<boolean>;
      togglePreviewShortcuts: () => Promise<boolean>;
      togglePreviewSettings: () => Promise<boolean>;
      openThemeEditor: () => Promise<boolean>;
      pasteTheme: (value: string) => Promise<{ applied: number; skipped: number; modes: string } | null>;
      setPreviewVariant: (breakpoint: string, dark: boolean) => Promise<boolean>;
    };
  }
}

export {};
