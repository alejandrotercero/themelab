# Spec — ThemeLab Desktop

> Status: REBASED — the preview/selection spike and first shared-core extraction exist.
> The next work is deliberately sequenced around reliable proposal/application paths and
> reuse of proven Web/overlay domain components, rather than around visual parity passes.
>
> Product decision: desktop-first visual editor with safe source control and pluggable ACP agents
>
> Runtime decision: Electron + React + Tailwind CSS
>
> Scope: implementation-ready local-first v1 specification. Desktop extends the CLI; it is not a native reproduction of every overlay control.

## 1. Summary

ThemeLab Desktop turns the existing local CLI/overlay into a workspace application for
visually inspecting a running React app, previewing edits, reviewing exact source patches,
and optionally collaborating with the user's own coding agent.

The desktop app owns five surfaces:

1. **Workspace** — open one project and grant explicit access to it.
2. **Preview** — run or connect to a development server and display its proxied app.
3. **Inspector** — select React-rendered elements and tune their Tailwind, text, structure,
   and theme values with a compact DialKit-inspired control language.
4. **Changes** — show pending and applied file diffs before source writes, with atomic apply,
   conflict detection, and recovery.
5. **Agent** — connect to Claude, Codex, or another ACP-compatible coding agent using the
   user's existing local authentication and show its activity, permission requests, and diffs.

The existing CLI remains supported. Desktop reuses the current proxy, React source
resolution, Tailwind/theme parsing, deterministic AST transforms, and the web app's tested
theme engine by extracting reusable packages rather than rewriting or visually copying them.

### Product boundary

Desktop is **not** an attempt at one-to-one overlay parity. The CLI overlay remains the
fast browser-native editing surface. Desktop adds the things that are awkward or unsafe in an
overlay: explicit workspace access, a stable embedded preview, a proposed-changes review
surface, recovery, project-level theme work, and user-owned ACP agents.

Visual familiarity still matters: retain the compact floating action bar, the theme workflow,
and familiar controls where they help an existing ThemeLab user. But a desktop control is only
added when it is backed by a typed preview/proposal/apply path; copying a control merely because
it exists in the overlay is out of scope.

### Current spike status

The initial Electron boundary is implemented in `apps/desktop`: a React/Tailwind shell using
the web studio's navy OKLCH tokens, a sandboxed shell renderer, an isolated `WebContentsView`,
validated preview-bounds IPC, and local reuse of the built CLI proxy/SketchServer. The package
builds and typechecks. A live Next.js fixture has now been launched and the proxy response is
confirmed to contain the overlay bundle and WebSocket bootstrap. The desktop shell receives
live selection identity and computed-style snapshots; its native Inspector can apply and discard
guarded, in-memory preview overrides without writing source files.

## 2. Product thesis

ThemeLab should make this loop feel immediate and trustworthy:

```text
point at rendered UI
  → tune it visually
  → see the source-level patch
  → apply deliberately
  → ask an agent for deeper work when needed
  → review everything in one change surface
```

The desktop app is not primarily an IDE or a general chat client. Its advantage is the
high-fidelity bridge between a rendered element, its owning React source, visual controls,
and a reviewable patch.

## 3. Goals

- Open an existing local React workspace without adding a permanent runtime dependency.
- Start a supported dev command or connect to an already-running development server.
- Embed the proxied app in a dedicated, isolated preview surface.
- Select a rendered element and resolve its component, source file, location, owner trace,
  JSX path, Tailwind classes, computed style, and relevant theme tokens.
- Preview visual changes without writing source files.
- Convert supported visual changes into deterministic AST operations.
- Show an exact unified diff and affected-file list before applying any ThemeLab write.
- Apply a multi-file change atomically, reject stale edits, and make recovery obvious.
- Host ACP agent sessions using the user's locally configured authentication.
- Keep agent capabilities and permission requests visible and attributable.
- Preserve the current `themelab` CLI for headless/external-browser use.

## 4. Non-goals for v1

- A general-purpose code editor.
- A Figma-compatible design-file editor.
- Freeform vector drawing, lasso, or annotation export.
- Multi-agent orchestration or autonomous agent teams.
- Terminal scraping as the primary agent integration.
- Guaranteed sandboxing for every third-party agent.
- Automatic installation of every agent in the ACP registry.
- Permanent DialKit instrumentation of the user's source.
- Non-React source resolution.
- Production-site editing.
- Cloud accounts, sync, collaboration, or hosted execution.

## 5. Locked decisions

### 5.1 Electron, React, and Tailwind

Use Electron for the desktop runtime and React + Tailwind CSS for the local application UI.

Electron is preferred over Tauri for v1 because:

