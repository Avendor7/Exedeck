# Exedeck

Exedeck is a cross-platform Electron workspace for running and monitoring
long-lived development commands, terminal agents, and local Git workflows.
Projects stay organized in a native desktop shell while tasks and agents get
interactive, buffered terminals and every Git operation stays scoped to a
known project checkout.

## Highlights

- Run multiple PTY-backed tasks concurrently, with explicit Start, Stop, and
  Restart actions.
- Preserve terminal output while switching tasks and after renderer reloads.
- Monitor CPU and memory usage for running tasks.
- Configure projects, task arguments, working folders, and coordinated
  auto-start behavior.
- Scaffold Laravel and AdonisJS projects with live output and safe cancellation.
- Run Codex, Claude, and custom agent CLIs concurrently in project roots or Git
  worktrees. Session definitions persist while terminal output remains bounded
  runtime state.
- Inspect structured changes and patches; stage, unstage, discard, stash,
  commit, browse history, manage branches, and fetch/pull/push.
- Create and remove worktrees, with branch-changing operations blocked while a
  task or agent is using the affected checkout.
- Associate a child branch with a local parent and explicitly merge updates
  from that parent only when the checkout is clean; fetching remains separate.
- Clone repositories and register them as Exedeck projects without maintaining
  a second repository registry.
- Generate an editable commit summary and description from staged changes with
  a configured Codex CLI profile. Exedeck always asks before committing or
  other consequential branch operations.
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
- `Ctrl/Cmd+1`, `2`, and `3` open Tasks, Agents, and Git.
- `Ctrl/Cmd+N` creates a project; add Shift to clone a repository.
- `F5`, `Shift+F5`, and `Ctrl/Cmd+Shift+F5` start, stop, and restart the
  selected task.
- Control + backtick, or `F6`, focuses the interactive terminal.
- `F11` toggles full-screen mode.
- `Escape` closes dismissible dialogs; confirmations keep focus contained.

The frameless application title bar exposes File, Edit, View, Process, Window,
and Help menus plus minimize, maximize/restore, and close controls. Privileged
menu commands still pass through the restricted preload bridge.

## Configuration

The persisted schema contains:

- `projects[]` with name, absolute path, framework, and `autoStart`.
- `tasks[]` with command, argument array, inherited working directory, and
  `autoStart`.
- `onboardingCompleted` and the schema version.
- application preferences for appearance, editor, clone folder, and AI profile.
- `agentProfiles[]` for built-in or custom terminal CLIs and `agentSessions[]`
  binding each session to a project and checkout.

Schema v4 is migrated automatically from earlier configurations. Existing
projects and tasks keep their IDs and definitions; Codex and Claude profiles
are added only when no profiles exist.

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

- `electron/main.ts` — app lifecycle, frameless window commands, hardened domain IPC,
  stats, auto-start, and runtime smoke flow.
- `electron/preload.ts` — narrow typed `projects`, `processes`, `agents`, `git`,
  `ai`, and `window` context-bridge domains.
- `electron/processRuntime.ts` — shared PTY lifecycle, bounded buffers,
  restart/stop, resize/input, and shutdown behavior.
- `electron/taskManager.ts` and `electron/agentManager.ts` — task and persisted
  agent-session adapters over the shared process runtime.
- `electron/gitService.ts` — bounded Git command execution, parsing, checkout
  resolution, and per-project mutation locking.
- `electron/aiService.ts` — provider boundary for editable Git text generation,
  currently implemented with Codex CLI.
- `electron/provisioningJobManager.ts` — scaffold job lifecycle and project
  registration data.
- `electron/config.ts` — schema normalization, migration, backup, and atomic
  persistence.
- `shared/types.ts` — shared config, events, and preload contract.
- `src/state/store.ts` — renderer state and IPC subscriptions.
- `src/components/` — Tasks, Agents, Git, terminal, settings, onboarding,
  clone, and scaffold UI.
- `src/composables/useDialogFocus.ts` — dialog focus containment/restoration.
- `scripts/accessibility-smoke.mjs` — live Electron axe regression check.
