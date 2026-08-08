import { randomUUID } from "node:crypto";
import * as fs from "node:fs";
import path from "node:path";

import type {
  BatchOperation,
  ClientMessage,
  ServerMessage,
  UndoEntry,
  TransformErrorCode,
  TailwindTokenMap,
  ComponentInfo,
  ThemeStyles,
  ThemeSource,
} from "@themelab/shared";
// packages/cli/src/server.ts
import { WebSocketServer, WebSocket } from "ws";

import { executeBatchWithAi, invalidateLocateCache } from "./ai-locate.js";
import type { AiOptions, AiProposal } from "./ai-locate.js";
import { generateMobileFirstClassName } from "./ai-optimize.js";
import type { OptimizeInput, OptimizeProposal } from "./ai-optimize.js";
import { executeBatch } from "./batch-transform.js";
import { resolveAiConfig, updateAiConfig } from "./config.js";
import { discoverFile } from "./file-discovery.js";
import {
  logBatchStart,
  logBatchResult,
  logBatchException,
} from "./log-format.js";
import { logger } from "./logger.js";
import {
  isProjectFilePathSafe,
  resolveProjectFilePath,
} from "./path-resolver.js";
import { resolveTailwindConfig } from "./tailwind-resolver.js";
import { resolveTheme } from "./theme-resolver.js";
import { writeThemeVars } from "./theme-writer.js";
import { reorderComponent, getSiblings } from "./transform.js";

/** Allow only same-machine browser origins. Missing Origin (non-browser
 * clients) is allowed; a present Origin must resolve to a loopback hostname,
 * which blocks any real website (and DNS-rebinding, since Origin carries the
 * page's hostname, not the resolved IP). */
function isAllowedWsOrigin(origin: string): boolean {
  if (!origin) {
    return true;
  }
  try {
    const { hostname } = new URL(origin);
    return (
      hostname === "localhost" ||
      hostname === "127.0.0.1" ||
      hostname === "::1" ||
      hostname === "[::1]"
    );
  } catch {
    return false;
  }
}

function extractErrorCode(err: unknown): TransformErrorCode | undefined {
  if (err instanceof Error) {
    const match = err.message.match(
      /^(?<code>DYNAMIC_CLASSNAME|FILE_CHANGED|MAPPED_ELEMENT|CONFLICTING_CLASS|AMBIGUOUS)/
    );
    if (match?.groups) {
      return match.groups.code as TransformErrorCode;
    }
  }
  return undefined;
}

function send(ws: WebSocket, msg: ServerMessage) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(msg));
  }
}

interface SketchServerOptions {
  port: number;
  /** Project root used for source resolution and writes. Defaults to cwd. */
  projectRoot?: string;
  /** Called whenever the overlay selection changes (desktop shell bridge). */
  onSelectionChange?: (selection: ComponentInfo | null) => void;
  /** Called when the project theme is resolved for a connected overlay. */
  onThemeChange?: (
    theme: { theme: ThemeStyles; source: ThemeSource | null } | null
  ) => void;
  /** Force-enable/disable the AI locator. Defaults to !!process.env.ANTHROPIC_API_KEY. */
  enableAi?: boolean;
}

interface SketchServer {
  wss: WebSocketServer;
  close: () => void;
  getActiveClient: () => WebSocket | null;
  /** The overlay's current component selection, or null if nothing is selected. */
  getSelection: () => ComponentInfo | null;
  /** The project's resolved design-token theme (light/dark), or null if unresolved. */
  getTheme: () => { theme: ThemeStyles; source: ThemeSource | null } | null;
  /** The project's resolved Tailwind token map, or null if unresolved. */
  getTailwindTokens: () => TailwindTokenMap | null;
  /** Resolve a component name to its source file path (grep-based discovery). */
  discoverComponentFile: (componentName: string) => Promise<string | null>;
  /** Whether an overlay client is currently connected. */
  isOverlayConnected: () => boolean;
}

export function attachUndoIdsToBatchResults(
  results: {
    op: BatchOperation["op"];
    file: string;
    line: number;
    success: boolean;
    error?: string;
  }[],
  undoEntries: {
    filePath: string;
    content: string;
    afterContent: string;
  }[],
  undoIds: string[],
  projectRoot: string
) {
  const undoIdByFile = new Map<string, string>();
  for (const [index, entry] of undoEntries.entries()) {
    const resolved = path.resolve(projectRoot, entry.filePath);
    const undoId = undoIds[index];
    if (undoId) {
      undoIdByFile.set(resolved, undoId);
    }
  }

  return results.map((result) => {
    const resolvedResultPath = path.resolve(projectRoot, result.file);
    return {
      ...result,
      undoId: result.success ? undoIdByFile.get(resolvedResultPath) : undefined,
    };
  });
}

