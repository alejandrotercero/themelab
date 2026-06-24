// packages/overlay/src/utils/is-shared-ui-source-path.ts
//
// Ported from react-grab. Reusable UI building blocks (shadcn components/ui, a
// monorepo design system, headless primitives) are app-owned but low-signal:
// they wrap many features without being any one feature's source. The trace
// formatter surfaces them but, like package frames, exempts them from the
// compact line budget so a wrapper-heavy trace can reach the meaningful surface
// underneath.

// A bare `/ui/` is deliberately excluded: Next's App Router convention places
// feature code under `app/ui/`, so matching any `ui` segment would demote real
// features.
const SHARED_UI_SOURCE_PATH_SEGMENTS: readonly string[] = [
  "/components/ui/",
  "/packages/ui/",
  "/design-system/",
  "/design-systems/",
  "/primitives/",
];

export function isSharedUiSourcePath(fileName: string | null | undefined): boolean {
  if (!fileName) return false;
  const normalizedPath = `/${fileName}/`.toLowerCase().replace(/\/+/g, "/");
  return SHARED_UI_SOURCE_PATH_SEGMENTS.some((segment) => normalizedPath.includes(segment));
}