- `WebContentsView` is designed to embed separately controlled web content inside the app.
- The preview can use Chromium consistently across macOS, Windows, and Linux.
- The existing proxy, WebSocket server, file discovery, jscodeshift transforms, and MCP
  server are already Node/TypeScript code and can move into Electron's main process or a
  Node utility process without a Rust/sidecar boundary.
- DevTools, console events, navigation events, reloads, permissions, and zoom can be
  controlled through one runtime.

The larger Electron binary is an accepted tradeoff. ThemeLab is a development tool whose
core experience is an embedded browser plus Node-based source tooling.

### 5.2 DialKit is a design influence, not a core dependency

The Inspector should borrow DialKit's strengths:

- compact, direct-manipulation controls;
- folders and progressive disclosure;
- sliders with explicit range/step;
- toggles, segmented controls, selects, colors, and text;
- spring/easing editors when the source model supports them;
- keyboard-driven fine/coarse adjustments;
- presets and reset-to-source behavior.

ThemeLab should implement its own control registry because its controls must be dynamic,
selection-driven, Tailwind-aware, patch-producing, and integrated with pending diffs.
DialKit's runtime hook model expects the application to explicitly own and consume the
controlled values, which is a different contract.

A later feature may generate optional DialKit instrumentation from a selected component,
but that is not required for v1.

### 5.3 Reuse the web theme engine as a product subsystem

The hosted web app contains real domain logic that Desktop should share, not imitate:

- CSS-color parsing and normalized OKLCH serialization;
- format conversion (OKLCH, HSL, RGB, hex) and contrast calculation;
- perceptual scale generation and Tailwind-scale export;
- shadcn theme synthesis from palettes and mindful palettes;
- theme validation, CSS/JSON export, and DESIGN.md generation;
- grouped token controls, source-palette replacement, and the established swatch popover.

The current sources live under `apps/web/lib/theme-engine` and have a dedicated Vitest suite.
Phase 1 extracts the browser-safe, framework-free engine into `packages/theme-engine`; both the
web app and Desktop import it. Do **not** import the Next.js app into Electron or maintain a
second hand-written color parser/picker in Desktop.

`packages/theme-ui` may subsequently house portable React controls (the swatch popover, color
picker, token controls, validation readout, and scale view). It must have no Next routing,
server, registry, or hosted-library dependency. Desktop owns its shell, positioning, keyboard
rules, and proposal wiring.

The first desktop theme experience is therefore a **Theme Workspace**: inspect project tokens,
edit a token with the same color semantics as the web app, preview light/dark changes, see
contrast/validation feedback, and submit the resulting CSS-variable patch through Changes.
Theme creation from palette/mindful presets and export can follow after that transaction path is
proven. Hosted registry browsing, public saved-theme sharing, analytics, and installation URLs
remain web-only unless separately scoped.

### 5.4 Icons and visual primitives

Do not hand-draw approximate icons or use text glyph stand-ins for existing ThemeLab actions.
Before rebuilding a visible control, inventory the original asset/component used by the overlay
or web app and use its canonical icon source (currently Phosphor or Lucide, depending on the
surface). The shared icon decision belongs in a small desktop icon map with semantic action names;
it is a consistency task, not a reason to recreate overlay layout pixel-for-pixel.

### 5.5 Deterministic edits remain the default

ThemeLab visual edits must continue to produce typed operations and deterministic AST/CSS
transforms. An agent may help locate or propose a change, but no model output is silently
written as source.

### 5.6 ACP is the agent boundary

ThemeLab is an ACP **client**. Agents are external processes launched through a configured
ACP adapter over stdio. Known profiles are provided for Claude and Codex, and users may add
an arbitrary ACP command and arguments.

MCP remains useful in the other direction: ThemeLab can expose its live selection, theme,
tokens, and preview diagnostics to the active agent as a session-scoped MCP server.

## 6. Primary user flow

### 6.1 First launch

1. User chooses **Open project**.
2. ThemeLab canonicalizes the selected directory and reads project metadata.
3. ThemeLab shows detected framework, package manager, candidate dev commands, default port,
   git state, Tailwind version, and theme source.
4. User confirms the workspace and chooses a dev command or existing server URL.
5. ThemeLab creates a project record containing non-secret preferences only.
6. The app starts the proxy and preview; no source files are changed.

### 6.2 Visual editing

1. User activates Select and points at an element in the preview.
2. Preview reports the element identity and source trace through the existing overlay bridge.
3. Inspector displays supported controls and the resolved source location.
4. Changing a control updates the preview immediately using an ephemeral override.
5. ThemeLab generates a typed source operation in memory.
6. Changes panel displays the resulting source diff without writing it.
7. User chooses **Apply** or **Discard**.
8. Apply revalidates source baselines, performs the transaction, records recovery data, and
   allows the dev server/HMR to render the source-backed result.

