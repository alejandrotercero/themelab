# Changelog

## Unreleased

### Features

- **Theme editor** — edit shadcn/Tailwind CSS-variable tokens (`:root` / `.dark`) in a docked sidebar with live preview, light/dark toggle, and write-back in each token's original format (hsl-triple, oklch, hex)
- **Bind colors to theme variables** — element colors can reference a token (e.g. `bg-primary`) instead of a baked value, so they track theme edits and dark mode
- **Tailwind palette picker** — pick from the full Tailwind v4 palette (searchable, grouped by family, list/grid views) on any color control or theme token
- **Border properties** — radius, width, color, and style added to the property editor
- **Icon alignment controls** — `justify-content` / `align-items` use DevTools-style icon pickers whose orientation follows `flex-direction`
- **Hierarchy navigation** — select parent / child / siblings via the keyboard or sidebar buttons
- **Sibling reorder** — move an element up/down among its siblings with `[` / `]` (writes to source)
- **Interact mode** — toggle with `` ` `` to operate the underlying app (links, menus, inputs) without selecting
- **Dark UI** — overlay restyled to a dark theme using Google Sans Code

### Fixes

- Text edits no longer misroute to unrelated Markdown files; class edits resolve past bundler chunk paths and host/component mismatches
- Responsive (breakpoint-aware) property edits replace the variant that wins at the current viewport
- Proxy hardened against an `ERR_HTTP_HEADERS_SENT` crash; overlay bundle is served with no-cache headers

## 0.1.0 — Initial Release

### Features

- **Visual overlay** — select React components in-browser with a Figma-style canvas
- **Drag-to-reorder** — reorder sibling JSX elements by dragging; writes directly to source
- **Property inspector** — edit Tailwind classes (spacing, sizing, typography, colors, layout) with live preview and source writes
- **Inline text editing** — double-click text to edit; diffs applied to JSX source
- **Move tool** — drag elements to reposition; resolves to Tailwind spacing tokens
- **Color picker** — change colors with a picker that resolves to your Tailwind palette
- **Batch transform engine** — deterministic resolution chain with staleness detection for reliable AST mutations
- **Undo/redo** — file-level undo stack with conflict detection
- **Changelog panel** — tracks all changes with per-entry revert
- **Framework detection** — auto-detects Next.js, Vite, and CRA dev servers
- **Shadow DOM isolation** — all overlay UI lives in Shadow DOM, zero interference with user styles
- **Leveled logger** — `--verbose` flag or `LOG_LEVEL=debug` for diagnostic output

### Architecture

- CLI reverse proxy injects overlay IIFE bundle — no modifications to user's app
- WebSocket bridge between CLI (AST transforms) and overlay (visual state)
- jscodeshift-based transforms for all source mutations
- bippy for React Fiber traversal and component resolution
- Supports React 18 (`_debugSource`) and React 19 (`getOwnerStack`)
