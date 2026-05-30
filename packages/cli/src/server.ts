// packages/cli/src/server.ts
import { WebSocketServer, WebSocket } from "ws";
import * as fs from "node:fs";
import * as path from "node:path";
import { randomUUID } from "node:crypto";
import type {
  BatchOperation,
  ClientMessage,
  ServerMessage,
  UndoEntry,
  TransformErrorCode,
  TailwindTokenMap,
} from "@react-rewrite/shared";
import { reorderComponent, getSiblings } from "./transform.js";
import { updateClassName, updateTextContent } from "./transform.js";
import { logger } from "./logger.js";
import { resolveTailwindConfig } from "./tailwind-resolver.js";
import { resolveTheme } from "./theme-resolver.js";
import { writeThemeVars } from "./theme-writer.js";
import { isProjectFilePathSafe, resolveProjectFilePath } from "./path-resolver.js";
import { discoverFile } from "./file-discovery.js";
import { executeBatch } from "./batch-transform.js";

interface SketchServerOptions {
  port: number;
}

interface SketchServer {
  wss: WebSocketServer;
  close: () => void;
  getActiveClient: () => WebSocket | null;
}

export function attachUndoIdsToBatchResults(
  results: Array<{ op: BatchOperation["op"]; file: string; line: number; success: boolean; error?: string }>,
  undoEntries: Array<{ filePath: string; content: string; afterContent: string }>,
  undoIds: string[],
  projectRoot: string,
) {
  const undoIdByFile = new Map<string, string>();
  undoEntries.forEach((entry, index) => {
    const resolved = path.resolve(projectRoot, entry.filePath);
    const undoId = undoIds[index];
    if (undoId) undoIdByFile.set(resolved, undoId);
  });

  return results.map((result) => {
    const resolvedResultPath = path.resolve(projectRoot, result.file);
    return {
      ...result,
      undoId: result.success ? undoIdByFile.get(resolvedResultPath) : undefined,
    };
  });
}