### 6.3 Agent-assisted editing

1. User chooses an installed ACP agent and starts a session for the open workspace.
2. ThemeLab initializes the agent with workspace metadata and the session-scoped MCP server.
3. The user selects UI and asks for a change; ThemeLab attaches the current visual context.
4. Agent activity is streamed into the Agent panel: text, plan, tools, terminal output,
   permission requests, and file changes where supported by the adapter.
5. Resulting workspace changes appear in the same Changes panel as visual edits.
6. The user reviews and keeps/reverts the changes using the isolation mode available for that
   agent and project.

## 7. Window layout

```text
┌──────────────────────────────────────────────────────────────────────────────┐
│ Project · branch        Dev server ●        viewport       Agent      Apply │
├──────────────┬───────────────────────────────────────────┬───────────────────┤
│              │                                           │ Inspector         │
│ Components   │                                           │                   │
│ / Layers     │           Embedded app preview            │ Layout            │
│              │           (isolated web contents)         │ Spacing           │
│ Files        │                                           │ Type / Color      │
│              │                                           │ Theme             │
├──────────────┴───────────────────────────────────────────┴───────────────────┤
│ Changes | Agent | Console | Problems                                      ▲ │
│ diff / activity / permission requests / dev-server output                   │
└──────────────────────────────────────────────────────────────────────────────┘
```

Layout requirements:

- Center preview is the dominant surface and resizes continuously.
- Left rail is collapsible and defaults to selection ancestry/history, not a full file tree.
- Right Inspector is selection-driven and may be pinned.
- Bottom panel is resizable and shared by Changes, Agent, Console, and Problems.
- Selecting a diff hunk reveals its file and line but does not require a full editor.
- The preview supports common responsive viewport presets and arbitrary resizing.
- Interact and Select modes are visibly distinct.

## 8. Runtime architecture

```text
Electron main process
├─ Workspace service
│  ├─ canonical root + allowlist
│  ├─ file reads/stats
│  ├─ patch transaction + recovery
│  └─ git integration
├─ Dev process service
│  ├─ detect command/package manager
│  ├─ spawn/attach/stop
│  └─ stdout/stderr + health
├─ ThemeLab local service
│  ├─ reverse proxy + overlay injection
│  ├─ selection WebSocket bridge
│  ├─ Tailwind/theme resolution
│  ├─ deterministic transforms
│  └─ session MCP server
├─ ACP service
│  ├─ agent profiles + discovery
│  ├─ stdio client/session lifecycle
│  ├─ capability negotiation
│  └─ event + permission normalization
├─ Local shell renderer (React + Tailwind)
└─ Isolated preview WebContentsView
   └─ proxied user app + ThemeLab bridge
```

### 8.1 Process boundaries

- **Main process:** owns filesystem access, child processes, git, proxy ports, ACP transports,
  patch generation/application, and preview lifecycle.
- **Shell renderer:** local packaged UI only. It receives narrow typed APIs through a preload
  bridge; it has no direct Node or filesystem access.
- **Preview:** separate `WebContentsView` loading only the loopback proxy. It has
  `nodeIntegration: false`, `contextIsolation: true`, `sandbox: true`, web security enabled,
  no generic IPC bridge, denied unexpected permissions, and restricted navigation.
- **Long-running/heavy work:** AST parsing, project scans, and agent transport may move to a
  utility process if profiling shows main-process stalls. The v1 API must not assume that work
  is in-process.

### 8.2 Preview positioning

`WebContentsView` is not a DOM element. The shell renderer reports the logical bounds of the
preview slot to main through a dedicated `preview:setBounds` call. Main updates the native
view bounds on resize, panel movement, and device-scale changes.

### 8.3 Navigation policy

- Preview may navigate within the configured loopback proxy origin.
- `window.open` and external-origin navigation are denied in the preview and offered to the
  user through an explicit **Open externally** action.
- Downloads are denied by default.
- Camera, microphone, geolocation, notifications, clipboard, MIDI, serial, USB, Bluetooth,
  and screen capture are denied unless a later scoped feature enables them.
- Authentication popups required by the user's local app are a known risk and must be tested
  during the preview spike.

## 9. Package evolution

Proposed monorepo shape:

