# Exedeck

Cross-platform Electron desktop app (Windows + Linux) to run and monitor multiple long-lived developer commands with a process sidebar and ANSI terminal output.

## Stack

- Electron + electron-vite
- Vue 3 + TypeScript (`<script setup>`) 
- `node-pty` for PTY process spawning
- `xterm` + `xterm-addon-fit` for terminal rendering
- `pidusage` for CPU/MEM polling
- `tree-kill` for stop fallback after Ctrl+C

## Scripts

- `npm run typecheck` - TypeScript checks (`tsc --noEmit`)
- `npm run build` - Builds main, preload, and renderer
- `npm run smoke` - Launches built app in smoke mode and auto-quits
- `npm run start` - Launches the desktop app
- `npm run start:linux` - Launches app with `--no-sandbox`

`smoke` is intentionally self-terminating and should not be used as normal run mode.

## Features

- Multiple projects, each with their own command list.
- Multiple tasks can run concurrently.
- Full settings/configuration modal:
  - Add/edit/remove projects
  - Configure command, args, cwd per task
  - Configure auto-start per project and per task
- First-run onboarding wizard to create the initial project and startup commands.
- Start/Stop/Restart for tasks:
  - Stop sends Ctrl+C first
  - If still running, falls back to process tree kill
- Per-task output buffers are preserved when switching tasks.
- Sidebar filtering with `Filter processes...` input.
- CPU and memory stats polled every second for running tasks.
- Config persisted to Electron user data (`exedeck.config.json`).
- Secure IPC preload bridge with context isolation.

## Configuration Model

The config schema stores:

- `projects[]`
- `project.autoStart`
- `tasks[]`
- `task.autoStart`
- `task.command` + `task.args` (task working directory inherits from `project.path`)

On startup, Exedeck auto-starts only tasks where both the project and task auto-start toggles are enabled.

## IPC Contract

Renderer -> Main (`invoke`):

- `config:get`
- `config:set`
- `task:start`
- `task:stop`
- `task:restart`
- `task:input`
- `task:get-buffer`
- `task:clear-buffer`

Main -> Renderer (`events`):

- `task:data`
- `task:status`
- `task:stats`
- `task:exit`

## Security

- `contextIsolation: true`
- `nodeIntegration: false`
- No remote module usage
- Narrow preload bridge exposed via `contextBridge`

## Project Structure

- `electron/main.ts` - app bootstrap, IPC, stats polling, auto-start, smoke flow
- `electron/preload.ts` - secure IPC bridge
- `electron/taskManager.ts` - PTY lifecycle, buffers, restart/stop behavior
- `electron/config.ts` - config schema defaults, migration, persistence
- `shared/types.ts` - shared config/task/event types
- `src/App.vue` - main layout and orchestration
- `src/components/Sidebar.vue` - project list + task list
- `src/components/OnboardingWizard.vue` - first-run setup flow
- `src/components/SettingsModal.vue` - full settings editor
- `src/components/TerminalView.vue` - xterm integration
- `src/components/Toolbar.vue` - task action buttons
- `src/state/store.ts` - renderer state and IPC subscriptions
