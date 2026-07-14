# Exedeck

Exedeck is a cross-platform Electron workspace for running and monitoring
long-lived development commands. Projects and tasks stay organized in a native
desktop shell while each process gets an interactive, buffered terminal.

## Highlights

- Run multiple PTY-backed tasks concurrently, with explicit Start, Stop, and
  Restart actions.
- Preserve terminal output while switching tasks and after renderer reloads.
- Monitor CPU and memory usage for running tasks.
- Configure projects, task arguments, working folders, and coordinated
  auto-start behavior.
- Scaffold Laravel and AdonisJS projects with live output and safe cancellation.
- Follow the operating system's light or dark appearance.
- Navigate with the keyboard, visible focus indicators, labeled dialogs, live
  status announcements, screen-reader terminal support, reduced motion, and
  forced-colors support.

## Requirements

- A current Node.js release with npm
- Platform build tools required by `node-pty`
- A graphical session for Electron runtime and accessibility smoke tests

Run `npm install` after cloning. The repository records approvals for the
specific dependency install scripts needed to download Electron/esbuild and
compile `node-pty`.

## Commands

- `npm start` — launch the built desktop app.
- `npm run typecheck` — run TypeScript checks.
- `npm test` — run unit tests for configuration and argument handling.
- `npm run build` — build main, preload, and renderer bundles.
- `npm run check` — run type checking, unit tests, and the production build.
- `npm run smoke` — launch the built app, exercise preload + PTY output, and
  exit automatically.
- `npm run test:a11y` — build, launch an isolated Electron profile, and run axe
  against the workspace, settings, and delete confirmation views.
- `npm run pack` — produce an unpacked application in `release/`.
- `npm run dist`, `npm run dist:win`, `npm run dist:linux` — create installers.

The smoke commands are self-terminating and are not normal launch modes.

## Keyboard access

- `Ctrl/Cmd+F` focuses the project/task filter.
- `Ctrl/Cmd+,` opens settings for the selected project.
- Control + backtick, or `F6`, focuses the interactive terminal.
- `Escape` closes dismissible dialogs; confirmations keep focus contained.

Standard platform Edit, View, Window, zoom, full-screen, and quit actions are
also exposed through Electron's native application menu.

## Configuration

The persisted schema contains:

- `projects[]` with name, absolute path, framework, and `autoStart`.
- `tasks[]` with command, argument array, inherited working directory, and
  `autoStart`.
- `onboardingCompleted` and the schema version.

Exedeck normalizes and bounds untrusted renderer payloads in the main process.
Writes are atomic and private to the current user where the platform supports
file modes. If the JSON is malformed, Exedeck preserves it as an
`exedeck.config.json.invalid-*` backup before creating a default configuration.

On startup, a task runs automatically only when both its project and the task
itself have auto-start enabled. Editing or removing the definition of a running
task stops the old process before saving the new configuration.

## Electron security model

- Renderer sandbox and context isolation are enabled.
- Node integration, popups, arbitrary navigation, web permissions, and packaged
  DevTools are disabled.
- A restrictive Content Security Policy blocks plugins, frames, forms, and
  non-local connections.
- The preload exposes only the typed `window.exedeck` API; renderer components
  never receive Electron or Node primitives.
- Every invoke is restricted to the main frame and validates IDs, types, sizes,
  configuration shape, and scaffold options in the main process.
- A single-instance lock focuses the existing window instead of starting a
  second process manager.
- App shutdown stops PTY process trees and active scaffold jobs before exit,
  with a bounded force-quit fallback.

## Architecture

- `electron/main.ts` — app lifecycle, native window/menu, hardened IPC, stats,
  auto-start, and runtime smoke flow.
- `electron/preload.ts` — narrow typed context bridge.
- `electron/taskManager.ts` — PTY lifecycle, buffer retention, restart/stop,
  config reconciliation, and shutdown.
- `electron/provisioningJobManager.ts` — scaffold job lifecycle and project
  registration data.
- `electron/config.ts` — schema normalization, migration, backup, and atomic
  persistence.
- `shared/types.ts` — shared config, events, and preload contract.
- `src/state/store.ts` — renderer state and IPC subscriptions.
- `src/components/` — workspace navigation, terminal, settings, onboarding, and
  scaffold UI.
- `src/composables/useDialogFocus.ts` — dialog focus containment/restoration.
- `scripts/accessibility-smoke.mjs` — live Electron axe regression check.
