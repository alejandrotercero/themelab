// packages/overlay/src/utils/component-trace.ts
//
// Formats a resolved component stack into a compact, signal-aware ancestor
// trace for the agent (surfaced via the MCP get_selection tool). Adapted from
// react-grab's formatStackContext.
//
// Goal: spend a small "line budget" on the high-signal app-source frames the
// agent actually needs, while keeping dependency frames and shared-UI wrappers
// (shadcn components/ui, design systems) as free, name-only context so they
// never crowd out meaningful locations. The raw ComponentInfo.stack is left
// untouched (drag and re-find logic depend on its order) — this is a derived,
// read-only view.

import { isSharedUiSourcePath } from "./is-shared-ui-source-path.js";

export interface TraceStackFrame {
  componentName: string;
  filePath: string;
  lineNumber: number;
  columnNumber: number;
  origin?: "app" | "package" | "unknown";
  packageName?: string | null;
}

export interface ComponentTraceOptions {
  /** High-signal app-source frames to spend before stopping. Default 3. */
  maxLines?: number;
  /** Hard cap on total lines (incl. free low-signal frames). Default 20. */
  hardMaxLines?: number;
}

const DEFAULT_MAX_LINES = 3;
const DEFAULT_HARD_MAX_LINES = 20;

function formatLocation(frame: TraceStackFrame): string {
  if (!frame.lineNumber) return frame.filePath;
  const col = frame.columnNumber ? `:${frame.columnNumber}` : "";
  return `${frame.filePath}:${frame.lineNumber}${col}`;
}

/** One trace line plus whether it spends the compact line budget. */
function formatFrameLine(
  frame: TraceStackFrame,
): { text: string; consumesBudget: boolean } | null {
  const isApp = frame.origin === "app" || (!frame.origin && Boolean(frame.filePath));
  const appPath = isApp ? frame.filePath : "";

  if (appPath) {
    return {
      text: `  in ${frame.componentName} (at ${formatLocation(frame)})`,
      // Shared-UI frames are surfaced but free, like dependency frames.
      consumesBudget: !isSharedUiSourcePath(appPath),
    };
  }

  // Dependency frame: render by name (and package, when known) rather than a
  // node_modules path, so library wrappers never compete with app source.
  if (frame.packageName) {
    return { text: `  in ${frame.componentName} (${frame.packageName})`, consumesBudget: false };
  }

  if (frame.componentName) {
    return { text: `  in ${frame.componentName}`, consumesBudget: false };
  }

  return null;
}

/**
 * Build a multi-line ancestor trace string. Returns "" when the stack yields no
 * usable frames. Lines are newline-joined and indented to read as a stack.
 */
export function formatComponentTrace(
  stack: readonly TraceStackFrame[],
  options: ComponentTraceOptions = {},
): string {
  const maxLines = options.maxLines ?? DEFAULT_MAX_LINES;
  const hardMaxLines = Math.max(maxLines, options.hardMaxLines ?? DEFAULT_HARD_MAX_LINES);

  const lines: string[] = [];
  let budgetedLineCount = 0;
  let previousPackageKey: string | null = null;

  for (const frame of stack) {
    if (budgetedLineCount >= maxLines || lines.length >= hardMaxLines) break;

    // Collapse consecutive frames from the same dependency (e.g. several Radix
    // parts in a row) into a single line.
    const packageKey = frame.packageName
      ? `${frame.packageName}:${frame.componentName}`
      : null;
    if (packageKey && packageKey === previousPackageKey) continue;

    const frameLine = formatFrameLine(frame);
    if (!frameLine) continue;

    // Skip consecutive identical lines (common under bundlers that omit line
    // numbers, where repeated wrapper frames collapse to the same text).
    if (frameLine.text === lines[lines.length - 1]) continue;

    if (frameLine.consumesBudget) budgetedLineCount += 1;
    lines.push(frameLine.text);
    previousPackageKey = packageKey;
  }

  return lines.join("\n");
}
