# themelab-cli

## 0.2.0

### Minor Changes

- Detection, navigation, and AI locator upgrades:

  - **Tiered AI escalation**: when the fast locator model fails or gives up, ThemeLab automatically retries with a stronger model ("Looking harder…") armed with a bigger budget, a `find_component_definition` tool, and a trace of the first attempt. Toggle via the gear panel or `THEMELAB_AI_ESCALATION` / `THEMELAB_AI_MODEL_ESCALATED`. Locator calls now run at temperature 0 with prompt caching and per-attempt token logging.
  - **Next.js server components**: RSC-rendered elements now resolve to real source locations via the dev server's symbolication endpoint.
  - **Selection fixes**: full-page sections (heroes, layout wrappers) are selectable again — only true overlays are filtered. `z`/`x` keys drill through stacked elements at the cursor. New History tab lists your last 50 selections for one-click reselection.
  - **Fix**: replaced the unmaintained `http-proxy` with `http-proxy-3`, eliminating `util._extend` DEP0060 deprecation warnings on Node 22+.
