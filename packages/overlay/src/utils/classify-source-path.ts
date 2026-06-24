// packages/overlay/src/utils/classify-source-path.ts
//
// Ported/adapted from react-grab (packages/react-grab/src/utils/classify-source-path.ts).
// Classifies a stack-frame fileName as first-party app source, a dependency
// (package), or unresolvable (unknown). selection.ts uses this to prefer the
// nearest app-owned frame as the primary source, so a node_modules / Vite-dep
// path can never win the primary slot over the user's own component.
//
// Unlike ThemeLab's older `isLibraryPath` denylist, package detection here is a
// positive classifier (resolvePackageName) that recognises Vite optimized-deps
// flattening, sourcemapped scoped deps, and CDN URLs, while keeping monorepo
// workspaces classified as app.

import { isSourceFile } from "bippy/source";
import { resolvePackageName } from "./parse-package-name.js";
import { extractFilePath, isBundlerChunkName } from "./source-resolve.js";

export type SourceOrigin = "app" | "package" | "unknown";

export interface SourcePathClassification {
  origin: SourceOrigin;
  packageName: string | null;
}

const SOURCE_EXTENSION_PATTERN = /\.(tsx?|jsx?|mjs|mdx?)$/;

export function classifySourcePath(
  fileName: string | null | undefined,
): SourcePathClassification {
  if (!fileName) return { origin: "unknown", packageName: null };

  // Bundler output chunks (Turbopack `._.`, hashed chunks) are never real
  // source — treat as unknown so they don't masquerade as app files.
  if (isBundlerChunkName(fileName)) return { origin: "unknown", packageName: null };

  const packageName = resolvePackageName(fileName);
  if (packageName) return { origin: "package", packageName };

  // Direct match (bippy accepts many bundler-wrapped source URLs).
  if (isSourceFile(fileName)) return { origin: "app", packageName: null };

  // Fall back to ThemeLab's bundler-URL extraction for app paths bippy's
  // isSourceFile rejects in raw form (webpack-internal, rsc://, /@fs/, …).
  const extracted = extractFilePath(fileName);
  if (extracted && !isBundlerChunkName(extracted)) {
    if (isSourceFile(extracted) || SOURCE_EXTENSION_PATTERN.test(extracted)) {
      return { origin: "app", packageName: null };
    }
  }

  return { origin: "unknown", packageName: null };
}