export function createSketchServer(portOrOptions: number | SketchServerOptions): SketchServer {
  const port = typeof portOrOptions === "number" ? portOrOptions : portOrOptions.port;
  const wss = new WebSocketServer({ port });
  const projectRoot = path.resolve(process.cwd());
  const undoStack: UndoEntry[] = [];
  let activeClient: WebSocket | null = null;
  let processing = false;
  const queue: Array<{ msg: ClientMessage; ws: WebSocket }> = [];

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
  ]);

  function extractErrorCode(err: unknown): TransformErrorCode | undefined {
    if (err instanceof Error) {
      const match = err.message.match(/^(DYNAMIC_CLASSNAME|FILE_CHANGED|MAPPED_ELEMENT|CONFLICTING_CLASS|AMBIGUOUS)/);
      if (match) return match[1] as TransformErrorCode;
    }
    return undefined;
  }

  function send(ws: WebSocket, msg: ServerMessage) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(msg));
    }
  }

  async function processQueue() {
    if (processing || queue.length === 0) return;
    processing = true;

    const { msg, ws } = queue.shift()!;

    try {
      switch (msg.type) {
        case "updateTheme": {
          if (!isProjectFilePathSafe(msg.filePath, projectRoot)) {
            logger.warn(`[ReactRewrite] Rejected theme write path: ${msg.filePath}`);
            send(ws, { type: "updateThemeComplete", success: false, error: "Theme file path is outside the project root" });
            break;
          }
          const resolvedPath = resolveProjectFilePath(msg.filePath, projectRoot)!;
          const result = writeThemeVars(resolvedPath, msg.edits);
          if (!result.success) {
            send(ws, { type: "updateThemeComplete", success: false, error: result.error });
            break;
          }
          let undoId: string | undefined;
          if (result.before !== result.after) {
            undoId = randomUUID();
            undoStack.push({ id: undoId, filePath: resolvedPath, content: result.before!, afterContent: result.after!, timestamp: Date.now() });
          }
          logger.debug(`[theme] wrote ${msg.edits.reduce((n, e) => n + Object.keys(e.vars).length, 0)} var(s) to ${path.relative(projectRoot, resolvedPath)}`);
          send(ws, { type: "updateThemeComplete", success: true, undoId });
          break;
        }
        case "reorder": {
          if (!isProjectFilePathSafe(msg.filePath, projectRoot)) {
            const error = msg.filePath.trim()
              ? "File path is outside the project root"
              : "File path could not be resolved for this element";
            logger.warn(`[ReactRewrite] Rejected reorder path: ${msg.filePath}`);
            send(ws, { type: "reorderComplete", success: false, error });
            break;
          }
          const resolvedPath = resolveProjectFilePath(msg.filePath, projectRoot)!;
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
          } catch (err) {
            send(ws, {
              type: "reorderComplete",
              success: false,
              error: err instanceof Error ? err.message : String(err),
            });
          }
          break;
        }

        case "moveSibling": {
          if (!isProjectFilePathSafe(msg.filePath, projectRoot)) {
            const error = msg.filePath.trim()
              ? "File path is outside the project root"
              : "File path could not be resolved for this element";
            logger.warn(`[ReactRewrite] Rejected moveSibling path: ${msg.filePath}`);
            send(ws, { type: "moveSiblingComplete", success: false, error });
            break;
          }

          // Route through the batch engine so the element resolves via the full
          // chain (jsxPath → line:col → fuzzy className/nth), the same way class
          // edits land on the right node. A raw line match was too brittle.
          logger.debug(`[moveSibling] ${msg.filePath}:${msg.lineNumber} dir=${msg.direction} tag=${msg.tagName} class="${(msg.className || "").slice(0, 40)}"`);
          const batchResult = executeBatch(
            [{
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
              jsxPath: msg.jsxPath,
            }],
            projectRoot,
          );

          const opResult = batchResult.results[0];
          if (opResult?.success) {
            const undoId = randomUUID();
            for (const entry of batchResult.undoEntries) {
              undoStack.push({ id: undoId, filePath: entry.filePath, content: entry.content, afterContent: entry.afterContent, timestamp: Date.now() });
            }
            send(ws, { type: "moveSiblingComplete", success: true });
          } else {
            send(ws, { type: "moveSiblingComplete", success: false, error: opResult?.error || "Unknown error" });
          }
          break;
        }

        case "undo": {
          const entry = undoStack.pop();
          if (!entry) {
            send(ws, {
              type: "undoComplete",
              success: false,
              error: "Nothing to undo",
            });
          } else {
            fs.writeFileSync(entry.filePath, entry.content, "utf-8");
            send(ws, { type: "undoComplete", success: true });
          }
          break;
        }

        case "updateProperty":
        case "updateProperties": {
          if (!isProjectFilePathSafe(msg.filePath, projectRoot)) {
            const error = msg.filePath.trim()
              ? "File path is outside the project root"
              : "File path could not be resolved for this element";
            logger.warn(`[ReactRewrite] Rejected property update path: ${msg.filePath}`);
            send(ws, { type: "updatePropertyComplete", success: false, error });
            break;
          }

          // Build updates array from either single or batch message
          const updates = msg.type === "updateProperty"
            ? [{
                tailwindPrefix: msg.tailwindPrefix,
                tailwindToken: msg.tailwindToken,
                value: msg.value,
                relatedPrefixes: msg.relatedPrefixes,
                classPattern: msg.classPattern,
                standalone: msg.standalone,
              }]
            : msg.updates.map((u: typeof msg.updates[number]) => ({
                tailwindPrefix: u.tailwindPrefix,
                tailwindToken: u.tailwindToken,
                value: u.value,
                relatedPrefixes: u.relatedPrefixes,
                classPattern: u.classPattern,
                standalone: u.standalone,
              }));

          // Route through batch engine for the resolution chain (handles React 19 owner stack positions)
          logger.debug(`[updateProperty] ${msg.filePath}:${msg.lineNumber} tag=${msg.tagName} class="${(msg.className || "").slice(0, 40)}"`);
          const batchResult = executeBatch(
            [{
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
            }],
            projectRoot,
          );

          const opResult = batchResult.results[0];
          logger.debug(`[updateProperty] Result: ${opResult?.success ? "OK" : "FAIL: " + opResult?.error}`);
          if (opResult?.success) {
            const undoId = randomUUID();
            for (const entry of batchResult.undoEntries) {
              undoStack.push({ id: undoId, filePath: entry.filePath, content: entry.content, afterContent: entry.afterContent, timestamp: Date.now() });
            }
            send(ws, { type: "updatePropertyComplete", success: true, undoId });
          } else {
            const errorCode = extractErrorCode(opResult?.error ? new Error(opResult.error) : undefined);
            send(ws, {
              type: "updatePropertyComplete",
              success: false,
              error: opResult?.error || "Unknown error",
              errorCode,
            });
          }
          break;
        }

        case "updateText": {
          if (!isProjectFilePathSafe(msg.filePath, projectRoot)) {
            const error = msg.filePath.trim()
              ? "File path is outside the project root"
              : "File path could not be resolved for this element";
            logger.warn(`[ReactRewrite] Rejected text update path: ${msg.filePath}`);
            send(ws, { type: "updateTextComplete", success: false, error });
            break;
          }
          // Route through batch engine for the resolution chain
          const textBatchResult = executeBatch(
            [{
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
            }],
            projectRoot,
          );

          const textResult = textBatchResult.results[0];
          if (textResult?.success) {
            const undoId = randomUUID();
            for (const entry of textBatchResult.undoEntries) {
              undoStack.push({ id: undoId, filePath: entry.filePath, content: entry.content, afterContent: entry.afterContent, timestamp: Date.now() });
            }
            send(ws, { type: "updateTextComplete", success: true, undoId });
          } else {
            const reason = textResult?.error?.includes("No matching text") ? "no-match" : undefined;
            send(ws, {
              type: "updateTextComplete",
              success: false,
              error: textResult?.error,
              reason,
            });
          }
          break;
        }

        case "commitBatch": {
          logger.info(`[commitBatch] Received ${msg.operations.length} operations:`, msg.operations.map((o: BatchOperation) => `${o.op}@${o.file}:${o.op === "reorder" ? o.fromLine : o.line}`));
          try {
            const batchResult = executeBatch(msg.operations, projectRoot);
            const failedOps = batchResult.results.filter(r => !r.success);
            if (failedOps.length > 0) {
              logger.error(`[commitBatch] ${failedOps.length}/${batchResult.results.length} operations failed:`);
              for (const r of failedOps) {
                logger.error(`  ${r.op}@${r.file}:${r.line} — ${r.error}`);
              }
            } else {
              logger.info(`[commitBatch] All ${batchResult.results.length} operations succeeded`);
            }

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
              projectRoot,
            );

            const allSuccess = batchResult.results.every(r => r.success);
            send(ws, {
              type: "commitBatchComplete",
              success: allSuccess,
              results: resultsWithUndo,
              undoIds: batchUndoIds,
            });
          } catch (err) {
            logger.error(`[commitBatch] Exception:`, err instanceof Error ? err.message : String(err));
            send(ws, {
              type: "commitBatchComplete",
              success: false,
              results: msg.operations.map((op: BatchOperation) => ({
                op: op.op,
                file: op.file,
                line: op.op === "reorder" ? op.fromLine : op.line,
                success: false,
                error: err instanceof Error ? err.message : String(err),
              })),
              undoIds: [],
            });
          }
          break;
        }

        case "revertChanges": {
          const results: Array<{ undoId: string; success: boolean; error?: string }> = [];

          // Collect found entries
          const entriesById = new Map<string, UndoEntry>();
          for (const id of msg.undoIds) {
            const entry = undoStack.find((e) => e.id === id);
            if (entry) {
              entriesById.set(id, entry);
            } else {
              results.push({ undoId: id, success: false, error: "Undo entry not found" });
            }
          }

          // Group by file path for coalesced revert
          const byFile = new Map<string, Array<{ id: string; entry: UndoEntry }>>();
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
                  results.push({ undoId: id, success: false, error: "File has changed since this edit" });
                }
                continue;
              }

              // Write back the earliest entry's beforeContent (restores original state)
              const earliest = group[group.length - 1].entry;
              fs.writeFileSync(filePath, earliest.content, "utf-8");

              for (const { id, entry } of group) {
                entry.reverted = true;
                results.push({ undoId: id, success: true });
              }
            } catch (err) {
              for (const { id } of group) {
                results.push({ undoId: id, success: false, error: err instanceof Error ? err.message : String(err) });
              }
            }
          }

          send(ws, { type: "revertComplete", results });
          break;
        }

        default:
          // A type is in WRITE_MESSAGE_TYPES but has no handler here — loud, not
          // silent, so this drift is caught immediately instead of vanishing.
          logger.error(`[ReactRewrite] Queued write message has no handler: ${(msg as { type?: string }).type}`);
      }
    } catch (err) {
      // Catch-all for unexpected errors
      logger.error("Error processing message:", err);
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
    let resolvedTokens: TailwindTokenMap | null = null;
    try {
      const config = resolveTailwindConfig(projectRoot);
      resolvedTokens = config.tokens;
      send(ws, { type: "tailwindTokens", tokens: config.tokens });
    } catch (err) {
      logger.warn("[ReactRewrite] Could not resolve Tailwind config:", err);
    }

    // Resolve and send the project's design-token theme (for Theme mode)
    try {
      const resolved = resolveTheme(projectRoot);
      if (resolved) {
        send(ws, { type: "themeStyles", theme: resolved.theme, source: resolved.source });
        logger.debug(
          `[theme] ${path.relative(projectRoot, resolved.source.filePath)} — ` +
            `${Object.keys(resolved.theme.light).length} light / ${Object.keys(resolved.theme.dark).length} dark vars` +
            `${resolved.source.darkSelector ? ` (dark: ${resolved.source.darkSelector})` : ""}`,
        );
      }
    } catch (err) {
      logger.warn("[ReactRewrite] Could not resolve theme:", err);
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
        case "ping":
          send(ws, { type: "pong" });
          break;

        case "getSiblings":
          // Can run concurrently (read-only)
          if (!isProjectFilePathSafe(msg.filePath, projectRoot)) {
            logger.warn(`[ReactRewrite] Rejected siblings path: ${msg.filePath}`);
            send(ws, { type: "siblingsList", siblings: [] });
            break;
          }
          try {
            const siblings = getSiblings(resolveProjectFilePath(msg.filePath, projectRoot)!, msg.parentLine);
            send(ws, { type: "siblingsList", siblings });
          } catch (err) {
            send(ws, { type: "siblingsList", siblings: [] });
          }
          break;

        case "discoverFile": {
          // Async — won't block the event loop during grep
          discoverFile(msg.componentName, projectRoot).then((filePath) => {
            send(ws, { type: "discoverFileResult", componentName: msg.componentName, filePath });
          });
          break;
        }

        case "fileStat": {
          if (!isProjectFilePathSafe(msg.filePath, projectRoot)) {
            send(ws, { type: "fileStatResult", filePath: msg.filePath, mtime: 0, size: 0 });
            break;
          }
          const resolvedStatPath = resolveProjectFilePath(msg.filePath, projectRoot);
          if (!resolvedStatPath) {
            send(ws, { type: "fileStatResult", filePath: msg.filePath, mtime: 0, size: 0 });
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
            send(ws, { type: "fileStatResult", filePath: msg.filePath, mtime: 0, size: 0 });
          }
          break;
        }

        default:
          // Write types are intercepted above; anything here is unrecognized.
          logger.debug(`[ReactRewrite] Ignoring unrecognized message type: ${(msg as { type?: string }).type}`);
      }
    });

    ws.on("close", () => {
      if (ws === activeClient) {
        activeClient = null;
        undoStack.length = 0; // Clear undo stack on disconnect
        queue.length = 0;
      }
    });
  });

  return {
    wss,
    close: () => wss.close(),
    getActiveClient: () => activeClient,
  };
}