```text
apps/
  desktop/                 Electron main, preload, and React shell
  web/                     Existing hosted theme studio
packages/
  core/                    Project detection, source resolution, operations, diffs, transactions
  theme-engine/            Extracted framework-free web theme/color engine
  theme-ui/                Optional portable React theme controls (no Next/Electron writes)
  protocol/                Typed domain commands/events shared across processes
  preview-bridge/          Minimal injected selection + preview override bundle
  cli/                     Existing CLI composition over core + preview bridge
  overlay/                 Legacy/external-browser UI during migration
  shared/                  Temporary compatibility surface; shrink or merge into protocol
```

Extraction rules:

- Move behavior with its tests before changing it.
- Do not make `core` import Electron, Commander, browser DOM APIs, or desktop UI code.
- Pure source transforms accept explicit `projectRoot`, file content/baseline, and operation;
  they return proposed content/diffs rather than writing directly.
- File writes move behind the workspace transaction service.
- CLI retains a compatibility adapter that can auto-apply through the same transaction API.
- Keep the current WebSocket protocol working until Desktop has an equivalent end-to-end test.
- Move `apps/web/lib/theme-engine` with its tests before changing behavior. The web app and
  Desktop must consume the same color conversion, validation, scale, and serialization rules.
- Do not extract web routing, analytics, hosted saved-theme storage, registry endpoints, or
  install-link transport into Desktop's local workspace boundary.

## 10. Domain model

### 10.1 Workspace

```ts
interface Workspace {
  id: string;
  rootRealPath: string;
  displayName: string;
  framework: "nextjs" | "vite" | "cra";
  packageManager: "pnpm" | "npm" | "yarn" | "bun";
  git?: { root: string; branch?: string };
  dev: DevConfiguration;
}
```

The canonical real path is the security boundary. Paths supplied by the preview, renderer,
or an agent are untrusted and must be resolved against it on every privileged operation.

### 10.2 Selection

Reuse and version the existing `ComponentInfo` shape. Add:

- stable selection ID for UI/event correlation;
- preview URL and viewport;
- computed style snapshot used by the Inspector;
- resolved editable capabilities;
- source baseline hash in addition to mtime/size;
- compact screenshot or element crop only when requested for an agent turn.

### 10.3 Proposed change

```ts
interface ProposedChange {
  id: string;
  origin: "visual" | "agent" | "theme" | "system";
  summary: string;
  operations: SourceOperation[];
  files: ProposedFileChange[];
  createdAt: number;
  status: "draft" | "ready" | "stale" | "applied" | "discarded" | "failed";
}

interface ProposedFileChange {
  path: string;             // workspace-relative display path
  beforeHash: string;
  beforeContent: string;
  afterContent: string;
  unifiedDiff: string;
}
```

`beforeContent` may move to a bounded recovery store for large files. v1 must impose file and
transaction size limits and explain failures rather than truncating or partially applying.

## 11. File-control and transaction model

### 11.1 Rules

- All ThemeLab-owned writes pass through one transaction service.
- Every target must resolve to a regular file inside the canonical workspace root.
- Symlinks are resolved and checked; a symlink may not escape the workspace.
- Deny writes to `.git`, dependency directories, build output, secrets, binary files, and files
  above the configured size limit unless a later explicit policy allows them.
- The shell renderer and preview never receive an unrestricted file API.
- A proposal is computed from a captured baseline and marked stale when disk state diverges.
- Apply is all-or-nothing across files.

### 11.2 Atomic apply

1. Resolve and validate every target.
2. Re-read every file and compare its content hash to `beforeHash`.
3. Write each new content body to a temporary sibling file.
4. Fsync/close temporary files where supported.
5. Replace targets; if any replacement fails, restore already-replaced files from recovery
   data and report whether rollback was complete.
6. Store the transaction manifest and before-content under ThemeLab's application data.
7. Emit one applied-change event and let HMR update the preview.

No transaction may report success after a partial write.

### 11.3 Recovery

- Session undo is available for ThemeLab-owned transactions.
- Undo is conflict-aware: it only restores automatically if current content matches the
  transaction's recorded `afterHash`.
- Recovery manifests survive an app crash and are pruned by count/age.
- Git is supplementary, not the only recovery mechanism.
- If a git repository is clean, offer **Create checkpoint commit** as an optional action;
  never commit automatically in v1.

### 11.4 Agent-originated writes

ACP agents may have their own filesystem and shell tools. ThemeLab cannot honestly guarantee
that every third-party adapter obeys a universal sandbox. The UI must distinguish:

- **Isolated worktree** (recommended, git projects): start the agent in a ThemeLab-managed git
  worktree. Review its diff, then apply selected patches to the user's working tree.
- **Read-only/approval mode**: request the strongest read-only or permission-gated mode exposed
  by the ACP agent and apply returned patches through ThemeLab.
