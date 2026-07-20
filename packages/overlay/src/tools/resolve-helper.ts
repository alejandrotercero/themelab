// packages/overlay/src/tools/resolve-helper.ts
import type { ComponentRef } from "@themelab/shared";
import {
  getFiberFromHostInstance,
  isCompositeFiber,
  getDisplayName,
} from "bippy";
import type { Fiber } from "bippy";

import { requestFileDiscovery } from "../bridge.js";
import {
  getCachedFilePath,
  setCachedFilePath,
} from "../file-discovery-cache.js";
import { getPageElementAtPoint } from "../interaction.js";
import {
  isInternalName,
  isMdxFilePath,
  isLibraryPath,
} from "../utils/component-filter.js";
import { getDebugSource } from "../utils/fiber-debug-source.js";
import { getResolvedOwnerStack } from "../utils/server-symbolication.js";
import { resolveFrameFilePath } from "../utils/source-resolve.js";

/**
 * Try resolving a component from React 19's owner stack (source-mapped).
 * Returns the first frame that names a user-level component with a usable,
 * non-library file path — or null if the owner stack yields nothing usable.
 */
async function resolveViaOwnerStack(
  fiber: Fiber
): Promise<ComponentRef | null> {
  try {
    const frames = await getResolvedOwnerStack(fiber);
    if (!frames || frames.length === 0) {
      return null;
    }
    for (const frame of frames) {
      if (!frame.functionName) {
        continue;
      }
      const name = frame.functionName;
      if (name[0] !== name[0].toUpperCase()) {
        continue;
      }

      const filePath = resolveFrameFilePath(frame.fileName);

      // MDX content files: accept immediately — component name is synthetic
      if (filePath && isMdxFilePath(filePath)) {
        return {
          componentName: name,
          filePath,
          lineNumber: frame.lineNumber ?? 0,
          columnNumber: frame.columnNumber ?? 0,
        };
      }

      if (isInternalName(name)) {
        continue;
      }
      if (
        !filePath ||
        isLibraryPath(filePath) ||
        isLibraryPath(frame.fileName || "")
      ) {
        continue;
      }

      return {
        componentName: name,
        filePath,
        lineNumber: frame.lineNumber ?? 0,
        columnNumber: frame.columnNumber ?? 0,
      };
    }
  } catch {
    // Fall through to fiber walk
  }
  return null;
}

/** Fallback: synchronous fiber walk (React 18 / _debugSource). */
function resolveViaFiberWalk(fiber: Fiber): ComponentRef | null {
  let current: Fiber | null = fiber;
  while (current) {
    if (isCompositeFiber(current)) {
      const name = getDisplayName(current.type);
      const debugSource = getDebugSource(current);
      const filePath = debugSource?.fileName || "";
      if (
        name &&
        name[0] === name[0].toUpperCase() &&
        (isMdxFilePath(filePath) || !isInternalName(name))
      ) {
        return {
          componentName: name,
          filePath,
          lineNumber: debugSource?.lineNumber || 0,
          columnNumber: debugSource?.columnNumber ?? 0,
        };
      }
    }
    current = current.return;
  }
  return null;
}

/**
 * Layer 2: grep-based discovery when filePath is empty. Mutates `result` in
 * place when a path is found (cached or freshly discovered).
 */
async function fillFilePathViaDiscovery(result: ComponentRef): Promise<void> {
  if (result.filePath || !result.componentName) {
    return;
  }
  const cached = getCachedFilePath(result.componentName);
  if (cached === undefined) {
    const discovered = await requestFileDiscovery(result.componentName);
    setCachedFilePath(result.componentName, discovered);
    if (discovered) {
      result.filePath = discovered;
    }
  } else if (cached) {
    result.filePath = cached;
  }
}

/** Shared resolution pipeline: owner stack, then fiber-walk fallback, then
 *  grep-based file discovery for components with no resolvable file path. */
async function resolveComponentFromFiber(
  fiber: Fiber
): Promise<ComponentRef | null> {
  const result =
    (await resolveViaOwnerStack(fiber)) ?? resolveViaFiberWalk(fiber);
  if (result) {
    await fillFilePathViaDiscovery(result);
  }
  return result;
}

/**
 * Async resolve of the nearest React component under a viewport point.
 * Uses getOwnerStack (React 19 owner stacks + symbolication) with fiber walk fallback.
 * Used by draw/text/color tools to attach annotations to components.
 */
export async function resolveComponentAtPoint(
  clientX: number,
  clientY: number
): Promise<ComponentRef | null> {
  const el = getPageElementAtPoint(clientX, clientY);
  if (!el) {
    return null;
  }

  const fiber = getFiberFromHostInstance(el);
  if (!fiber) {
    return null;
  }

  return await resolveComponentFromFiber(fiber);
}

/**
 * Resolve component from a known DOM element (no point lookup needed).
 * Used by lasso when elements are already discovered via area selection.
 */
export async function resolveComponentFromElement(
  el: HTMLElement
): Promise<ComponentRef | null> {
  const fiber = getFiberFromHostInstance(el);
  if (!fiber) {
    return null;
  }

  return await resolveComponentFromFiber(fiber);
}
