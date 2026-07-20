import * as fs from "node:fs";
import path from "node:path";

function isWithinProjectRoot(
  resolvedPath: string,
  projectRoot: string
): boolean {
  return (
    resolvedPath === projectRoot ||
    resolvedPath.startsWith(projectRoot + path.sep)
  );
}

/**
 * Canonical path of the deepest existing ancestor + the non-existent tail.
 * Resolves symlinks on the existing portion so that symlink-based escapes are
 * caught even when the write target does not yet exist on disk.
 */
function canonicalize(p: string): string {
  let cur = p;
  const tail: string[] = [];
  // Walk up until an existing path is found (or we hit the filesystem root).
  while (!fs.existsSync(cur)) {
    const parent = path.dirname(cur);
    if (parent === cur) {
      return p;
    } // reached root; nothing exists — return as-is
    tail.unshift(path.basename(cur));
    cur = parent;
  }
  const realBase = fs.realpathSync(cur);
  return tail.length ? path.join(realBase, ...tail) : realBase;
}

/**
 * Canonicalize an incoming file path from the overlay into an absolute path
 * inside the project root.
 *
 * Supported inputs:
 * - `src/App.tsx` -> `<projectRoot>/src/App.tsx`
 * - `/src/App.tsx` -> `<projectRoot>/src/App.tsx`
 * - `/abs/path/in/project/src/App.tsx` -> same absolute path
 *
 * Rejected inputs:
 * - `../outside.tsx`
 * - `/etc/passwd`
 * - `/abs/path/outside/project/file.tsx`
 * - `escape/secret.txt` where `escape` is a symlink pointing outside the root
 */
export function resolveProjectFilePath(
  filePath: string,
  projectRoot: string
): string | null {
  const normalizedRoot = path.resolve(projectRoot);
  const canonicalRoot = canonicalize(normalizedRoot);
  const incomingPath = filePath.trim();
  if (!incomingPath) {
    return null;
  }

  if (path.isAbsolute(incomingPath)) {
    const absoluteCandidate = path.resolve(incomingPath);
    if (isWithinProjectRoot(absoluteCandidate, normalizedRoot)) {
      if (
        !isWithinProjectRoot(canonicalize(absoluteCandidate), canonicalRoot)
      ) {
        return null;
      }
      return absoluteCandidate;
    }

    // If the absolute path exists outside the project, treat it as a real
    // filesystem absolute and reject it. Only reinterpret missing leading-slash
    // paths like "/src/App.tsx" as project-root-relative source paths.
    if (fs.existsSync(absoluteCandidate)) {
      return null;
    }

    const projectRelativeCandidate = path.resolve(
      normalizedRoot,
      incomingPath.replace(/^[/\\]+/, "")
    );
    if (!isWithinProjectRoot(projectRelativeCandidate, normalizedRoot)) {
      return null;
    }
    if (
      !isWithinProjectRoot(
        canonicalize(projectRelativeCandidate),
        canonicalRoot
      )
    ) {
      return null;
    }
    return projectRelativeCandidate;
  }

  const relativeCandidate = path.resolve(normalizedRoot, incomingPath);
  if (!isWithinProjectRoot(relativeCandidate, normalizedRoot)) {
    return null;
  }
  if (!isWithinProjectRoot(canonicalize(relativeCandidate), canonicalRoot)) {
    return null;
  }
  return relativeCandidate;
}

export function isProjectFilePathSafe(
  filePath: string,
  projectRoot: string
): boolean {
  return resolveProjectFilePath(filePath, projectRoot) !== null;
}