- **Direct workspace mode**: agent runs in the real project and may write directly. This mode
  requires explicit per-session consent and is labeled as externally controlled; ThemeLab
  watches and reports diffs but cannot promise pre-write approval.

ThemeLab must negotiate and display the agent's actual capabilities. It must not label a
session “sandboxed” merely because the process working directory is the project.

## 12. Inspector and visual controls

### 12.1 Control registry

```ts
interface InspectorControl<T> {
  id: string;
  group: InspectorGroup;
  label: string;
  sourceValue: T;
  previewValue: T;
  reset(): void;
  preview(value: T): PreviewOverride[];
  propose(value: T): SourceOperation[];
}
```

Initial controls:

- display, position, flex direction, justify, align;
- gap, margin, padding;
- width/height/min/max;
- font family, size, weight, line height, tracking, case, alignment;
- background, foreground, border color/style/width/radius, opacity;
- light/dark and responsive variant target;
- text content;
- sibling move, duplicate, delete;
- project theme CSS variables.

Controls should prefer project Tailwind tokens and theme variables, show the underlying class,
and make an arbitrary raw value an explicit secondary path.

### 12.2 Ephemeral preview

Inspector changes first produce preview-only overrides targeted to the selected element.
Overrides must be reversible, survive harmless React rerenders where identity can be reacquired,
and clear on discard, navigation, workspace close, or successful source-backed HMR.

The Preview bridge must never receive filesystem authority. It receives only override commands
and reports selection/runtime context.

### 12.3 Change grouping

Rapid slider/scrub updates coalesce into one pending operation per property/variant/selection.
The Changes panel shows the final semantic change, while the preview remains real-time.

## 13. ACP agent integration

### 13.1 Agent profiles

```ts
interface AgentProfile {
  id: string;
  name: string;
  command: string;
  args: string[];
  envAllowlist: string[];
  source: "built-in" | "registry" | "user";
}
```

V1 ships profile templates for:

- Claude through its ACP adapter;
- Codex through `@agentclientprotocol/codex-acp`;
- arbitrary user-defined ACP stdio command.

ThemeLab should prefer existing installations and authentication. It must not collect API keys
in its own UI when the adapter can authenticate itself. Adapter authentication requests are
rendered as ACP flows.

### 13.2 Session context

On session creation, pass:

- canonical workspace directory;
- session isolation mode;
- ThemeLab MCP endpoint/config when the agent supports client-provided MCP servers;
- concise project metadata;
- no selection-specific payload until a prompt uses it.

When the user prompts with a selection, attach:

- component/source identity and ancestor trace;
- structural JSX path;
- selected element's visible text and relevant classes;
- viewport and route;
- resolved theme/Tailwind tokens by reference through MCP;
- optional element screenshot only with a visible attachment chip.

### 13.3 Event normalization

Normalize ACP updates into stable UI events:

- assistant text/reasoning summary;
- plan and status;
- tool start/progress/result;
- terminal output;
- file change;
- permission/authentication request;
- completion, cancellation, failure;
- usage when provided.

Preserve provider-specific metadata for diagnostics without coupling the primary UI to it.

### 13.4 Permission UX

- Permission requests name the agent, operation, target, scope, and proposed duration.
- Choices are **Allow once**, **Allow for this session** when safe/supported, and **Deny**.
- ThemeLab never fabricates an “allow” response when the user closes a dialog.
- Persistent grants are out of scope for v1.
- Agent process stdout/stderr and protocol logs are stored separately from user-facing chat.

### 13.5 Lifecycle

- One active agent session in v1; session history may be reopened if the adapter supports it.
- User can cancel a turn and stop the agent process.
- Workspace close stops or cleanly detaches the agent based on an explicit prompt.
- Unexpected process exit is shown with adapter logs and a restart action.
- ACP initialization/version/capability failures are actionable and never fall back silently to
  terminal scraping.

## 14. IPC surface

Expose narrow, validated preload APIs grouped by domain. Illustrative surface:

```ts
window.themelab.workspace.open()
window.themelab.workspace.getState()
window.themelab.dev.start(config)
window.themelab.dev.stop()
window.themelab.preview.setBounds(bounds)
window.themelab.preview.navigate(url)
window.themelab.selection.subscribe(handler)
window.themelab.changes.propose(operations)
window.themelab.changes.apply(changeId)
window.themelab.changes.discard(changeId)
window.themelab.changes.undo(transactionId)
window.themelab.agent.start(profileId, isolation)
window.themelab.agent.prompt(sessionId, prompt)
window.themelab.agent.respondPermission(requestId, decision)
window.themelab.agent.cancel(sessionId)
```

Requirements:

