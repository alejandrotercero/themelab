# themelab

`themelab` lets you edit a React app visually while it is running locally, then automatically writes those changes back to the source files in your project.

It is built for local development and works by opening a proxy in front of your dev server and injecting an overlay into the page.


## Fastest path

You do not need to download or clone this repo.

From the root of your React app:

```bash
npm install -D themelab-cli
```

Start your dev server, then in a second terminal run:

```bash
npx themelab
```

If you want to try it without installing first:

```bash
npx themelab-cli@latest
```

## What it does

- Select an element and inspect its component name, file path, and line number
- Edit Tailwind-based properties across Layout, Spacing, Size, Typography, Background, and Border groups
  - Flex alignment (`justify-content` / `align-items`) uses DevTools-style icon pickers that re-orient with `flex-direction`
  - Size renders as a compact W / H · Min · Max grid
  - Typography includes a text-case toggle (normal / UPPER / lower / Title)
  - Border covers radius, width, color, and style
- Pick colors from the full Tailwind v4 palette (searchable, grouped, list/grid) or bind a color to a theme variable
- Edit your shadcn/Tailwind **theme tokens** (CSS variables in `:root` / `.dark`) with live preview and light/dark toggle
- Navigate the element hierarchy (parent / child / siblings) from the keyboard or sidebar
- Double-click text to edit it inline
- Copy, paste, and duplicate elements
- Delete elements
- Reorder sibling elements
- Stage multiple changes and apply them with **Confirm**
- Undo in-progress canvas changes and review applied changes in the changelog
- Optionally enable an **AI locator** for elements the deterministic resolver can't pin (see below)

## AI assist (optional)

Most edits resolve deterministically. For the hard cases — an element rendered by a `.map()`, a reused component instance, conditional/state-dependent rendering, or a component that renders a different host tag (e.g. a `<Link>` that outputs an `<a>`) — you can enable an **AI locator**. It reads your source to find the exact node to edit; the change itself is still applied by the same deterministic AST transform (the AI only *locates*, it never writes code).