export function createSketchServer(
  portOrOptions: number | SketchServerOptions
): SketchServer {
  const port =
    typeof portOrOptions === "number" ? portOrOptions : portOrOptions.port;
  const wss = new WebSocketServer({
    port,
    host: "127.0.0.1",
    verifyClient: (info: { origin: string; secure: boolean }) =>
      isAllowedWsOrigin(info.origin),
  });
  const projectRoot = path.resolve(
    typeof portOrOptions === "object" && portOrOptions.projectRoot
      ? portOrOptions.projectRoot
      : process.cwd()
  );
  const onSelectionChange =
    typeof portOrOptions === "object"
      ? portOrOptions.onSelectionChange
      : undefined;
  const onThemeChange =
    typeof portOrOptions === "object"
      ? portOrOptions.onThemeChange
      : undefined;

  // AI locator config: merged from the persisted settings file + env overrides.
  // `enableAi:false` on the server options force-disables regardless.
  const forceDisableAi =
    typeof portOrOptions === "object" && portOrOptions.enableAi === false;
  function buildAiOptions(): AiOptions {
    const cfg = resolveAiConfig();
    return {
      apiKey: cfg.apiKey,
      baseURL: cfg.baseURL,
      model: cfg.model,
      enableAi: !forceDisableAi && cfg.enabled,
      escalation: {
        enabled: cfg.escalationEnabled,
        model: cfg.escalationModel,
      },
    };
  }
  let aiOptions: AiOptions = buildAiOptions();
  // Per-request options: adds a "locating…" signal when an AI attempt starts
  // (tier 2 = the escalated "looking harder" retry).
  const aiOptionsFor = (ws: WebSocket): AiOptions => ({
    ...aiOptions,
    onEscalate: (tier) => send(ws, { type: "aiResolving", tier }),
  });
  // Pending AI proposals (structural / cross-file) awaiting user confirmation.
  const pendingProposals = new Map<string, AiProposal>();
  // Pending "Optimize for mobile" proposals awaiting user confirmation.
  const pendingOptimize = new Map<
    string,
    OptimizeProposal & { filePath: string; line: number; col: number }
  >();
  if (aiOptions.enableAi) {
    logger.info("[ThemeLab] AI locator enabled");
  }
  const undoStack: UndoEntry[] = [];
  let activeClient: WebSocket | null = null;
  let processing = false;
  const queue: { msg: ClientMessage; ws: WebSocket }[] = [];

  // Live context surfaced to external agents over MCP. Selection is reported by
  // the overlay via `setSelection`; theme/tokens are resolved once per connect.
  let currentSelection: ComponentInfo | null = null;
  let currentTheme: { theme: ThemeStyles; source: ThemeSource | null } | null =
    null;
  let currentTokens: TailwindTokenMap | null = null;

  // Single source of truth for mutating message types: these are processed
  // sequentially via the queue (processQueue). Anything listed here MUST have a
  // matching case in the processQueue switch — its `default` loudly flags drift.
  // Everything else is handled immediately (read-only) in the message dispatcher.
  const WRITE_MESSAGE_TYPES = new Set<ClientMessage["type"]>([
    "reorder",
    "moveSibling",
    "updateTheme",
    "undo",
    "updateProperty",
    "updateProperties",
    "updateText",
    "revertChanges",
    "commitBatch",
    "confirmResolution",
    "confirmOptimize",
    "optimizeResponsive",
    "saveSettings",
  ]);

  /** Send an AI proposal (structural / cross-file resolution) for confirmation. */
  function emitProposals(ws: WebSocket, proposals: AiProposal[] | undefined) {
    if (!proposals) {
      return;
    }
    for (const p of proposals) {
      const id = randomUUID();
      pendingProposals.set(id, p);
      send(ws, {
        type: "aiProposal",
        id,
        kind: p.target.kind,
        reasoning: p.target.reasoning,
        summary: p.intent,
        filePath: p.target.filePath,
        line: p.target.line,
      });
    }
  }

  function handleUpdateTheme(
    msg: Extract<ClientMessage, { type: "updateTheme" }>,
    ws: WebSocket
  ) {
    if (!isProjectFilePathSafe(msg.filePath, projectRoot)) {
      logger.warn(`[ThemeLab] Rejected theme write path: ${msg.filePath}`);
      send(ws, {
        type: "updateThemeComplete",
        success: false,
        error: "Theme file path is outside the project root",
      });
      return;
    }
    const resolvedPath = resolveProjectFilePath(msg.filePath, projectRoot);
    if (!resolvedPath) {
      throw new Error(`Could not resolve project file path: ${msg.filePath}`);
    }
    const result = writeThemeVars(resolvedPath, msg.edits);
    if (!result.success) {
      send(ws, {
        type: "updateThemeComplete",
        success: false,
        error: result.error,
      });
      return;
    }
    let undoId: string | undefined;
    if (
      result.before !== result.after &&
      result.before !== undefined &&
      result.after !== undefined
    ) {
      undoId = randomUUID();
      undoStack.push({
        id: undoId,
        filePath: resolvedPath,
        content: result.before,
        afterContent: result.after,
        timestamp: Date.now(),
      });
    }
    logger.debug(
      `[theme] wrote ${msg.edits.reduce((n, e) => n + Object.keys(e.vars).length, 0)} var(s) to ${path.relative(projectRoot, resolvedPath)}`
    );
    send(ws, { type: "updateThemeComplete", success: true, undoId });
  }

  function handleReorder(
    msg: Extract<ClientMessage, { type: "reorder" }>,
    ws: WebSocket
  ) {
    if (!isProjectFilePathSafe(msg.filePath, projectRoot)) {
      const error = msg.filePath.trim()
        ? "File path is outside the project root"
        : "File path could not be resolved for this element";
      logger.warn(`[ThemeLab] Rejected reorder path: ${msg.filePath}`);
      send(ws, { type: "reorderComplete", success: false, error });
      return;
    }
    const resolvedPath = resolveProjectFilePath(msg.filePath, projectRoot);
    if (!resolvedPath) {
      throw new Error(`Could not resolve project file path: ${msg.filePath}`);
    }
    const prevContent = fs.readFileSync(resolvedPath, "utf-8");
    const undoId = randomUUID();

    try {
      const newSource = reorderComponent(
        resolvedPath,
        msg.fromLine,
        msg.toLine
      );
      fs.writeFileSync(resolvedPath, newSource, "utf-8");
      undoStack.push({
        id: undoId,
        filePath: resolvedPath,
        content: prevContent,
        afterContent: newSource,
        timestamp: Date.now(),
      });
      send(ws, { type: "reorderComplete", success: true });
    } catch (error) {
      send(ws, {
        type: "reorderComplete",
        success: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  async function handleMoveSibling(
    msg: Extract<ClientMessage, { type: "moveSibling" }>,
    ws: WebSocket
  ) {
    if (!isProjectFilePathSafe(msg.filePath, projectRoot)) {
      const error = msg.filePath.trim()
        ? "File path is outside the project root"
        : "File path could not be resolved for this element";
      logger.warn(`[ThemeLab] Rejected moveSibling path: ${msg.filePath}`);
      send(ws, { type: "moveSiblingComplete", success: false, error });
      return;
    }

    // Route through the batch engine so the element resolves via the full
    // chain (jsxPath → line:col → fuzzy className/nth), the same way class
    // edits land on the right node. A raw line match was too brittle.
    logger.debug(
      `[moveSibling] ${msg.filePath}:${msg.lineNumber} dir=${msg.direction} tag=${msg.tagName} class="${(msg.className || "").slice(0, 40)}"`
    );
    // Route through the AI orchestrator so a mis-resolved move (e.g. owner
    // stack points at card.tsx) can be located by the AI fallback. A direct
    // resolution applies; a map-template/instance resolution can't be
    // reordered (data-driven), so it just reports failure (no proposal).
    const batchResult = await executeBatchWithAi(
      [
        {
          op: "moveSibling" as const,
          file: msg.filePath,
          line: msg.lineNumber,
          col: msg.columnNumber,
          direction: msg.direction,
          componentName: msg.componentName,
          tagName: msg.tagName,
          className: msg.className,
          parentTagName: msg.parentTagName,
          parentClassName: msg.parentClassName,
          nthOfType: msg.nthOfType,
          id: msg.elementId,
          jsxKey: msg.jsxKey,
          text: msg.text,
          contextText: msg.contextText,
          jsxPath: msg.jsxPath,
        },
      ],
      projectRoot,
      aiOptionsFor(ws)
    );

    const [opResult] = batchResult.results;
    if (opResult?.success) {
      const undoId = randomUUID();
      for (const entry of batchResult.undoEntries) {
        undoStack.push({
          id: undoId,
          filePath: entry.filePath,
          content: entry.content,
          afterContent: entry.afterContent,
          timestamp: Date.now(),
        });
      }
      send(ws, { type: "moveSiblingComplete", success: true });
    } else if (batchResult.proposals?.length) {
      // AI found a list reorder (swap the source array) — confirm it.
      emitProposals(ws, batchResult.proposals);
      send(ws, {
        type: "moveSiblingComplete",
        success: false,
        pending: true,
      });
    } else {
      // A .map()-rendered item we couldn't map to an array can't be
      // reordered by swapping JSX — the order comes from the data.
      const isList = opResult?.aiKind === "map-template";
      send(ws, {
        type: "moveSiblingComplete",
        success: false,
        error: isList
          ? "This item is rendered from a list (.map) — reorder the array data to change its order, not the layout."
          : opResult?.error || "Unknown error",
      });
    }
  }

  function handleUndo(ws: WebSocket) {
    const entry = undoStack.pop();
    if (entry) {
      fs.writeFileSync(entry.filePath, entry.content, "utf-8");
      send(ws, { type: "undoComplete", success: true });
    } else {
      send(ws, {
        type: "undoComplete",
        success: false,
        error: "Nothing to undo",
      });
    }
  }

  async function handleUpdateProperty(
    msg: Extract<
      ClientMessage,
      { type: "updateProperty" } | { type: "updateProperties" }
    >,
    ws: WebSocket
  ) {
    if (!isProjectFilePathSafe(msg.filePath, projectRoot)) {
      const error = msg.filePath.trim()
        ? "File path is outside the project root"
        : "File path could not be resolved for this element";
      logger.warn(`[ThemeLab] Rejected property update path: ${msg.filePath}`);
      send(ws, { type: "updatePropertyComplete", success: false, error });
      return;
    }

    // Build updates array from either single or batch message
    const updates =
      msg.type === "updateProperty"
        ? [
            {
              tailwindPrefix: msg.tailwindPrefix,
              tailwindToken: msg.tailwindToken,
              value: msg.value,
              relatedPrefixes: msg.relatedPrefixes,
              classPattern: msg.classPattern,
              standalone: msg.standalone,
            },
          ]
        : msg.updates.map((u: (typeof msg.updates)[number]) => ({
            tailwindPrefix: u.tailwindPrefix,
            tailwindToken: u.tailwindToken,
            value: u.value,
            relatedPrefixes: u.relatedPrefixes,
            classPattern: u.classPattern,
            standalone: u.standalone,
          }));

    // Route through batch engine for the resolution chain (handles React 19 owner stack positions)
    logger.debug(
      `[updateProperty] ${msg.filePath}:${msg.lineNumber} tag=${msg.tagName} class="${(msg.className || "").slice(0, 40)}"`
    );
    const batchResult = await executeBatchWithAi(
      [
        {
          op: "updateClass" as const,
          file: msg.filePath,
          line: msg.lineNumber,
          col: msg.columnNumber,
          tagName: msg.tagName,
          className: msg.className,
          parentTagName: msg.parentTagName,
          parentClassName: msg.parentClassName,
          nthOfType: msg.nthOfType,
          id: msg.elementId,
          jsxPath: msg.jsxPath,
          fileMtime: msg.fileMtime,
          fileSize: msg.fileSize,
          updates,
        },
      ],
      projectRoot,
      aiOptionsFor(ws)
    );

    const [opResult] = batchResult.results;
    logger.debug(
      `[updateProperty] Result: ${opResult?.success ? "OK" : `FAIL: ${opResult?.error}`}`
    );
    if (opResult?.success) {
      const undoId = randomUUID();
      for (const entry of batchResult.undoEntries) {
        undoStack.push({
          id: undoId,
          filePath: entry.filePath,
          content: entry.content,
          afterContent: entry.afterContent,
          timestamp: Date.now(),
        });
      }
      send(ws, { type: "updatePropertyComplete", success: true, undoId });
    } else {
      const errorCode = extractErrorCode(
        opResult?.error ? new Error(opResult.error) : undefined
      );
      send(ws, {
        type: "updatePropertyComplete",
        success: false,
        error: opResult?.error || "Unknown error",
        errorCode,
      });
    }
    emitProposals(ws, batchResult.proposals);
  }

  async function handleUpdateText(
    msg: Extract<ClientMessage, { type: "updateText" }>,
    ws: WebSocket
  ) {
    if (!isProjectFilePathSafe(msg.filePath, projectRoot)) {
      const error = msg.filePath.trim()
        ? "File path is outside the project root"
        : "File path could not be resolved for this element";
      logger.warn(`[ThemeLab] Rejected text update path: ${msg.filePath}`);
      send(ws, { type: "updateTextComplete", success: false, error });
      return;
    }
    // Route through batch engine for the resolution chain
    const textBatchResult = await executeBatchWithAi(
      [
        {
          op: "updateText" as const,
          file: msg.filePath,
          line: msg.lineNumber,
          col: msg.columnNumber,
          tagName: msg.tagName,
          className: msg.className,
          parentTagName: msg.parentTagName,
          parentClassName: msg.parentClassName,
          nthOfType: msg.nthOfType,
          id: msg.elementId,
          jsxPath: msg.jsxPath,
          fileMtime: msg.fileMtime,
          fileSize: msg.fileSize,
          originalText: msg.originalText,
          newText: msg.newText,
          textAnchor: msg.textAnchor,
        },
      ],
      projectRoot,
      aiOptionsFor(ws)
    );

    const [textResult] = textBatchResult.results;
    if (textResult?.success) {
      const undoId = randomUUID();
      for (const entry of textBatchResult.undoEntries) {
        undoStack.push({
          id: undoId,
          filePath: entry.filePath,
          content: entry.content,
          afterContent: entry.afterContent,
          timestamp: Date.now(),
        });
      }
      send(ws, { type: "updateTextComplete", success: true, undoId });
    } else {
      const reason = textResult?.error?.includes("No matching text")
        ? "no-match"
        : undefined;
      send(ws, {
        type: "updateTextComplete",
        success: false,
        error: textResult?.error,
        reason,
      });
    }
    emitProposals(ws, textBatchResult.proposals);
  }

  async function handleCommitBatch(
    msg: Extract<ClientMessage, { type: "commitBatch" }>,
    ws: WebSocket
  ) {
    logBatchStart(msg.operations);
    try {
      const batchResult = await executeBatchWithAi(
        msg.operations,
        projectRoot,
        {
          ...aiOptionsFor(ws),
          forceAi: msg.forceAi,
        }
      );
      logBatchResult(batchResult.results);

      // Create undo entries for each file that was modified
      const batchUndoIds: string[] = [];
      for (const entry of batchResult.undoEntries) {
        const undoId = randomUUID();
        undoStack.push({
          id: undoId,
          filePath: entry.filePath,
          content: entry.content,
          afterContent: entry.afterContent,
          timestamp: Date.now(),
        });
        batchUndoIds.push(undoId);
      }

      // Map undo IDs to per-op results
      const resultsWithUndo = attachUndoIdsToBatchResults(
        batchResult.results,
        batchResult.undoEntries,
        batchUndoIds,
        projectRoot
      );

      const allSuccess = batchResult.results.every((r) => r.success);
      send(ws, {
        type: "commitBatchComplete",
        success: allSuccess,
        results: resultsWithUndo,
        undoIds: batchUndoIds,
      });
      emitProposals(ws, batchResult.proposals);
    } catch (error) {
      logBatchException(error);
      send(ws, {
        type: "commitBatchComplete",
        success: false,
        results: msg.operations.map((op: BatchOperation) => ({
          op: op.op,
          file: op.file,
          line: op.op === "reorder" ? op.fromLine : op.line,
          success: false,
          error: error instanceof Error ? error.message : String(error),
        })),
        undoIds: [],
      });
    }
  }

  function handleConfirmResolution(
    msg: Extract<ClientMessage, { type: "confirmResolution" }>,
    ws: WebSocket
  ) {
    const proposal = pendingProposals.get(msg.id);
    pendingProposals.delete(msg.id);
    if (!proposal) {
      send(ws, {
        type: "aiProposalComplete",
        id: msg.id,
        success: false,
        error: "Proposal expired",
      });
      return;
    }
    if (!msg.accept) {
      send(ws, {
        type: "aiProposalComplete",
        id: msg.id,
        success: false,
        error: "Declined",
      });
      return;
    }
    // Apply the confirmed location deterministically (no second AI call).
    // Drop the staleness baseline — it was captured for the original
    // (often wrong) file; the AI resolved against the target's fresh state.
    const { op, target } = proposal;
    const rerun = executeBatch(
      [
        {
          ...op,
          file: target.filePath,
          line: target.line,
          col: target.col,
          fileMtime: undefined,
          fileSize: undefined,
          trustLocation: true,
        } as BatchOperation,
      ],
      projectRoot
    );
    const [rr] = rerun.results;
    if (rr?.success) {
      const undoId = randomUUID();
      for (const entry of rerun.undoEntries) {
        undoStack.push({
          id: undoId,
          filePath: entry.filePath,
          content: entry.content,
          afterContent: entry.afterContent,
          timestamp: Date.now(),
        });
      }
      send(ws, {
        type: "aiProposalComplete",
        id: msg.id,
        success: true,
        undoId,
        kind: target.kind,
        filePath: target.filePath,
      });
    } else {
      invalidateLocateCache(op); // apply failed — drop cache so a retry re-resolves
      send(ws, {
        type: "aiProposalComplete",
        id: msg.id,
        success: false,
        error: rr?.error || "Could not apply at resolved location",
      });
    }
  }

  async function handleOptimizeResponsive(
    msg: Extract<ClientMessage, { type: "optimizeResponsive" }>,
    ws: WebSocket
  ) {
    // Gate on a configured key — mirror the locator. No key → toast, no call.
    const optimizeApiKey = aiOptions.apiKey;
    if (!aiOptions.enableAi || !optimizeApiKey) {
      send(ws, {
        type: "optimizeProposalComplete",
        id: "",
        success: false,
        error: "Set ANTHROPIC_API_KEY to use Optimize for mobile.",
      });
      return;
    }
    try {
      const resolved = resolveProjectFilePath(msg.filePath, projectRoot);
      if (!resolved || !isProjectFilePathSafe(msg.filePath, projectRoot)) {
        send(ws, {
          type: "optimizeProposalComplete",
          id: "",
          success: false,
          error: "Could not resolve source file",
        });
        return;
      }
      const src = fs.readFileSync(resolved, "utf-8");
      const lines = src.split("\n");
      const snippet =
        lines[Math.max(0, msg.lineNumber - 1)]?.slice(0, 400) ?? "";
      const screens: Record<string, string> = {};
      for (const [name, minWidth] of Object.entries(
        currentTokens?.screens ?? {}
      )) {
        screens[name] = String(minWidth);
      }

      const input: OptimizeInput = {
        filePath: msg.filePath,
        line: msg.lineNumber,
        col: msg.columnNumber - 1,
        oldClassName: msg.className ?? "",
        snippet,
        screens,
        viewportWidth: msg.viewportWidth,
        projectRoot,
      };
      const outcome = await generateMobileFirstClassName(input, {
        apiKey: optimizeApiKey,
        baseURL: aiOptions.baseURL,
        model: aiOptions.model,
        escalation: aiOptions.escalation?.enabled
          ? { enabled: true, model: aiOptions.escalation.model }
          : { enabled: false },
        onEscalate: (tier) => send(ws, { type: "aiResolving", tier }),
      });
      if (!outcome || !("newClassName" in outcome)) {
        const reason =
          outcome && "cannotGenerate" in outcome
            ? outcome.cannotGenerate
            : "couldn't generate a mobile-first className.";
        send(ws, {
          type: "optimizeProposalComplete",
          id: "",
          success: false,
          error: reason,
        });
        return;
      }
      const id = randomUUID();
      pendingOptimize.set(id, {
        ...outcome,
        filePath: msg.filePath,
        line: msg.lineNumber,
        col: msg.columnNumber - 1,
      });
      send(ws, {
        type: "optimizeProposal",
        id,
        filePath: msg.filePath,
        line: msg.lineNumber,
        oldClassName: msg.className ?? "",
        newClassName: outcome.newClassName,
        reasoning: outcome.reasoning,
      });
    } catch (error) {
      send(ws, {
        type: "optimizeProposalComplete",
        id: "",
        success: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  function handleConfirmOptimize(
    msg: Extract<ClientMessage, { type: "confirmOptimize" }>,
    ws: WebSocket
  ) {
    const proposal = pendingOptimize.get(msg.id);
    pendingOptimize.delete(msg.id);
    if (!proposal) {
      send(ws, {
        type: "optimizeProposalComplete",
        id: msg.id,
        success: false,
        error: "Proposal expired",
      });
      return;
    }
    if (!msg.accept) {
      send(ws, {
        type: "optimizeProposalComplete",
        id: msg.id,
        success: false,
        error: "Declined",
      });
      return;
    }
    // Apply the confirmed className via the location-locked replaceClassName
    // op — no second AI call.
    const op: BatchOperation = {
      op: "replaceClassName",
      file: proposal.filePath,
      line: proposal.line,
      col: proposal.col,
      className: proposal.newClassName,
    };
    const rerun = executeBatch([op], projectRoot);
    const [rr] = rerun.results;
    if (rr?.success) {
      const undoId = randomUUID();
      for (const entry of rerun.undoEntries) {
        undoStack.push({
          id: undoId,
          filePath: entry.filePath,
          content: entry.content,
          afterContent: entry.afterContent,
          timestamp: Date.now(),
        });
      }
      send(ws, {
        type: "optimizeProposalComplete",
        id: msg.id,
        success: true,
        undoId,
      });
    } else {
      send(ws, {
        type: "optimizeProposalComplete",
        id: msg.id,
        success: false,
        error: rr?.error || "Could not apply the optimized className",
      });
    }
  }

  function handleSaveSettings(
    msg: Extract<ClientMessage, { type: "saveSettings" }>,
    ws: WebSocket
  ) {
    updateAiConfig(msg.ai);
    aiOptions = buildAiOptions();
    logger.info(
      `[ThemeLab] AI settings updated (enabled=${aiOptions.enableAi})`
    );
    const cfg = resolveAiConfig();
    send(ws, {
      type: "settings",
      ai: {
        enabled: cfg.enabled,
        hasApiKey: !!cfg.apiKey,
        baseURL: cfg.baseURL,
        model: cfg.model,
        escalationEnabled: cfg.escalationEnabled,
        escalationModel: cfg.escalationModel,
        source: cfg.source,
      },
    });
  }

  function handleRevertChanges(
    msg: Extract<ClientMessage, { type: "revertChanges" }>,
    ws: WebSocket
  ) {
    const results: {
      undoId: string;
      success: boolean;
      error?: string;
    }[] = [];

    // Collect found entries
    const entriesById = new Map<string, UndoEntry>();
    for (const id of msg.undoIds) {
      const entry = undoStack.find((e) => e.id === id);
      if (entry) {
        entriesById.set(id, entry);
      } else {
        results.push({
          undoId: id,
          success: false,
          error: "Undo entry not found",
        });
      }
    }

    // Group by file path for coalesced revert
    const byFile = new Map<string, { id: string; entry: UndoEntry }[]>();
    for (const [id, entry] of entriesById) {
      const group = byFile.get(entry.filePath) || [];
      group.push({ id, entry });
      byFile.set(entry.filePath, group);
    }

    // Process each file group
    for (const [filePath, group] of byFile) {
      // Sort by timestamp descending (most recent first)
      group.sort((a, b) => b.entry.timestamp - a.entry.timestamp);

      try {
        const currentContent = fs.readFileSync(filePath, "utf-8");
        // Check most recent entry's afterContent against current file
        const mostRecent = group[0].entry;
        if (currentContent !== mostRecent.afterContent) {
          for (const { id } of group) {
            results.push({
              undoId: id,
              success: false,
              error: "File has changed since this edit",
            });
          }
          continue;
        }

        // Write back the earliest entry's beforeContent (restores original state)
        const earliest = group.at(-1)?.entry;
        if (!earliest) {
          continue;
        }
        fs.writeFileSync(filePath, earliest.content, "utf-8");

        for (const { id, entry } of group) {
          entry.reverted = true;
          results.push({ undoId: id, success: true });
        }
      } catch (error) {
        for (const { id } of group) {
          results.push({
            undoId: id,
            success: false,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
    }

    send(ws, { type: "revertComplete", results });
  }

  async function processQueue() {
    if (processing || queue.length === 0) {
      return;
    }
    processing = true;

    const next = queue.shift();
    if (!next) {
      processing = false;
      return;
    }
    const { msg, ws } = next;

    try {
      switch (msg.type) {
        case "updateTheme": {
          handleUpdateTheme(msg, ws);
          break;
        }
        case "reorder": {
          handleReorder(msg, ws);
          break;
        }
        case "moveSibling": {
          await handleMoveSibling(msg, ws);
          break;
        }
        case "undo": {
          handleUndo(ws);
          break;
        }
        case "updateProperty":
        case "updateProperties": {
          await handleUpdateProperty(msg, ws);
          break;
        }
        case "updateText": {
          await handleUpdateText(msg, ws);
          break;
        }
        case "commitBatch": {
          await handleCommitBatch(msg, ws);
          break;
        }
        case "confirmResolution": {
          handleConfirmResolution(msg, ws);
          break;
        }
        case "optimizeResponsive": {
          await handleOptimizeResponsive(msg, ws);
          break;
        }
        case "confirmOptimize": {
          handleConfirmOptimize(msg, ws);
          break;
        }
        case "saveSettings": {
          handleSaveSettings(msg, ws);
          break;
        }
        case "revertChanges": {
          handleRevertChanges(msg, ws);
          break;
        }
        default: {
          // A type is in WRITE_MESSAGE_TYPES but has no handler here — loud, not
          // silent, so this drift is caught immediately instead of vanishing.
          logger.error(
            `[ThemeLab] Queued write message has no handler: ${(msg as { type?: string }).type}`
          );
        }
      }
    } catch (error) {
      // Catch-all for unexpected errors
      logger.error("Error processing message:", error);
    }

    processing = false;
    processQueue(); // Process next in queue
  }

  wss.on("connection", (ws) => {
    // Single client policy: close previous connection
    if (activeClient && activeClient.readyState === WebSocket.OPEN) {
      activeClient.close(4001, "replaced by new connection");
    }
    activeClient = ws;

    // Resolve and send Tailwind tokens
    try {
      const config = resolveTailwindConfig(projectRoot);
      currentTokens = config.tokens;
      send(ws, { type: "tailwindTokens", tokens: config.tokens });
    } catch (error) {
      logger.warn("[ThemeLab] Could not resolve Tailwind config:", error);
    }

    // Resolve and send the project's design-token theme (for Theme mode)
    try {
      const resolved = resolveTheme(projectRoot);
      if (resolved) {
        currentTheme = { theme: resolved.theme, source: resolved.source };
        onThemeChange?.(currentTheme);
        send(ws, {
          type: "themeStyles",
          theme: resolved.theme,
          source: resolved.source,
        });
        logger.debug(
          `[theme] ${path.relative(projectRoot, resolved.source.filePath)} — ` +
            `${Object.keys(resolved.theme.light).length} light / ${Object.keys(resolved.theme.dark).length} dark vars` +
            `${resolved.source.darkSelector ? ` (dark: ${resolved.source.darkSelector})` : ""}`
        );
      }
    } catch (error) {
      logger.warn("[ThemeLab] Could not resolve theme:", error);
    }

    ws.on("message", (data) => {
      let msg: ClientMessage;
      try {
        msg = JSON.parse(data.toString());
      } catch {
        return; // Ignore malformed messages
      }

      // Mutating messages → sequential queue (single source of truth above).
      if (WRITE_MESSAGE_TYPES.has(msg.type)) {
        queue.push({ msg, ws });
        processQueue();
        return;
      }

      switch (msg.type) {
        case "ping": {
          send(ws, { type: "pong" });
          break;
        }

        case "setSelection": {
          // Overlay reported a selection change — store it for MCP reads. No reply.
          currentSelection = msg.selection;
          onSelectionChange?.(currentSelection);
          break;
        }

        case "getSettings": {
          const cfg = resolveAiConfig();
          send(ws, {
            type: "settings",
            ai: {
              enabled: cfg.enabled,
              hasApiKey: !!cfg.apiKey,
              baseURL: cfg.baseURL,
              model: cfg.model,
              escalationEnabled: cfg.escalationEnabled,
              escalationModel: cfg.escalationModel,
              source: cfg.source,
            },
          });
          break;
        }

        case "getSiblings": {
          // Can run concurrently (read-only)
          if (!isProjectFilePathSafe(msg.filePath, projectRoot)) {
            logger.warn(`[ThemeLab] Rejected siblings path: ${msg.filePath}`);
            send(ws, { type: "siblingsList", siblings: [] });
            break;
          }
          try {
            const resolvedSiblingsPath = resolveProjectFilePath(
              msg.filePath,
              projectRoot
            );
            if (!resolvedSiblingsPath) {
              send(ws, { type: "siblingsList", siblings: [] });
              break;
            }
            const siblings = getSiblings(resolvedSiblingsPath, msg.parentLine);
            send(ws, { type: "siblingsList", siblings });
          } catch {
            send(ws, { type: "siblingsList", siblings: [] });
          }
          break;
        }

        case "discoverFile": {
          // Async — won't block the event loop during grep
          void (async () => {
            const filePath = await discoverFile(msg.componentName, projectRoot);
            send(ws, {
              type: "discoverFileResult",
              componentName: msg.componentName,
              filePath,
            });
          })();
          break;
        }

        case "fileStat": {
          if (!isProjectFilePathSafe(msg.filePath, projectRoot)) {
            send(ws, {
              type: "fileStatResult",
              filePath: msg.filePath,
              mtime: 0,
              size: 0,
            });
            break;
          }
          const resolvedStatPath = resolveProjectFilePath(
            msg.filePath,
            projectRoot
          );
          if (!resolvedStatPath) {
            send(ws, {
              type: "fileStatResult",
              filePath: msg.filePath,
              mtime: 0,
              size: 0,
            });
            break;
          }
          try {
            const stat = fs.statSync(resolvedStatPath);
            send(ws, {
              type: "fileStatResult",
              filePath: msg.filePath,
              mtime: stat.mtimeMs,
              size: stat.size,
            });
          } catch {
            send(ws, {
              type: "fileStatResult",
              filePath: msg.filePath,
              mtime: 0,
              size: 0,
            });
          }
          break;
        }

        default: {
          // Write types are intercepted above; anything here is unrecognized.
          logger.debug(
            `[ThemeLab] Ignoring unrecognized message type: ${(msg as { type?: string }).type}`
          );
        }
      }
    });

    ws.on("close", () => {
      if (ws === activeClient) {
        activeClient = null;
        undoStack.length = 0; // Clear undo stack on disconnect
        queue.length = 0;
        currentSelection = null; // Stale once the overlay is gone
        onSelectionChange?.(null);
      }
    });
  });

  return {
    wss,
    close: () => wss.close(),
    getActiveClient: () => activeClient,
    getSelection: () => currentSelection,
    getTheme: () => currentTheme,
    getTailwindTokens: () => currentTokens,
    discoverComponentFile: (componentName: string) =>
      discoverFile(componentName, projectRoot),
    isOverlayConnected: () =>
      activeClient !== null && activeClient.readyState === WebSocket.OPEN,
  };
}