- Validate every request in main with schemas; TypeScript types alone are insufficient.
- Validate IPC sender identity and expected frame.
- Never expose raw `ipcRenderer`, `child_process`, shell, filesystem, or arbitrary command APIs.
- Events are unsubscribable and scoped to the current workspace/session ID.
- Secrets and full environment variables are never sent to the renderer.

## 15. Project persistence

Store in application data:

- recent project canonical paths and display names;
- dev command/port preference;
- panel layout and viewport presets;
- agent profile references and non-secret arguments;
- recovery manifests;
- app logs and ACP adapter logs with retention limits.

Do not store:

- raw agent/API credentials owned by external CLIs;
- unrestricted environment snapshots;
- source contents outside bounded recovery transactions;
- conversation content indefinitely without an explicit product decision.

## 16. Error states

The UI must have designed states for:

- unsupported/no React project;
- dev command missing or exits early;
- port collision;
- preview unavailable/reconnecting;
- proxy/HMR WebSocket failure;
- source element unresolved or ambiguous;
- source file changed after selection;
- dynamic className that cannot be transformed safely;
- multi-file transaction rollback;
- dirty git tree and worktree creation failure;
- ACP adapter not installed;
- ACP version/capability mismatch;
- agent auth or permission request;
- agent process crash;
- preview app requesting a denied browser permission.

Errors should preserve the user's pending preview state whenever it remains safe to do so.

## 17. Observability

- Structured logs with domains: desktop, workspace, proxy, preview, transform, transaction,
  dev-process, git, ACP, and agent-process.
- Generate a support bundle only through an explicit action; redact canonical home paths,
  environment values, credentials, source content, and prompt content by default.
- Changes view attributes each mutation to visual controls, theme editor, or a named agent.
- No telemetry in v1 unless separately specified and opt-in.

## 18. Delivery plan

### Execution rule — no speculative surface work

Before adding or changing a desktop control, identify all four of these links:

1. **Reference:** the overlay or Web component/algorithm it is reusing, or a documented reason
   it is a new desktop-only concept.
2. **Preview:** the reversible preview-bridge command and reset behavior.
3. **Proposal:** the deterministic operation it can generate, including its unsupported state.
4. **Apply:** the Change Store transaction, stale-baseline behavior, recovery outcome, and test.

If any link is absent, the control remains absent or explicitly preview-only. It must not gain a
prominent Confirm/Apply action. Visual review happens at defined phase gates against the actual
overlay/Web reference; it is not an open-ended reason to keep changing geometry, icons, or
controls while the write path is incomplete.

### Phase 0 — freeze and complete the preview spike

- [x] Electron shell, sandboxed local renderer, and isolated `WebContentsView`.
- [x] Proxied app and live selection/theme bridge against a Next.js fixture.
- [x] Renderer-measured preview bounds and a native floating action bar/theme dock proof.
- [ ] Verify HMR, navigation policy, focus/keyboard input, console capture, error states, and
      DPI/resizing against both Next.js and Vite fixtures.
- [ ] Audit the existing web/overlay icons and replace desktop substitutes with canonical source
      icons. This is a contained cleanup, not ongoing visual-parity work.
- [x] Replace direct-confirm behavior for supported desktop edits with a Review → Changes flow.
- [ ] Verify HMR/navigation/focus and sizing with a live Vite fixture as well as the existing
      Next.js fixture; record the actual limitations before adding more layout controls.

**Exit:** preview lifecycle and selection are reliable. The current native inspector remains a
bounded prototype; no additional controls are added before the proposal pipeline exists.

**Runtime evidence (2026-08-08):** a controlled Electron instance opened the existing Web
Next.js dev server through the desktop loopback proxy. The bridge logged overlay initialization
and the renderer reported `Preview connected`; the native inspector rendered beside the preview,
not inside it. Native-view automation could not dispatch a selection click, so selection,
source mutation, HMR, navigation denial, and Vite remain explicitly unverified.

### Phase 1 — extract shared core and the Web theme engine

- [x] Extract the browser-safe Web theme engine to `packages/theme-engine` and point the Web app
      and Desktop at it. Its existing tests move with it:
      OKLCH parsing/formatting, contrast, scales, synthesis, validation, and serialization.
- [x] Add `packages/core` proposal/diff/transaction primitives with baseline hashing and recovery
      backup; use the CLI transform in no-write mode to make Desktop source proposals.
- [x] Keep CLI auto-apply as the compatibility default while letting Desktop request no-write
      transforms.
- [ ] Complete the transaction contract: workspace policy (symlinks/denylists/size limits),
      persistent recovery manifests, conflict-aware undo, and multi-file failure tests.