- **Off by default.** It runs only when an `ANTHROPIC_API_KEY` is configured. With no key, behavior is unchanged.
- **Configure it** from the gear (⚙) panel in the overlay: API key, an optional custom endpoint (base URL), and model. Settings are stored locally in `~/.config/themelab/config.json` (the key is never sent back to the browser); environment variables (`ANTHROPIC_API_KEY`, `ANTHROPIC_BASE_URL`) override the stored values.
- **What it does on a match:** a "Locating with AI…" → "Found it" indicator shows while it works. A direct/conditional match applies automatically; an edit that would affect more than the selected element (a `.map()` template or a shared component) asks you to **confirm** first. Resolutions are cached per element, so repeated tweaks stay instant. If it genuinely can't find the element, it tells you **why** rather than guessing.
- **Confirm with AI (⚡):** the lightning button beside **Confirm** resolves every staged change via the AI locator up front, instead of trying deterministic resolution first — handy when deterministic resolution keeps landing on the wrong element.
- **Reordering:** move up/down also gets the AI fallback. Reordering an item rendered by a `.map()` swaps the matching entry in the **source data array** (it'll ask to confirm), rather than trying to move JSX that isn't there.

## MCP server (for coding agents)

While `themelab` is running it also exposes a small **[MCP](https://modelcontextprotocol.io) server**,
so a coding agent (Claude Code, Cursor, …) can read what you're doing in the overlay. The headline:
**click a component in the browser and your agent knows the exact file and line** — no more "which
`Button` did you mean?".

It starts automatically on `http://localhost:3458/mcp` (Streamable HTTP, loopback only). The actual
URL is printed at startup — if `3458` is taken it picks the next free port, so pin it with
`themelab --mcp-port 3458` when you want a stable address for your config, or turn it off with `--no-mcp`.

**Tools exposed**

| Tool | What it returns |
| --- | --- |
| `get_selection` | The currently selected component: name, source `file:line`, the ancestor stack, and a structural JSX path |
| `get_theme` | The project's resolved design-token theme (light/dark CSS-variable maps) |
| `get_tailwind_tokens` | The project's resolved Tailwind token map |
| `find_component` | Resolve a component name to its source file path |

### Register it with Claude Code

```bash
# Run once, from your project root (while themelab is running):
claude mcp add --transport http themelab http://localhost:3458/mcp
```

Or commit a project-scoped `.mcp.json` so your team gets it automatically:

```json
{
  "mcpServers": {
    "themelab": {
      "type": "http",
      "url": "http://localhost:3458/mcp"
    }
  }
}
```

Then just ask: *"what component is selected? add `rounded-lg` to it."* — the agent calls
`get_selection` to find the file and line for you.

### Register it with Cursor

Add to `.cursor/mcp.json` (project) or `~/.cursor/mcp.json` (global):

```json
{
  "mcpServers": {
    "themelab": {
      "url": "http://localhost:3458/mcp"
    }
  }
}
```

> The server is only up while `themelab` is running and serves loopback only. If no overlay is
> connected (no browser tab open), the read tools say so rather than returning stale data.

## Requirements

- Node.js 20+
- A React project (18+)
- A running development server
- Supported app setups: Next.js, Vite, and Create React App

Tailwind CSS is recommended if you want to use the property editor. Text editing and some structural actions do not depend on Tailwind.

## Install

Run this in the root of the React app you want to edit:

```bash
npm install -D themelab-cli
```

If you don't want to install it first, you can also run it directly with `npx themelab-cli@latest`.

## Quick start

1. Start your React dev server as usual.
2. In a second terminal, from the same project root, run:

```bash
npx themelab
```

If auto-detection does not pick the right port, pass it explicitly:

```bash
npx themelab 3000
```

The tool opens a local proxy in your browser, shows the editing overlay, and writes confirmed changes back into files inside your project.

## Basic flow

1. Click an element to inspect and select it.
2. Edit properties in the sidebar, drag to reorder where supported, or double-click text to change copy.
3. Review pending changes in the UI.
4. Click **Confirm** to apply them to your source files.

## CLI options

```text
themelab [options] [port]

Arguments:
  port           Dev server port override

Options:
  --no-open           Don't open browser automatically
  --host <host>       Dev server host (default: "localhost")
  --studio-url <url>  ThemeLab studio base URL (for 'Open in editor')
  --no-mcp            Disable the MCP server for coding agents
  --mcp-port <port>   Preferred port for the MCP server (default: 3458)
  --verbose           Enable debug logging
```

## Shortcuts

| Shortcut | Action |
| --- | --- |
| `Ctrl/Cmd + C` | Copy selected element |
| `Ctrl/Cmd + V` | Paste copied element as sibling |
| `Ctrl/Cmd + D` | Duplicate selected element in place |
| `Delete / Backspace` | Remove selected element |
| `Ctrl/Cmd + Z` | Undo canvas changes |
| `Ctrl/Cmd + Shift + L` | Toggle changelog |
| `` ` `` (backtick) | Toggle Interact mode — operate the app (buttons, menus, links); press again to go back to selecting |
| `↑` / `↓` | Select parent / first child of the selected element |
| `←` / `→` | Select previous / next sibling |
| `[` / `]` | Move selected element up / down among its siblings (writes to source) |
| `Ctrl/Cmd + Click` | Add element to multi-selection |
| Double-click text | Edit text inline |

## Notes

- Run `themelab` from your app's root directory so it can detect the framework and safely resolve file paths.
- It only works against development builds, not production builds.
- Only files inside the current project are eligible for writes.

## Development

To work on this repository itself:

```bash
pnpm install
pnpm build
pnpm test -- --run
```

For iterative CLI development:

```bash
pnpm dev
```

You will still need a separate supported React app running locally to test the tool end to end.

## Web theme studio (`apps/web`)

Alongside the CLI/overlay, the repo hosts a Next.js app — a standalone theme studio for
generating and translating **shadcn / Tailwind v4** themes. Two tools:

- **`/100r` — Hundred Rabbits → shadcn.** Drop a 9-color [Hundred Rabbits](https://github.com/hundredrabbits/Themes)
  SVG theme (or pick a preset) and transpile it into a full 31-token shadcn theme (light + dark) via
  OKLCH interpolation, with a luminance "benchmark" grader, an editable token sidebar, a live preview,
  and CSS / JSON export.
- **`/create` — palette → theme + scales.** Generate a theme from a palette using one of two algorithms,
  toggleable:
  - **ThemeLab** — our OKLCH synthesis from a primary + neutral.
  - **Radix** — the real `generateRadixColors` (accent, neutral, and a background tweakable per mode),
    producing APCA-tuned 12-step scales mapped onto the tokens.
  Both fill the theme *and* the Tailwind/Radix scales consistently, with a live preview and CSS / JSON /
  scale export.

The studio's chrome mirrors the overlay's look (dark navy, Google Sans Code), uses a Kibo-style color
picker, and previews real shadcn components in Inter.

```bash
pnpm dev:web     # run the studio
pnpm build:web   # production build
```

## Project structure

```text
apps/
  web/      Next.js theme studio (/100r and /create)
packages/
  cli/      CLI, proxy server, and source transforms
  overlay/  Injected browser overlay
  shared/   Shared TypeScript types
```

## License

[MIT](./LICENSE)
