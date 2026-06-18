# themelab-cli

## 0.2.1

### Patch Changes

- Security and correctness fixes:

  - **Bind the proxy and WebSocket servers to loopback (`127.0.0.1`) and reject non-loopback WebSocket origins.** Previously both listened on all network interfaces, exposing the dev server and the file-writing WebSocket to the local network; a malicious web page could also drive edits over the WebSocket. **Behavior change:** the proxied app and overlay are now reachable only from the local machine — LAN access is intentionally blocked.
  - **Enable DNS-rebinding / Host protection on the MCP server**, so a malicious browser page can no longer reach the loopback MCP endpoint to read project context (selection path, theme/Tailwind tokens).
  - **Canonicalize file paths (realpath) when enforcing project-root containment**, blocking symlink-based escapes from the project directory on writes.
  - **Bump `ws` to `^8.21.0`** to clear high/moderate advisories (memory-exhaustion DoS, uninitialized memory disclosure).
  - **Fail loud on object-key class conflicts in `cn()` / `clsx()`**: editing a class whose name matches a `clsx({ "gap-4": cond })` object key now reports `CONFLICTING_CLASS` instead of silently duplicating it. `cn("base", className)` edits are unchanged.

## 0.2.0

### Minor Changes

- Detection, navigation, and AI locator upgrades:

  - **Tiered AI escalation**: when the fast locator model fails or gives up, ThemeLab automatically retries with a stronger model ("Looking harder…") armed with a bigger budget, a `find_component_definition` tool, and a trace of the first attempt. Toggle via the gear panel or `THEMELAB_AI_ESCALATION` / `THEMELAB_AI_MODEL_ESCALATED`. Locator calls now run at temperature 0 with prompt caching and per-attempt token logging.
  - **Next.js server components**: RSC-rendered elements now resolve to real source locations via the dev server's symbolication endpoint.
  - **Selection fixes**: full-page sections (heroes, layout wrappers) are selectable again — only true overlays are filtered. `z`/`x` keys drill through stacked elements at the cursor. New History tab lists your last 50 selections for one-click reselection.
  - **Fix**: replaced the unmaintained `http-proxy` with `http-proxy-3`, eliminating `util._extend` DEP0060 deprecation warnings on Node 22+.