- [ ] Extract the actual Web token-control composition, not only a lookalike: token row, palette
      mapping, validation readout, and scale readout. `packages/theme-ui` must consume
      `@themelab/theme-engine`; it cannot carry separate color semantics.
- [ ] Audit and map each desktop action to its canonical existing icon asset/component. The Web
      theme UI uses Phosphor and the Kibo picker uses Lucide; overlay alignment SVGs remain the
      source for alignment controls. Remove local hand-drawn substitutes in one bounded pass.

**Exit:** CLI regression tests remain green, web theme-engine tests run from the shared package,
and Desktop can propose/apply one Tailwind class edit through the same transaction API.

### Phase 2 — explicit workspace, dev, and one Change Store

- [x] Add an Open project flow and a transient project root sufficient to launch the preview.
- [x] Add one in-memory proposal panel with exact unified diff, discard, and apply for supported
      theme and Tailwind-class edits.
- [ ] Promote that panel into a real Change Store: multiple proposals, origin/operations/status,
      stale state, applied history, recovery entry, undo, and selection-scoped grouping. Rename
      the current single `pendingThemeProposal` implementation to the generic model.
- [ ] Add workspace persistence, canonical project policy, detection summary, recents, git state,
      configured dev command or existing-server URL.
- [ ] Add owned dev-process start/stop/health, console capture, reconnect states, and cleanup.
- [ ] Prove one supported Tailwind change end-to-end in both fixture frameworks: select → preview
      → proposed AST patch → Changes → apply → HMR → undo. Arbitrary CSS remains preview-only
      until it has an equally safe source adapter.
- [ ] Add selection trace/history, Select versus Interact mode, and viewport presets only after
      the surrounding state model is stable.

**Exit:** a user can open a project, select an element, make one class/text change, inspect the
exact patch, deliberately apply it, and undo it without direct renderer/preview filesystem writes.

### Phase 3 — Theme Workspace first, then the inspector registry

- [x] Port the Web picker interaction into `packages/theme-ui`; Desktop uses it rather than a
      browser-native picker or a second color conversion implementation.
- [ ] Verify and complete the portable picker against the Web component: eyedropper fallback,
      hex/OKLCH/RGB/HSL format selection, palette swatches, keyboard/focus handling, and exact
      popup layering. This is an adaptation of `apps/web/components/kibo-ui/color-picker` and
      `theme-transpiler/color-picker`, not a screenshot recreation.
- [ ] Implement a read-only Theme Workspace data model: parse the project theme source, identify
      light/dark CSS-variable groups and source palettes, and display engine-backed normalized
      values, contrast, validity, and scale output.
- [ ] Add one token edit vertical slice: picker/token field → ephemeral preview → CSS-variable
      proposal → Change Store → apply/HMR/undo. Validate it against the same color-engine outputs
      shown by the Web app.
- [ ] Add palette-to-theme synthesis, mindful/Radix algorithms, export, and bulk token proposals
      only after single-token transactions are proven.
- [ ] Replace ad-hoc inspector calls with a typed control registry: each control has source value,
      preview value, preview override, operation generator, capability/unsupported state, and reset.
- [ ] Add inspector controls in value groups (layout first; spacing/type/color after), measuring
      each against the relevant overlay descriptor/operation. Keep the floating bar as a compact
      mode/status surface, not a duplicate full inspector.
- [ ] Add structural actions (duplicate, delete, reorder) last, after class/text/theme proposals
      are stable and fully reviewable.

**Exit:** the Theme Workspace and initial Inspector controls share the web app's color semantics
and every supported edit is preview-first and reviewable before source writes.

### Phase 4 — ACP agent, after the Change Store is real

- [ ] Implement ACP stdio client and profile configuration.
- [ ] Add Codex/Claude known profiles and a custom ACP command profile.
- [ ] Add capability negotiation, authentication, permissions, event normalization,
      cancellation, and diagnostics.
- [ ] Expose the existing ThemeLab MCP context per session.
- [ ] Add worktree, read-only/approval, and explicitly consented direct-workspace modes.
- [ ] Route agent changes into the same Changes store; never create a second approval path.

**Exit:** a user can select a component, ask an authenticated known agent for a change, observe
activity, review its diff beside visual edits, and safely keep or revert it.

### Phase 5 — product hardening and migration

- [ ] Desktop E2E and security coverage against Next.js and Vite fixtures, including stale
      writes, recovery, navigation/permission denial, preview sizing, and agent fake-server tests.
- [ ] Package, sign, and notarize the macOS primary build; add other platforms only after their
      manual matrix passes.
