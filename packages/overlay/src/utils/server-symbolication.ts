// packages/overlay/src/utils/server-symbolication.ts
//
// Next.js React Server Component frame symbolication, adapted from react-grab
// (https://github.com/aidenybai/react-grab). Server components produce virtual
// stack-frame URLs ("rsc://React/Server/webpack-internal:///...") that point at
// no real file, so owner-stack frames for RSC-rendered elements lose their
// source location — which the CLI's AST transforms depend on. The Next.js dev
// server (>=15.2) exposes a batched endpoint that resolves such frames back to
// original source locations via source maps. Since ThemeLab reverse-proxies the
// dev server, a same-origin fetch reaches it directly.

import { traverseFiber, type Fiber } from "bippy";
import {
  getOwnerStack,
  formatOwnerStack,
  hasDebugStack,
  parseStack,
  type StackFrame,
} from "bippy/source";
import { isServerComponentUrl, devirtualizeServerUrl } from "./source-resolve.js";

const SYMBOLICATION_TIMEOUT_MS = 5000;

let cachedIsNextProject: boolean | undefined;

function isNextProjectRuntime(): boolean {
  cachedIsNextProject ??= Boolean(
    document.getElementById("__NEXT_DATA__") || document.querySelector("nextjs-portal"),
  );
  return cachedIsNextProject;
}

let cachedNextBasePath: string | undefined;

// Next.js does not expose basePath at runtime (it is a build-time define that
// only compiled app code can access). Detect it the way Next.js's own
// asset-prefix.ts does: find a script whose src contains "/_next/" and take
// the path prefix before that marker. When basePath is "/app", scripts load
// from "/app/_next/…"; when unset, from "/_next/…" → empty string.
function getNextBasePath(): string {
  if (cachedNextBasePath !== undefined) return cachedNextBasePath;
  const source = document.querySelector<HTMLScriptElement>('script[src*="/_next/"]')?.src;
  const pathname = source ? new URL(source).pathname : "";
  const assetPathIndex = pathname.indexOf("/_next/");
  cachedNextBasePath = assetPathIndex > 0 ? pathname.slice(0, assetPathIndex) : "";
  return cachedNextBasePath;
}

interface NextJsOriginalFrame {
  file: string | null;
  line1: number | null;
  column1: number | null;
  ignored: boolean;
}

interface NextJsFrameResult {
  status: string;
  value?: { originalStackFrame: NextJsOriginalFrame | null };
}

interface NextJsRequestFrame {
  file: string;
  methodName: string;
  line1: number | null;
  column1: number | null;
  arguments: string[];
}

/** POST server frames to the Next.js dev symbolication endpoint, merging the
 *  resolved original locations back into the frame list. Returns the input
 *  unchanged on any failure — callers fall back to devirtualized paths. */
async function symbolicateServerFrames(frames: StackFrame[]): Promise<StackFrame[]> {
  const serverFrameIndices: number[] = [];
  const requestFrames: NextJsRequestFrame[] = [];

  for (let frameIndex = 0; frameIndex < frames.length; frameIndex++) {
    const frame = frames[frameIndex];
    if (!frame.isServer || !frame.fileName) continue;

    serverFrameIndices.push(frameIndex);
    requestFrames.push({
      file: devirtualizeServerUrl(frame.fileName),
      methodName: frame.functionName ?? "<unknown>",
      line1: frame.lineNumber ?? null,
      column1: frame.columnNumber ?? null,
      arguments: [],
    });
  }

  if (requestFrames.length === 0) return frames;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), SYMBOLICATION_TIMEOUT_MS);

  try {
    const response = await fetch(`${getNextBasePath()}/__nextjs_original-stack-frames`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        frames: requestFrames,
        isServer: true,
        isEdgeServer: false,
        isAppDirectory: true,
      }),
      signal: controller.signal,
    });

    if (!response.ok) return frames;

    const results = (await response.json()) as NextJsFrameResult[];
    const resolvedFrames = [...frames];

    for (let resultIndex = 0; resultIndex < serverFrameIndices.length; resultIndex++) {
      const result = results[resultIndex];
      if (result?.status !== "fulfilled") continue;

      const resolved = result.value?.originalStackFrame;
      if (!resolved?.file || resolved.ignored) continue;

      const originalFrameIndex = serverFrameIndices[resultIndex];
      resolvedFrames[originalFrameIndex] = {
        ...frames[originalFrameIndex],
        fileName: resolved.file,
        lineNumber: resolved.line1 ?? undefined,
        columnNumber: resolved.column1 ?? undefined,
      };
    }

    return resolvedFrames;
  } catch {
    return frames;
  } finally {
    clearTimeout(timeout);
  }
}

/** Collect server-component frames (by function name) from _debugStack across
 *  the fiber subtree — fills in locations getOwnerStack couldn't resolve. */
function extractServerFramesFromDebugStack(rootFiber: Fiber): Map<string, StackFrame> {
  const serverFramesByName = new Map<string, StackFrame>();

  traverseFiber(
    rootFiber,
    (currentFiber) => {
      if (!hasDebugStack(currentFiber)) return false;

      const ownerStack = formatOwnerStack(currentFiber._debugStack.stack);
      if (!ownerStack) return false;

      for (const frame of parseStack(ownerStack)) {
        if (!frame.functionName || !frame.fileName) continue;
        if (!isServerComponentUrl(frame.fileName)) continue;
        if (serverFramesByName.has(frame.functionName)) continue;

        serverFramesByName.set(frame.functionName, { ...frame, isServer: true });
      }
      return false;
    },
    true,
  );

  return serverFramesByName;
}

function enrichServerFrameLocations(rootFiber: Fiber, frames: StackFrame[]): StackFrame[] {
  const hasUnresolvedServerFrames = frames.some(
    (frame) => frame.isServer && !frame.fileName && frame.functionName,
  );
  if (!hasUnresolvedServerFrames) return frames;

  const serverFramesByName = extractServerFramesFromDebugStack(rootFiber);
  if (serverFramesByName.size === 0) return frames;

  return frames.map((frame) => {
    if (!frame.isServer || frame.fileName || !frame.functionName) return frame;
    const resolved = serverFramesByName.get(frame.functionName);
    if (!resolved) return frame;
    return {
      ...frame,
      fileName: resolved.fileName,
      lineNumber: resolved.lineNumber,
      columnNumber: resolved.columnNumber,
    };
  });
}

/**
 * Drop-in replacement for bippy/source's getOwnerStack that additionally
 * resolves Next.js server-component frames to real source locations.
 * On non-Next.js apps this is exactly getOwnerStack.
 *
 * `fetchFn` is bippy's bundle/source-map fetch hook (see source-fetch-queue.ts):
 * passing the queue's abort signal lets a stuck resolution be cancelled rather
 * than hang behind a saturated connection pool.
 */
export async function getResolvedOwnerStack(
  fiber: Fiber,
  fetchFn?: (url: string) => Promise<Response>,
): Promise<StackFrame[]> {
  const frames = await getOwnerStack(fiber, true, fetchFn);
  if (!frames || frames.length === 0 || !isNextProjectRuntime()) return frames;

  const enrichedFrames = enrichServerFrameLocations(fiber, frames);
  return symbolicateServerFrames(enrichedFrames);
}
