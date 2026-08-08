import type { ComponentInfo, ThemeSource, ThemeStyles } from "@themelab/shared";

declare global {
  interface Window {
    themelabDesktop: {
      getWorkspaceRoot: () => Promise<string | null>;
      getWorkspaceSummary: () => Promise<{ root: string; framework: "nextjs" | "vite" | "cra" | null; port: number | null; detectionError: string | null; git: { available: boolean; root: string | null; branch: string | null; changedFiles: number } } | null>;
      chooseWorkspace: () => Promise<string | null>;
      startWorkspace: () => Promise<{ root?: string; workspace?: { root: string; framework: "nextjs" | "vite" | "cra" | null; port: number | null; detectionError: string | null; git: { available: boolean; root: string | null; branch: string | null; changedFiles: number } }; error?: string }>;
      getDevStatus: () => Promise<{ status: "idle" | "starting" | "running" | "attached" | "error" | "stopped"; command?: string; message?: string }>;
      getDevLogs: () => Promise<Array<{ stream: "stdout" | "stderr"; text: string; at: number }>>;
      startDevServer: () => Promise<{ status: "idle" | "starting" | "running" | "attached" | "error" | "stopped"; command?: string; message?: string }>;
      stopDevServer: () => Promise<{ status: "idle" | "starting" | "running" | "attached" | "error" | "stopped"; command?: string; message?: string }>;
      onDevStatus: (callback: (status: { status: "idle" | "starting" | "running" | "attached" | "error" | "stopped"; command?: string; message?: string }) => void) => () => void;
      onDevLog: (callback: (entry: { stream: "stdout" | "stderr"; text: string; at: number }) => void) => () => void;
      proposeTheme: (edits: Record<string, string>) => Promise<{ id: string; label: string; createdAt: number; origin: "theme" | "inspector" | "agent" | "other"; operation: string | null; selectionKey: string | null; diff: string; files: string[] } | null>;
      applyThemeProposal: (proposalId: string) => Promise<{ proposalId?: string; recoveryPath?: string; files?: string[]; error?: string } | null>;
      discardThemeProposal: (proposalId: string) => Promise<boolean>;
      listChanges: () => Promise<Array<{ id: string; label: string; createdAt: number; origin: "theme" | "inspector" | "agent" | "other"; operation: string | null; selectionKey: string | null; diff: string; files: string[] }>>;
      listChangeHistory: () => Promise<Array<{ proposalId: string; label: string; createdAt: number; origin: "theme" | "inspector" | "agent" | "other"; operation: string | null; selectionKey: string | null; files: string[]; status: "undoable" | "undone" | "conflicted" }> | { error: string }>;
      applyChange: (proposalId: string) => Promise<{ proposalId?: string; recoveryPath?: string; files?: string[]; error?: string } | null>;
      discardChange: (proposalId: string) => Promise<boolean>;
      undoChange: (proposalId: string) => Promise<{ proposalId?: string; files?: string[]; error?: string } | null>;
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
