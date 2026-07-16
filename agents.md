# agents.md

Instructions for AI coding agents working on Exedeck (Electron + Vue + Vite).

## Goals

- Keep diffs small, safe, and easy to review.
- Preserve renderer security (no `nodeIntegration`, no generic `ipcRenderer` exposure).
- Keep the UI type-safe and responsive (Vue 3 + Composition API + TypeScript).
- Follow the existing IPC/config/state patterns rather than inventing new APIs.

## Tech stack (actual)

- **Electron** (v43) bootstrapped via `electron-vite` with `electron-builder` packaging.
- **Renderer:** Vue 3 + TypeScript using `<script setup>`, `xterm`/`xterm-addon-fit`, and `pidusage` for stats.
- **Preload bridge:** `electron/preload.ts` exposes a typed `window.exedeck` API defined in `shared/types.ts`.
- **CLI:** `npm` with `dev`, `start`, `check`, `test`, `test:a11y`, `typecheck`, `build`, `smoke`, and packaging scripts.

## Repository layout (single source of truth)

- `electron/main.ts` — app lifecycle, IPC handlers, auto-start logic, smoke test handshake.
- `electron/config.ts` — schema-v5 normalization, persistent `exedeck.config.json` in `app.getPath('userData')`, and atomic save/load helpers.
- `electron/processRuntime.ts` — shared PTY lifecycle (`node-pty`), Ctrl+C + tree kill, buffer retention, and streaming events.
- `electron/taskManager.ts`, `electron/agentManager.ts` — task and agent adapters over the shared runtime.
- `electron/workspaceService.ts` — serialized workspace create, rebind, finish, merge, remove, and archive coordination.
- `electron/gitService.ts` — checkout resolution, bounded Git runner/parsers, and serialized mutations.
- `electron/preload.ts` — secure `contextBridge` domains for projects, processes, agents, Git, AI, dialogs, and subscriptions.
- `shared/types.ts` — schema v5 plus domain APIs and every IPC event payload.
- `src/` — Vue renderer (see `App.vue`, `src/components/*`, `src/state/store.ts`, `src/main.ts`).
- `build/`, `release/` — assets and build outputs controlled by `electron-builder` config in `package.json`.

## Key renderer patterns

- `src/state/store.ts` is the single source of truth for the selected project/workspace/task, stats, buffers, and listeners.
- Always call `useStore().loadConfig()` from `App.vue` on mount; it hydrates buffers via `window.exedeck.taskGetBuffer` and attaches listeners once.
- Components subscribe via props (`Sidebar`, `Toolbar`, `TerminalView`, `SettingsModal`, `OnboardingWizard`) and emit events that delegate back to `useStore()` helpers.
- The Onboarding wizard and Settings modal keep config editing centralized; persist through `useStore().saveConfig()` so selections stay in sync.

## IPC & security rules

- Renderer ↔ Main uses `ipcMain.handle` + `ipcRenderer.invoke`, never `ipcRenderer.send`/`on` directly from components.
- Preload exposes only the typed `window.exedeck` API (no blanket `ipcRenderer`).
- `contextIsolation: true`, `nodeIntegration: false`, never expose `process` / Node globals to renderer.
- Keep the Chromium renderer sandbox enabled, reject non-main-frame IPC, and deny navigation, popups, and permissions by default.
- Validate and normalize every config payload in `electron/config.ts`; treat renderer data as untrusted.
- Task events (`task:data`, `task:status`, `task:stats`, `task:exit`) always flow from main to renderer via the bridge; maintain max buffer (≈250k chars).
- Initial task and agent state uses bulk status snapshots. Terminal buffers are loaded lazily for the selected workspace or task; do not restore per-item startup hydration.

## Feature-specific details to respect

- Auto-start only runs tasks when both project and task `autoStart` flags are true (see `startConfiguredAutoTasks`).
- Manual task starts bind to the active workspace checkout; auto-start tasks bind to the project root.
- Workspace metadata is persistent, but agent processes never auto-start and terminal transcripts do not survive a full app quit.
- Stats polling uses one batched `pidusage` request and one IPC event per cycle, with a recursive timeout so collections cannot overlap.
- Buffered output persists in the main-process runtime. The renderer caches only terminals that have been opened and reloads a buffer when selected.
- Terminal input is forwarded via `window.exedeck.taskInput`; `TerminalView` exposes `focusTerminal()`/`clearTerminal()` methods used in `Toolbar` actions.
- Projects/tasks are ordered and identified by generated IDs; avoid assumptions about numeric indexes.

## Coding conventions

- Prefer precise interfaces from `shared/types.ts`; avoid `any` unless impossible.
- Use `<script setup lang="ts">` in Vue files with the Composition API.
- Keep components focused; extract reusable logic into composables (e.g., `useStore()` already encapsulates shared behavior).
- Avoid mutating props directly—emit events to parent components and let the store handle changes.
- Keep line length reasonable (≈80 chars) unless readability suffers.

## Scripts & tooling

- `npm run typecheck` checks Vue SFC/renderer code with `vue-tsc` and the
  Electron main/preload code with a Node-only TypeScript configuration.
- `npm run dev` starts electron-vite with renderer HMR and main/preload reloads.
- `npm run dev` and `npm start` use isolated development application data.
- `npm start` builds and launches a production preview through electron-vite.
- `npm run build` builds main/preload/renderer via `electron-vite build` without launching.
- `npm install`/`npm ci` installs the Electron binary and rebuilds native app
  dependencies through the root `postinstall` script.
- `npm run test:watch` runs Vitest in watch mode during development.
- `npm run test:ui` builds and runs the isolated Playwright Electron visual
  suite at the default and minimum supported window sizes.
- `npm run test:ui:update` regenerates visual baselines after the resulting
  screenshots have been reviewed.
- `npm run lint`, `npm run format`, and `npm run format:check` enforce the repository ESLint and Prettier baseline.
- `npm test` runs Vitest unit and Vue component tests; `npm run check` runs formatting, lint, typecheck, tests, and build.
- `npm run test:a11y` launches an isolated built app and runs axe against key views (requires a graphical session).
- `npm run pack`/`npm run dist`/`npm run dist:win`/`npm run dist:mac`/`npm run dist:linux` wrap `electron-builder` for packaging.
- `npm run smoke` builds and launches an isolated app profile to assert the
  bridge/buffer flow; it self-terminates (`SMOKE_OK`/`SMOKE_FAIL`).
- `.github/workflows/ci.yml` runs checks, Electron smoke tests, and packaging on Linux, Windows, and macOS.
- `.github/workflows/release.yml` creates signed/notarized GitHub release assets from version tags after `npm run release:verify` validates the tag and credentials.
- No other package managers; stay within existing npm scripts.

## Documentation

- Update `README.md` for any user-facing behavior changes (features, config, scripting).
- Update `agents.md` only when workflows/conventions change.

## What to ask (only if needed)

- Confirm whether a config change should trigger onboarding completion, especially if modifying `onboardingCompleted` handling.
- Ask if a new IPC channel belongs in the existing `window.exedeck` API or if a new domain-specific bridge is acceptable.
- Ask if a native dialog or privileged action should be in main/preload instead of renderer.
