# Exedeck

Exedeck is a cross-platform workbench for persistent project workspaces. Every
project has a permanent Root workspace and can add isolated Git worktree
workspaces. Each workspace can contain multiple CLI agents, persistent
terminals, and project tasks. Starting processes always remains explicit.

## Highlights

- Restore the last-opened workspace while keeping its items stopped after an app
  restart. Terminal output remains available while switching workspaces during
  the current app session.
- Navigate a three-level project, workspace, and item tree. Selecting any level
  changes the center workbench to the matching overview or terminal.
- Use the permanent Root workspace or create isolated sibling worktrees on
  editable branches.
- Add multiple Codex, Claude, or custom CLI agents to any workspace.
- Add interactive shells or command terminals such as `npm run dev`; they start
  immediately and keep running while navigating elsewhere in the application.
- Remove a worktree workspace with a guarded merge/remove flow. Agents and
  checkouts must be stopped and clean; optional branch deletion is safe-only
  and disabled by default.
- Recover from moved or deleted worktrees by rebinding or removing the
  workspace instead of silently falling back to the project root.
- Run multiple PTY-backed project tasks with explicit Start, Stop, and Restart
  actions. Manual starts use the active workspace checkout; auto-start tasks
  continue to use the project root.
- Monitor CPU and memory usage for running tasks.
- Configure projects, task arguments, working folders, and coordinated
  auto-start behavior.
- Scaffold Laravel and AdonisJS projects with live output and safe cancellation.
- Run Codex, Claude, and custom interactive agent CLIs in project roots or Git
  worktrees. Workspace metadata persists while terminal output remains bounded
  in-memory runtime state.
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

- Node.js 22.12 or newer with npm
- Platform build tools required by `node-pty`
- A graphical session for Electron runtime and accessibility smoke tests

Run `npm install` after cloning. The repository records approvals for the
dependency install scripts used by the build toolchain. The project postinstall
step installs the pinned Electron binary and rebuilds `node-pty` for that
runtime.

Node 24 is the repository's default development and CI version (`.nvmrc`),
matching the Node major embedded in Electron.

## Commands

- `npm run dev` — launch Electron with renderer hot module replacement and
  automatic restarts when main or preload code changes. Development uses an
  isolated application-data directory so it cannot overwrite installed-app
  settings.
- `npm start` — build and launch a production preview of the desktop app.
- `npm run test:watch` — rerun unit tests as files change.
- `npm run lint` — check TypeScript, JavaScript, and Vue files with ESLint.
- `npm run format`, `npm run format:check` — write or verify the Prettier baseline.
- `npm run typecheck` — run TypeScript checks.
- `npm test` — run unit and Vue component tests.
- `npm run build` — build main, preload, and renderer bundles without launching
  the app.
- `npm run check` — run formatting, lint, type checking, tests, and the production build.
- `npm run smoke` — build into an isolated temporary profile, exercise Electron,
  preload, and PTY output, then exit automatically.
- `npm run test:a11y` — build, launch an isolated Electron profile, and run axe
  against the workspace, settings, and delete confirmation views.
- `npm run pack` — produce an unpacked application in `release/`.
- `npm run dist`, `npm run dist:win`, `npm run dist:mac`, `npm run dist:linux` — create installers.

The smoke commands are self-terminating and are not normal launch modes.

## Releases and updates

Pushing a tag matching the package version, such as `v1.0.0`, runs the release
workflow on Linux, Windows, and macOS and publishes the platform artifacts to
GitHub Releases. Windows and macOS jobs deliberately fail instead of publishing
unsigned builds when their signing credentials are missing.

Configure `WINDOWS_CSC_LINK` and `WINDOWS_CSC_KEY_PASSWORD` for Authenticode.
Configure `MACOS_CSC_LINK`, `MACOS_CSC_KEY_PASSWORD`, `APPLE_API_KEY`,
`APPLE_API_KEY_ID`, and `APPLE_API_ISSUER` for Developer ID signing and
notarization. Store the contents of the App Store Connect `.p8` file in
`APPLE_API_KEY`; the workflow writes it to a protected temporary file. Apple ID
notarization credentials supported by electron-builder can be used instead of
the API-key trio.