- [ ] Add a CLI action to open the same project in Desktop.
- [ ] Document the intentional behavioral split: CLI overlay for rapid browser work; Desktop for
      workspace, reviewed changes, project theme work, and ACP.

## 19. V1 acceptance criteria

V1 is complete when all of the following are demonstrated against at least one Next.js and
one Vite fixture project:

1. Desktop opens the project and starts or connects to its dev server.
2. Preview loads through the loopback proxy with HMR and no Node capability.
3. Selecting an element reports the correct app source file/location and owner trace.
4. A Tailwind property edit previews immediately without touching disk.
5. Changes shows the exact proposed diff and affected files.
6. Apply rejects a stale baseline, never reports success after a partial write, and can
   detect/recover an interrupted multi-file transaction.
7. Applied change survives HMR; undo restores it when no conflict exists.
8. Theme CSS-variable and inline text edits use the same proposal/apply path.
9. A project token edited in Desktop uses the shared web theme engine for parsing, OKLCH
   normalization, format conversion, and contrast feedback; its output matches the web app.
10. Unexpected preview navigation and browser permissions are denied visibly.
11. Codex and Claude ACP sessions start with existing local authentication on the primary
    platform, or present their adapter-provided auth flow.
12. Selected component context is available to the agent through ThemeLab MCP.
13. Agent tool/terminal/file/permission events render without freezing the preview.
14. Worktree-mode agent changes can be reviewed and applied without modifying the user's
    working tree before approval.
15. Direct-workspace mode is clearly labeled and requires explicit session consent.
16. Closing the workspace stops owned dev/proxy/agent processes and releases ports.
17. Existing CLI tests and supported behavior remain green.

## 20. Test strategy

- **Unit:** path containment, schemas, operation generation, transforms, diff generation,
  transaction rollback, recovery manifests, ACP event normalization.
- **Integration:** Electron IPC sender validation, workspace lifecycle, dev child process,
  proxy injection, WebSocket bridge, ACP fake server, permission responses.
- **Fixture E2E:** packaged/dev Desktop against controlled Next.js and Vite projects with
  deterministic selections and expected source diffs.
- **Security:** navigation denial, Node absence in preview, denied permissions, malformed IPC,
  symlink escape, stale writes, malicious preview messages, agent executable/argument validation.
- **Manual matrix:** macOS first; Windows and Linux before claiming cross-platform support.

## 21. Key risks and mitigations

| Risk | Mitigation |
| --- | --- |
| Native preview bounds drift from React layout | One bounds owner, resize observer, DPI E2E tests |
| Local app auth/popups behave differently embedded | Phase 0 spike; explicit external-browser fallback |
| Preview content reaches desktop privileges | Separate sandboxed view, no Node, no generic bridge, strict IPC/navigation policy |
| AST core is coupled to direct filesystem writes | Extract behind content-in/result-out interfaces before Desktop UI work |
| Agent adapters expose inconsistent capabilities | ACP capability negotiation and honest per-session labels |
| Agent writes bypass ThemeLab approval | Worktree default; read-only/approval mode; direct mode explicitly unsafe |
| Worktrees conflict with dirty/untracked files | Explain limitations; snapshot/stash is never automatic; offer read-only/direct alternatives |
| UI tries to become a full IDE | Keep files secondary; optimize selection → visual tune → diff → apply |
| DialKit-inspired controls cannot express source semantics | ThemeLab-owned control registry with typed preview and source adapters |
| Web and desktop color behavior drifts | Extract the tested theme engine; share one parser, formatter, validator, scale, and export surface |
| Rebuilt controls regress familiar ThemeLab affordances | Reuse portable web controls and canonical icon sources; do not hand-draw substitutes |
| Electron footprint/security concerns | Current Electron, sandbox/context isolation, narrow preload, fuses, signed builds |

## 22. Open product questions

These do not block Phase 0, but must be answered before public v1:

- Is macOS the only launch platform, or must v1 ship on Windows/Linux simultaneously?
- Should Desktop remain fully local/free, or is agent/worktree history part of a paid product?
- Should the app remember ACP conversations, and if so, for how long and in what format?
- Is “Promote to DialKit” valuable enough for the first post-v1 milestone?
- Should the hosted theme studio remain separate or become a Desktop workspace tab?

## 23. References

- Electron web embeds and `WebContentsView`:
  <https://www.electronjs.org/docs/latest/tutorial/web-embeds>
- Electron security guidance:
  <https://www.electronjs.org/docs/latest/tutorial/security>
- ACP registry:
  <https://agentclientprotocol.com/get-started/registry>
- Codex ACP adapter:
  <https://github.com/agentclientprotocol/codex-acp>
- DialKit:
  <https://joshpuckett.me/dialkit>
