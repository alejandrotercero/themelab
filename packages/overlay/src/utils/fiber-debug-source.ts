// packages/overlay/src/utils/fiber-debug-source.ts
//
// Pure, dependency-free helper for reading React's `_debugSource` off a fiber
// (or its owner). Extracted from tools/resolve-helper.ts into its own leaf
// module so move-state.ts and drag.ts can use it without depending on
// resolve-helper.ts (which pulls in interaction.ts) — that indirect edge used
// to close an import cycle back through canvas-state.ts.

interface FiberDebugSource {
  fileName: string;
  lineNumber: number;
  columnNumber?: number;
}

interface FiberWithDebugInfo {
  _debugSource?: FiberDebugSource;
  _debugOwner?: FiberWithDebugInfo;
}

export function getDebugSource(fiber: unknown): FiberDebugSource | undefined {
  const f = fiber as FiberWithDebugInfo;
  return f._debugSource ?? f._debugOwner?._debugSource;
}