Packaged NSIS, macOS, and AppImage installations check GitHub Releases shortly
after startup. Updates are downloaded only after confirmation and installed on
an explicit restart or the next quit. Linux package-manager installations stay
under their package manager's control. Set `EXEDECK_DISABLE_UPDATES=1` to disable
checks in managed environments.

## Keyboard access

- `Ctrl/Cmd+F` focuses the project/workspace filter.
- `Ctrl/Cmd+Shift+N` creates a worktree workspace in the selected project.
- `Ctrl/Cmd+G` toggles the Git inspector.
- Control + backtick, or `F6`, focuses the interactive terminal.
- `F11` toggles full-screen mode.
- `Escape` closes dismissible dialogs; confirmations keep focus contained.

The frameless title bar exposes File, Workspace, View, and Help menus plus
window controls. Privileged menu commands still pass through the restricted
preload bridge.

## Configuration

The persisted schema contains:

- `projects[]` with name, absolute path, framework, and `autoStart`.
- `tasks[]` with command, argument array, inherited working directory, and
  `autoStart`.
- `onboardingCompleted` and the schema version.
- application preferences for appearance, editor, clone folder, AI profile,
  and the last-opened workspace.
- `agentProfiles[]` for built-in or custom terminal CLIs.
- `workspaces[]` binding a permanent root or optional worktree checkout to
  nested `agents[]` and `terminals[]` definitions.

Schema v6 is the active-development baseline. Exedeck normalizes the current
configuration shape and supplies Codex and Claude profiles when no profiles
exist; it does not promise migration compatibility with pre-release schemas.

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
- `electron/preload.ts` — narrow typed `projects`, `processes`, `agents`,
  `workspaces`, `git`, `ai`, and `window` context-bridge domains.
- `electron/processRuntime.ts` — shared PTY lifecycle, bounded buffers,
  restart/stop, resize/input, and shutdown behavior.
- `electron/processCommand.ts` — cross-platform PTY command construction and
  Windows command-line escaping.
- `electron/taskManager.ts` and `electron/agentManager.ts` — checkout-bound task
  and workspace-agent adapters over the shared process runtime.
- `electron/workspaceService.ts` — serialized create, rebind, finish, merge,
  worktree removal, and archive coordination.
- `electron/gitService.ts` — bounded Git command execution, parsing, checkout
  resolution, and per-project mutation locking.
- `electron/aiService.ts` — provider boundary for editable Git text generation,
  currently implemented with Codex CLI.
- `electron/provisioningJobManager.ts` — scaffold job lifecycle and project
  registration data.
- `electron/config.ts` — schema normalization, malformed-file backup, and atomic
  persistence.
- `electron/updateService.ts` — packaged-app update checks and user-controlled
  download/install prompts.
- `shared/types.ts` — shared config, events, and preload contract.
- `src/state/store.ts` — renderer state and IPC subscriptions.
- `src/components/` — workspace navigator, agent workbench, Git inspector, task
  panel, terminal, settings, onboarding, clone, and scaffold UI.
- `src/composables/useDialogFocus.ts` — dialog focus containment/restoration.
- `scripts/accessibility-smoke.mjs` — live Electron axe regression check.

## Visual UI checks

The Playwright suite launches the built Electron application with isolated,
seeded user data. It covers onboarding, project, workspace, task, settings, and
confirmation states at the default `1280x800` size and the minimum supported
`760x560` size.

```bash
npm run test:ui
```

When an intentional UI change needs new reviewed baselines, regenerate them
with `npm run test:ui:update`. Failure traces and screenshots are written to
`test-results/`, and the HTML report is written to `playwright-report/`.
