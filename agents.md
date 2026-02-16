# agents.md

Instructions for AI coding agents working on Exedeck (Electron + Vue + Vite).

## Goals
- Keep diffs small, safe, and easy to review.
- Preserve renderer security (no `nodeIntegration`, no generic `ipcRenderer` exposure).
- Keep the UI type-safe and responsive (Vue 3 + Composition API + TypeScript).
- Follow the existing IPC/config/state patterns rather than inventing new APIs.

## Tech stack (actual)
- **Electron** (v40) bootstrapped via `electron-vite` with `electron-builder` packaging.
- **Renderer:** Vue 3 + TypeScript using `<script setup>`, `xterm`/`xterm-addon-fit`, and `pidusage` for stats.
- **Preload bridge:** `electron/preload.ts` exposes a typed `window.exedeck` API defined in `shared/types.ts`.
- **CLI:** `npm` with `typecheck`, `build`, `smoke`, `start`, `pack`, `dist`, `dist:win`, `dist:linux` scripts.

## Repository layout (single source of truth)
- `electron/main.ts` — app lifecycle, IPC handlers, auto-start logic, smoke test handshake.
- `electron/config.ts` — config schema/migration, persistent `exedeck.config.json` in `app.getPath('userData')`, helpers for normalize/save/load.
- `electron/taskManager.ts` — PTY lifecycle (`node-pty`), Ctrl+C + tree kill, buffer retention, streaming events back to renderer.
- `electron/preload.ts` — secure `contextBridge` exposures for config, task control, dialogs, and event subscriptions.
- `shared/types.ts` — App/Project/Task schema plus `ExedeckApi` and every IPC event payload.
- `src/` — Vue renderer (see `App.vue`, `src/components/*`, `src/state/store.ts`, `src/main.ts`).
- `build/`, `release/` — assets and build outputs controlled by `electron-builder` config in `package.json`.

## Key renderer patterns
- `src/state/store.ts` is the single source of truth for selected project/task, filter, stats, buffers, and listeners.
- Always call `useStore().loadConfig()` from `App.vue` on mount; it hydrates buffers via `window.exedeck.taskGetBuffer` and attaches listeners once.
- Components subscribe via props (`Sidebar`, `Toolbar`, `TerminalView`, `SettingsModal`, `OnboardingWizard`) and emit events that delegate back to `useStore()` helpers.
- The Onboarding wizard and Settings modal keep config editing centralized; persist through `useStore().saveConfig()` so selections stay in sync.

## IPC & security rules
- Renderer ↔ Main uses `ipcMain.handle` + `ipcRenderer.invoke`, never `ipcRenderer.send`/`on` directly from components.
- Preload exposes only the typed `window.exedeck` API (no blanket `ipcRenderer`).
- `contextIsolation: true`, `nodeIntegration: false`, never expose `process` / Node globals to renderer.
- Validate and normalize every config payload in `electron/config.ts`; treat renderer data as untrusted.
- Task events (`task:data`, `task:status`, `task:stats`, `task:exit`) always flow from main to renderer via the bridge; maintain max buffer (≈250k chars).

## Feature-specific details to respect
- Auto-start only runs tasks when both project and task `autoStart` flags are true (see `startConfiguredAutoTasks`).
- Stats polling uses `pidusage` every second and resets stats when tasks stop.
- Buffered task output must persist across task switches; renderer caches it per task (capped in `store.ts`).
- Terminal input is forwarded via `window.exedeck.taskInput`; `TerminalView` exposes `focusTerminal()`/`clearTerminal()` methods used in `Toolbar` actions.
- Projects/tasks are ordered and identified by generated IDs; avoid assumptions about numeric indexes.

## Coding conventions
- Prefer precise interfaces from `shared/types.ts`; avoid `any` unless impossible.
- Use `<script setup lang="ts">` in Vue files with the Composition API.
- Keep components focused; extract reusable logic into composables (e.g., `useStore()` already encapsulates shared behavior).
- Avoid mutating props directly—emit events to parent components and let the store handle changes.
- Keep line length reasonable (≈80 chars) unless readability suffers.

## Scripts & tooling
- `npm run typecheck` runs `tsc --noEmit`.
- `npm run build` cross-builds main/preload/renderer via `electron-vite build`.
- `npm run pack`/`npm run dist`/`npm run dist:win`/`npm run dist:linux` wrap `electron-builder` for packaging.
- `npm run smoke` launches the built app with `SMOKE=1` to assert the bridge/buffer flow; it self-terminates (`SMOKE_OK`/`SMOKE_FAIL`).
- `npm run start` / `npm run start:linux` run the app (Linux mode adds `--no-sandbox`).
- No other package managers; stay within existing npm scripts.

## Documentation
- Update `README.md` for any user-facing behavior changes (features, config, scripting).
- Update `agents.md` only when workflows/conventions change.

## What to ask (only if needed)
- Confirm whether a config change should trigger onboarding completion, especially if modifying `onboardingCompleted` handling.
- Ask if a new IPC channel belongs in the existing `window.exedeck` API or if a new domain-specific bridge is acceptable.
- Ask if a native dialog or privileged action should be in main/preload instead of renderer.

