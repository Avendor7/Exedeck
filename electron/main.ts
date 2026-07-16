import { app, BrowserWindow, dialog, ipcMain, Menu, shell } from 'electron'
import type { IpcMainInvokeEvent } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import pidusage from 'pidusage'
import { createDefaultConfig, loadOrCreateConfig, normalizeConfig, resolveRepoRoot, saveConfig } from './config'
import { ProvisioningJobManager } from './provisioningJobManager'
import { TaskManager } from './taskManager'
import { AgentManager } from './agentManager'
import { AiService } from './aiService'
import { GitService } from './gitService'
import { WorkspaceService } from './workspaceService'
import { startUpdateChecks } from './updateService'
import { spawn } from 'node:child_process'
import type {
  AgentStartRequest,
  AppConfig,
  GitBranchCreateRequest,
  GitCloneRequest,
  GitWorktreeCreateRequest,
  ProjectCreateDoneEvent,
  ProjectCreateRequest,
  TaskConfig,
  TaskStartRequest,
  WindowCommand,
  WorkspaceCreateRequest,
  WorkspaceRebindRequest,
} from '../shared/types'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const isUnpackaged = !app.isPackaged
const rendererDevServerUrl = process.env.ELECTRON_RENDERER_URL
const isSmoke = process.env.SMOKE === '1'
const isAccessibilityTest = isUnpackaged && process.env.ACCESSIBILITY_TEST === '1'
if (isUnpackaged && process.env.EXEDECK_USER_DATA_DIR) {
  app.setPath('userData', path.resolve(process.env.EXEDECK_USER_DATA_DIR))
} else if (isUnpackaged && process.env.EXEDECK_DEV_USER_DATA === '1') {
  app.setPath('userData', `${app.getPath('userData')}-development`)
}
const repoRoot = resolveRepoRoot(process.cwd())

let mainWindow: BrowserWindow | null = null
let appConfig: AppConfig = createDefaultConfig()
let statsTimer: NodeJS.Timeout | null = null
let cleanupComplete = false
let cleanupStarted = false
let configMutationQueue = Promise.resolve()

function serializeConfigMutation<T>(operation: () => Promise<T>): Promise<T> {
  const result = configMutationQueue.then(operation, operation)
  configMutationQueue = result.then(
    () => undefined,
    () => undefined,
  )
  return result
}

async function applyConfig(nextConfig: AppConfig): Promise<AppConfig> {
  await saveConfig(app.getPath('userData'), nextConfig)
  await taskManager.reconcileConfig(nextConfig)
  await agentManager.reconcileConfig(nextConfig)
  appConfig = nextConfig
  return appConfig
}

function assertTrustedIpc(event: IpcMainInvokeEvent): void {
  if (!mainWindow || event.sender !== mainWindow.webContents || event.senderFrame !== event.sender.mainFrame) {
    throw new Error('Rejected IPC call from an untrusted renderer frame.')
  }
}

function isSafeId(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 128
}

function isBoundedString(value: unknown, maxLength = 4096): value is string {
  return typeof value === 'string' && !value.includes('\0') && value.length <= maxLength
}

function normalizeBranchRequest(value: unknown): GitBranchCreateRequest | null {
  if (!value || typeof value !== 'object') return null
  const source = value as Record<string, unknown>
  if (!isBoundedString(source.checkoutId, 256) || !isBoundedString(source.name, 240)) return null
  if (source.startPoint !== undefined && !isBoundedString(source.startPoint, 240)) return null
  return {
    checkoutId: source.checkoutId,
    name: source.name,
    switchTo: source.switchTo === true,
    ...(typeof source.startPoint === 'string' ? { startPoint: source.startPoint } : {}),
  }
}

function normalizeWorktreeRequest(value: unknown): GitWorktreeCreateRequest | null {
  if (!value || typeof value !== 'object') return null
  const source = value as Record<string, unknown>
  if (!isSafeId(source.projectId) || !isBoundedString(source.path) || !isBoundedString(source.branch, 240)) return null
  if (source.startPoint !== undefined && !isBoundedString(source.startPoint, 240)) return null
  return {
    projectId: source.projectId,
    path: source.path,
    branch: source.branch,
    createBranch: source.createBranch === true,
    ...(typeof source.startPoint === 'string' ? { startPoint: source.startPoint } : {}),
  }
}

function normalizeCloneRequest(value: unknown): GitCloneRequest | null {
  if (!value || typeof value !== 'object') return null
  const source = value as Record<string, unknown>
  if (!isBoundedString(source.url) || !isBoundedString(source.directory)) return null
  if (source.name !== undefined && !isBoundedString(source.name, 120)) return null
  return {
    url: source.url,
    directory: source.directory,
    ...(typeof source.name === 'string' ? { name: source.name } : {}),
  }
}

async function openPathExternal(targetPath: string, target: unknown): Promise<boolean> {
  if (target === 'files') return (await shell.openPath(targetPath)) === ''
  if (target === 'editor' && appConfig.preferences.editorCommand) {
    return spawnDetached(appConfig.preferences.editorCommand, [targetPath])
  }
  if (target === 'terminal') {
    if (process.platform === 'win32') {
      return spawnDetached(process.env.ComSpec || 'cmd.exe', [
        '/d',
        '/c',
        'start',
        '',
        'cmd.exe',
        '/k',
        'cd',
        '/d',
        targetPath,
      ])
    }
    if (process.platform === 'darwin') {
      return spawnDetached('open', ['-a', 'Terminal', targetPath])
    }
    return openLinuxTerminal(targetPath)
  }
  return false
}

async function openLinuxTerminal(targetPath: string): Promise<boolean> {
  const candidates: Array<[string, string[]]> = [
    ['x-terminal-emulator', ['--working-directory', targetPath]],
    ['kgx', ['--working-directory', targetPath]],
    ['gnome-terminal', ['--working-directory', targetPath]],
    ['konsole', ['--workdir', targetPath]],
    ['xfce4-terminal', ['--working-directory', targetPath]],
    ['kitty', ['--directory', targetPath]],
    ['alacritty', ['--working-directory', targetPath]],
  ]
  for (const [command, args] of candidates) {
    if (await spawnDetached(command, args)) return true
  }
  return false
}

function spawnDetached(command: string, args: string[]): Promise<boolean> {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
    })
    child.once('error', () => resolve(false))
    child.once('spawn', () => {
      child.unref()
      resolve(true)
    })
  })
}

function windowState(win: BrowserWindow) {
  return { maximized: win.isMaximized(), fullscreen: win.isFullScreen() }
}

function sendWindowState(win: BrowserWindow): void {
  if (!win.isDestroyed()) win.webContents.send('window:state', windowState(win))
}

function normalizeProjectCreateRequest(value: unknown): ProjectCreateRequest | null {
  if (!value || typeof value !== 'object') {
    return null
  }

  const source = value as Record<string, unknown>
  if (source.framework !== 'laravel' && source.framework !== 'adonisjs') {
    return null
  }
  if (typeof source.name !== 'string' || typeof source.directory !== 'string') {
    return null
  }
  if (source.name.length > 100 || source.directory.length > 4096) {
    return null
  }

  const laravelSource =
    source.laravel && typeof source.laravel === 'object' ? (source.laravel as Record<string, unknown>) : {}
  const starterKits = ['none', 'react', 'vue', 'svelte', 'livewire'] as const
  const authModes = ['default', 'no-authentication', 'workos'] as const
  const starterKit = starterKits.find((item) => item === laravelSource.starterKit) ?? 'none'
  const authMode = authModes.find((item) => item === laravelSource.authMode) ?? 'default'

  return {
    framework: source.framework,
    name: source.name,
    directory: source.directory,
    ...(source.framework === 'laravel'
      ? {
          laravel: {
            starterKit,
            authMode,
            boost: laravelSource.boost === true,
          },
        }
      : {}),
  }
}

// The task resolver closes over this service; initialization completes before IPC can call it.
// eslint-disable-next-line prefer-const
let gitService: GitService

const taskManager = new TaskManager({
  getConfig: () => appConfig,
  resolveCheckout: (checkoutId) => gitService.resolveCheckout(checkoutId),
  onData: (event) => {
    mainWindow?.webContents.send('task:data', event)
  },
  onStatus: (event) => {
    mainWindow?.webContents.send('task:status', event)

    if (!event.running) {
      mainWindow?.webContents.send('task:stats', {
        stats: [
          {
            taskId: event.taskId,
            cpu: 0,
            memoryMb: 0,
          },
        ],
      })
    }
  },
  onExit: (event) => {
    mainWindow?.webContents.send('task:exit', event)
  },
})

const runtimeManagers: { agent?: AgentManager } = {}
gitService = new GitService({
  getConfig: () => appConfig,
  isCheckoutBusy: (checkoutId) => {
    const taskBusy = taskManager.isCheckoutBusy(checkoutId)
    return taskBusy || Boolean(runtimeManagers.agent?.isCheckoutBusy(checkoutId))
  },
})

const agentManager = new AgentManager({
  getConfig: () => appConfig,
  resolveCheckout: (checkoutId) => gitService.resolveCheckout(checkoutId),
  onData: (event) => mainWindow?.webContents.send('agent:data', event),
  onStatus: (event) => mainWindow?.webContents.send('agent:status', event),
  onExit: (event) => mainWindow?.webContents.send('agent:exit', event),
})
runtimeManagers.agent = agentManager

const workspaceService = new WorkspaceService({
  getConfig: () => appConfig,
  applyConfig,
  git: gitService,
  agents: agentManager,
  tasks: taskManager,
})

const aiService = new AiService(() => appConfig, gitService)

const provisioningJobManager = new ProvisioningJobManager({
  onData: (event) => {
    mainWindow?.webContents.send('project:create:data', event)
  },
  onStatus: (event) => {
    mainWindow?.webContents.send('project:create:status', event)
  },
  onDone: (event) => {
    void handleProjectCreateDone(event)
  },
})

async function handleProjectCreateDone(event: ProjectCreateDoneEvent): Promise<void> {
  if (event.state !== 'success') {
    mainWindow?.webContents.send('project:create:done', event)
    return
  }

  const createdProject = await provisioningJobManager.consumeCreatedProject(event.jobId)
  if (!createdProject) {
    mainWindow?.webContents.send('project:create:done', {
      jobId: event.jobId,
      state: 'failed',
      error: 'Project scaffold completed, but Exedeck could not register the project.',
    } satisfies ProjectCreateDoneEvent)
    return
  }

  try {
    await serializeConfigMutation(async () => {
      const nextConfig = normalizeConfig(
        {
          ...appConfig,
          onboardingCompleted: true,
          projects: [...appConfig.projects, createdProject],
        },
        repoRoot,
      )
      await applyConfig(nextConfig)
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    mainWindow?.webContents.send('project:create:done', {
      jobId: event.jobId,
      state: 'failed',
      error: `The project was created, but its Exedeck configuration could not be saved: ${message}`,
    } satisfies ProjectCreateDoneEvent)
    return
  }

  mainWindow?.webContents.send('project:create:done', {
    ...event,
    projectId: createdProject.id,
  } satisfies ProjectCreateDoneEvent)
}

function registerIpcHandlers(): void {
  ipcMain.handle('config:get', async (event) => {
    assertTrustedIpc(event)
    return appConfig
  })
  ipcMain.handle('config:set', async (event, candidate: unknown) => {
    assertTrustedIpc(event)
    return serializeConfigMutation(() => applyConfig(normalizeConfig(candidate, repoRoot)))
  })
  ipcMain.handle('dialog:pick-directory', async (event, initialPath?: unknown) => {
    assertTrustedIpc(event)
    const options: Electron.OpenDialogOptions = {
      title: 'Select Directory',
      properties: ['openDirectory', 'createDirectory'],
      defaultPath:
        typeof initialPath === 'string' && initialPath.trim() && initialPath.length <= 4096 ? initialPath : repoRoot,
    }
    const result = mainWindow ? await dialog.showOpenDialog(mainWindow, options) : await dialog.showOpenDialog(options)

    if (result.canceled || result.filePaths.length === 0) {
      return null
    }

    return result.filePaths[0]
  })
  ipcMain.handle('project:default-directory', async (event) => {
    assertTrustedIpc(event)
    return path.join(app.getPath('documents'), 'Exedeck')
  })

  ipcMain.handle('project:create', async (event, candidate: unknown) => {
    assertTrustedIpc(event)
    const request = normalizeProjectCreateRequest(candidate)
    if (!request) {
      return null
    }

    const jobId = await provisioningJobManager.startJob(request)
    return jobId
  })
  ipcMain.handle('project:create:input', async (event, jobId: unknown, data: unknown) => {
    assertTrustedIpc(event)
    return isSafeId(jobId) && typeof data === 'string' && data.length <= 65_536
      ? provisioningJobManager.input(jobId, data)
      : false
  })
  ipcMain.handle('project:create:cancel', async (event, jobId: unknown) => {
    assertTrustedIpc(event)
    return isSafeId(jobId) ? provisioningJobManager.cancel(jobId) : false
  })
  ipcMain.handle('project:create:get', async (event, jobId: unknown) => {
    assertTrustedIpc(event)
    if (!isSafeId(jobId)) return null
    const status = provisioningJobManager.getStatus(jobId)
    return status ? { status, buffer: provisioningJobManager.getBuffer(jobId) } : null
  })
  ipcMain.handle('project:open-external', async (event, projectId: unknown, target: unknown) => {
    assertTrustedIpc(event)
    if (!isSafeId(projectId)) return false
    const project = appConfig.projects.find((item) => item.id === projectId)
    return project ? openPathExternal(project.path, target) : false
  })

  ipcMain.handle('task:start', async (event, candidate: unknown) => {
    assertTrustedIpc(event)
    if (!candidate || typeof candidate !== 'object') {
      return { ok: false, running: false, alreadyRunning: false }
    }
    const request = candidate as Partial<TaskStartRequest>
    return isSafeId(request.taskId) && (request.checkoutId === undefined || isBoundedString(request.checkoutId, 256))
      ? taskManager.startTask({
          taskId: request.taskId,
          ...(request.checkoutId ? { checkoutId: request.checkoutId } : {}),
        })
      : { ok: false, running: false, alreadyRunning: false }
  })
  ipcMain.handle('task:stop', async (event, taskId: unknown) => {
    assertTrustedIpc(event)
    return isSafeId(taskId) ? taskManager.stopTask(taskId) : false
  })
  ipcMain.handle('task:restart', async (event, candidate: unknown) => {
    assertTrustedIpc(event)
    if (!candidate || typeof candidate !== 'object') {
      return { ok: false, running: false, alreadyRunning: false }
    }
    const request = candidate as Partial<TaskStartRequest>
    return isSafeId(request.taskId) && (request.checkoutId === undefined || isBoundedString(request.checkoutId, 256))
      ? taskManager.restartTask({
          taskId: request.taskId,
          ...(request.checkoutId ? { checkoutId: request.checkoutId } : {}),
        })
      : { ok: false, running: false, alreadyRunning: false }
  })
  ipcMain.handle('task:input', async (event, taskId: unknown, data: unknown) => {
    assertTrustedIpc(event)
    return isSafeId(taskId) && typeof data === 'string' && data.length <= 65_536
      ? taskManager.inputTask(taskId, data)
      : false
  })
  ipcMain.handle('task:resize', async (event, taskId: unknown, cols: unknown, rows: unknown) => {
    assertTrustedIpc(event)
    return isSafeId(taskId) && typeof cols === 'number' && typeof rows === 'number'
      ? taskManager.resizeTask(taskId, cols, rows)
      : false
  })
  ipcMain.handle('task:get-status', async (event, taskId: unknown) => {
    assertTrustedIpc(event)
    return isSafeId(taskId) ? taskManager.getTaskStatus(taskId) : { running: false }
  })
  ipcMain.handle('task:get-statuses', async (event) => {
    assertTrustedIpc(event)
    return taskManager.getTaskStatuses()
  })
  ipcMain.handle('task:get-buffer', async (event, taskId: unknown) => {
    assertTrustedIpc(event)
    return isSafeId(taskId) ? taskManager.getTaskBuffer(taskId) : ''
  })
  ipcMain.handle('task:clear-buffer', async (event, taskId: unknown) => {
    assertTrustedIpc(event)
    return isSafeId(taskId) ? taskManager.clearTaskBuffer(taskId) : false
  })

  ipcMain.handle('agent:discover-tools', async (event) => {
    assertTrustedIpc(event)
    return agentManager.discoverTools()
  })
  ipcMain.handle('agent:start', async (event, candidate: unknown) => {
    assertTrustedIpc(event)
    if (!candidate || typeof candidate !== 'object') return false
    const request = candidate as Partial<AgentStartRequest>
    return isSafeId(request.workspaceId) &&
      (request.prompt === undefined || (typeof request.prompt === 'string' && request.prompt.length <= 32_000))
      ? agentManager.start(request.workspaceId, request.prompt)
      : false
  })
  ipcMain.handle('agent:stop', async (event, workspaceId: unknown) => {
    assertTrustedIpc(event)
    return isSafeId(workspaceId) ? agentManager.stop(workspaceId) : false
  })
  ipcMain.handle('agent:restart', async (event, workspaceId: unknown) => {
    assertTrustedIpc(event)
    return isSafeId(workspaceId) ? agentManager.restart(workspaceId) : false
  })
  ipcMain.handle('agent:input', async (event, workspaceId: unknown, data: unknown) => {
    assertTrustedIpc(event)
    return isSafeId(workspaceId) && typeof data === 'string' && data.length <= 65_536
      ? agentManager.input(workspaceId, data)
      : false
  })
  ipcMain.handle('agent:resize', async (event, workspaceId: unknown, cols: unknown, rows: unknown) => {
    assertTrustedIpc(event)
    return isSafeId(workspaceId) && typeof cols === 'number' && typeof rows === 'number'
      ? agentManager.resize(workspaceId, cols, rows)
      : false
  })
  ipcMain.handle('agent:get-status', async (event, workspaceId: unknown) => {
    assertTrustedIpc(event)
    return isSafeId(workspaceId) ? agentManager.getStatus(workspaceId) : { state: 'stopped', unread: false }
  })
  ipcMain.handle('agent:get-statuses', async (event) => {
    assertTrustedIpc(event)
    return agentManager.getStatuses()
  })
  ipcMain.handle('agent:get-buffer', async (event, workspaceId: unknown) => {
    assertTrustedIpc(event)
    return isSafeId(workspaceId) ? agentManager.getBuffer(workspaceId) : ''
  })
  ipcMain.handle('agent:clear-buffer', async (event, workspaceId: unknown) => {
    assertTrustedIpc(event)
    return isSafeId(workspaceId) ? agentManager.clearBuffer(workspaceId) : false
  })
  ipcMain.handle('agent:mark-read', async (event, workspaceId: unknown) => {
    assertTrustedIpc(event)
    return isSafeId(workspaceId) ? agentManager.markRead(workspaceId) : false
  })

  ipcMain.handle('workspace:create', async (event, candidate: unknown) => {
    assertTrustedIpc(event)
    if (!candidate || typeof candidate !== 'object') {
      return { ok: false, error: 'Invalid request.' }
    }
    const source = candidate as Record<string, unknown>
    if (
      !isSafeId(source.projectId) ||
      !isBoundedString(source.name, 160) ||
      !isBoundedString(source.branch, 240) ||
      (source.parentBranch !== undefined && !isBoundedString(source.parentBranch, 240)) ||
      !isBoundedString(source.worktreePath, 4096)
    ) {
      return { ok: false, error: 'Invalid request.' }
    }
    const request: WorkspaceCreateRequest = {
      projectId: source.projectId,
      name: source.name,
      branch: source.branch,
      worktreePath: source.worktreePath,
      ...(typeof source.parentBranch === 'string' ? { parentBranch: source.parentBranch } : {}),
    }
    return serializeConfigMutation(() => workspaceService.create(request))
  })
  ipcMain.handle('workspace:rebind', async (event, candidate: unknown) => {
    assertTrustedIpc(event)
    if (!candidate || typeof candidate !== 'object') return null
    const request = candidate as WorkspaceRebindRequest
    return isSafeId(request.workspaceId) && isBoundedString(request.checkoutId, 256)
      ? serializeConfigMutation(() => workspaceService.rebind(request))
      : null
  })
  ipcMain.handle('workspace:finish-preview', async (event, workspaceId: unknown) => {
    assertTrustedIpc(event)
    return isSafeId(workspaceId) ? workspaceService.finishPreview(workspaceId) : null
  })
  ipcMain.handle('workspace:finish', async (event, candidate: unknown) => {
    assertTrustedIpc(event)
    if (!candidate || typeof candidate !== 'object') {
      return { ok: false, completed: [], pending: [], error: 'Invalid request.' }
    }
    const source = candidate as Record<string, unknown>
    if (!isSafeId(source.workspaceId)) {
      return { ok: false, completed: [], pending: [], error: 'Invalid request.' }
    }
    const workspaceId = source.workspaceId
    return serializeConfigMutation(() =>
      workspaceService.finish({
        workspaceId,
        merge: source.merge === true,
        removeWorktree: source.removeWorktree === true,
        deleteBranch: source.deleteBranch === true,
      }),
    )
  })

  ipcMain.handle('git:list-checkouts', async (event, projectId: unknown) => {
    assertTrustedIpc(event)
    return isSafeId(projectId) ? gitService.listCheckouts(projectId) : []
  })
  ipcMain.handle('git:status', async (event, checkoutId: unknown) => {
    assertTrustedIpc(event)
    return typeof checkoutId === 'string' ? gitService.status(checkoutId) : null
  })
  ipcMain.handle('git:history', async (event, checkoutId: unknown, limit: unknown) => {
    assertTrustedIpc(event)
    return typeof checkoutId === 'string' ? gitService.history(checkoutId, typeof limit === 'number' ? limit : 100) : []
  })
  ipcMain.handle('git:branches', async (event, checkoutId: unknown) => {
    assertTrustedIpc(event)
    return typeof checkoutId === 'string' ? gitService.branches(checkoutId) : []
  })
  const paths = (value: unknown): string[] =>
    Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string').slice(0, 500) : []
  ipcMain.handle('git:stage', async (event, id: unknown, value: unknown) => {
    assertTrustedIpc(event)
    return typeof id === 'string' ? gitService.stage(id, paths(value)) : null
  })
  ipcMain.handle('git:unstage', async (event, id: unknown, value: unknown) => {
    assertTrustedIpc(event)
    return typeof id === 'string' ? gitService.unstage(id, paths(value)) : null
  })
  ipcMain.handle('git:discard', async (event, id: unknown, value: unknown) => {
    assertTrustedIpc(event)
    return typeof id === 'string' ? gitService.discard(id, paths(value)) : null
  })
  ipcMain.handle('git:stash', async (event, id: unknown, message: unknown) => {
    assertTrustedIpc(event)
    return typeof id === 'string' ? gitService.stash(id, typeof message === 'string' ? message : undefined) : null
  })
  ipcMain.handle('git:stash-pop', async (event, id: unknown) => {
    assertTrustedIpc(event)
    return typeof id === 'string' ? gitService.stashPop(id) : null
  })
  ipcMain.handle('git:commit', async (event, id: unknown, summary: unknown, description: unknown) => {
    assertTrustedIpc(event)
    return typeof id === 'string' && typeof summary === 'string'
      ? gitService.commit(id, summary, typeof description === 'string' ? description : undefined)
      : null
  })
  ipcMain.handle('git:create-branch', async (event, value: unknown) => {
    assertTrustedIpc(event)
    const request = normalizeBranchRequest(value)
    return request ? gitService.createBranch(request) : null
  })
  ipcMain.handle('git:switch-branch', async (event, id: unknown, branch: unknown) => {
    assertTrustedIpc(event)
    return isBoundedString(id, 256) && isBoundedString(branch, 240) ? gitService.switchBranch(id, branch) : null
  })
  ipcMain.handle('git:delete-branch', async (event, id: unknown, branch: unknown) => {
    assertTrustedIpc(event)
    return isBoundedString(id, 256) && isBoundedString(branch, 240) ? gitService.deleteBranch(id, branch) : null
  })
  ipcMain.handle('git:rename-branch', async (event, id: unknown, oldName: unknown, newName: unknown) => {
    assertTrustedIpc(event)
    return isBoundedString(id, 256) && isBoundedString(oldName, 240) && isBoundedString(newName, 240)
      ? gitService.renameBranch(id, oldName, newName)
      : null
  })
  ipcMain.handle('git:merge-branch', async (event, id: unknown, branch: unknown) => {
    assertTrustedIpc(event)
    return isBoundedString(id, 256) && isBoundedString(branch, 240) ? gitService.mergeBranch(id, branch) : null
  })
  ipcMain.handle('git:fetch', async (event, id: unknown) => {
    assertTrustedIpc(event)
    return isBoundedString(id, 256) ? gitService.fetch(id) : null
  })
  ipcMain.handle('git:pull', async (event, id: unknown) => {
    assertTrustedIpc(event)
    return isBoundedString(id, 256) ? gitService.pull(id) : null
  })
  ipcMain.handle('git:push', async (event, id: unknown) => {
    assertTrustedIpc(event)
    return isBoundedString(id, 256) ? gitService.push(id) : null
  })
  ipcMain.handle('git:create-worktree', async (event, value: unknown) => {
    assertTrustedIpc(event)
    const request = normalizeWorktreeRequest(value)
    return request ? gitService.createWorktree(request) : null
  })
  ipcMain.handle('git:remove-worktree', async (event, id: unknown) => {
    assertTrustedIpc(event)
    return isBoundedString(id, 256) ? gitService.removeWorktree(id) : null
  })
  ipcMain.handle('git:clone', async (event, value: unknown) => {
    assertTrustedIpc(event)
    const request = normalizeCloneRequest(value)
    if (!request) return null
    const project = await gitService.clone(request)
    if (!project) return null
    await serializeConfigMutation(() =>
      applyConfig(
        normalizeConfig(
          {
            ...appConfig,
            onboardingCompleted: true,
            projects: [...appConfig.projects, project],
          },
          repoRoot,
        ),
      ),
    )
    return project
  })
  ipcMain.handle('git:open-external', async (event, id: unknown, target: unknown) => {
    assertTrustedIpc(event)
    if (!isBoundedString(id, 256)) return false
    const checkout = await gitService.resolveCheckout(id)
    if (!checkout || (target !== 'editor' && target !== 'terminal' && target !== 'files')) return false
    return openPathExternal(checkout.path, target)
  })
  ipcMain.handle('ai:generate-commit-message', async (event, id: unknown) => {
    assertTrustedIpc(event)
    if (!isBoundedString(id, 256)) throw new Error('Invalid checkout.')
    return aiService.generateCommitMessage(id)
  })

  ipcMain.handle('window:get-state', async (event) => {
    assertTrustedIpc(event)
    return mainWindow ? windowState(mainWindow) : { maximized: false, fullscreen: false }
  })
  ipcMain.handle('window:command', async (event, value: unknown) => {
    assertTrustedIpc(event)
    if (!mainWindow || typeof value !== 'string') return false
    const command = value as WindowCommand
    const webContents = mainWindow.webContents
    switch (command) {
      case 'minimize':
        mainWindow.minimize()
        break
      case 'maximize':
        if (mainWindow.isMaximized()) mainWindow.unmaximize()
        else mainWindow.maximize()
        break
      case 'close':
        mainWindow.close()
        break
      case 'quit':
        app.quit()
        break
      case 'toggleFullscreen':
        mainWindow.setFullScreen(!mainWindow.isFullScreen())
        break
      case 'reload':
        webContents.reload()
        break
      case 'zoomIn':
        webContents.setZoomLevel(Math.min(5, webContents.getZoomLevel() + 0.5))
        break
      case 'zoomOut':
        webContents.setZoomLevel(Math.max(-5, webContents.getZoomLevel() - 0.5))
        break
      case 'resetZoom':
        webContents.setZoomLevel(0)
        break
      case 'undo':
        webContents.undo()
        break
      case 'redo':
        webContents.redo()
        break
      case 'cut':
        webContents.cut()
        break
      case 'copy':
        webContents.copy()
        break
      case 'paste':
        webContents.paste()
        break
      case 'selectAll':
        webContents.selectAll()
        break
      default:
        return false
    }
    return true
  })
  ipcMain.handle('window:show-about', async (event) => {
    assertTrustedIpc(event)
    await dialog.showMessageBox(mainWindow!, {
      type: 'info',
      title: 'About Exedeck',
      message: 'Exedeck',
      detail: `Version ${app.getVersion()}\nA local development cockpit for tasks, agents, and Git.`,
      buttons: ['OK'],
    })
  })
}

function startConfiguredAutoTasks(): void {
  for (const project of appConfig.projects) {
    if (!project.autoStart) {
      continue
    }

    for (const task of project.tasks) {
      if (task.autoStart) {
        void taskManager.startTask({ taskId: task.id })
      }
    }
  }
}

async function pollTaskStats(): Promise<void> {
  const running = taskManager.listRunningTaskIds().flatMap((taskId) => {
    const pid = taskManager.getTaskPid(taskId)
    return pid ? [{ taskId, pid }] : []
  })

  if (running.length > 0) {
    let stats = running.map(({ taskId }) => ({ taskId, cpu: 0, memoryMb: 0 }))
    try {
      const byPid = await pidusage(running.map(({ pid }) => pid))
      stats = running.map(({ taskId, pid }) => ({
        taskId,
        cpu: byPid[pid]?.cpu ?? 0,
        memoryMb: (byPid[pid]?.memory ?? 0) / 1024 / 1024,
      }))
    } catch {
      // A process may exit during collection; publish zeroes for this cycle.
    }
    mainWindow?.webContents.send('task:stats', { stats })
  }

  if (!cleanupStarted) {
    statsTimer = setTimeout(() => void pollTaskStats(), 1000)
  }
}

function startStatsPolling(): void {
  if (statsTimer) clearTimeout(statsTimer)
  statsTimer = setTimeout(() => void pollTaskStats(), 1000)
}

function ensureSmokeTask(): string {
  const existing = appConfig.projects
    .flatMap((project) => project.tasks)
    .find((task) => task.name === 'Smoke demo task')
  if (existing) {
    return existing.id
  }

  const smokeTask: TaskConfig = {
    id: `task-smoke-${Date.now().toString(36)}`,
    name: 'Smoke demo task',
    command: 'node',
    args: ['-e', "console.log('smoke task output')"],
    cwd: repoRoot,
    autoStart: false,
  }

  if (appConfig.projects.length === 0) {
    appConfig = {
      ...appConfig,
      projects: [
        {
          id: `project-smoke-${Date.now().toString(36)}`,
          name: 'Smoke project',
          path: repoRoot,
          framework: 'custom',
          autoStart: false,
          tasks: [smokeTask],
        },
      ],
    }
    return smokeTask.id
  }

  const firstProject = appConfig.projects[0]
  appConfig = {
    ...appConfig,
    projects: [
      {
        ...firstProject,
        tasks: [...firstProject.tasks, smokeTask],
      },
      ...appConfig.projects.slice(1),
    ],
  }

  return smokeTask.id
}

async function runSmokeFlow(win: BrowserWindow): Promise<void> {
  const smokeTaskId = ensureSmokeTask()
  const started = await taskManager.startTask({ taskId: smokeTaskId })

  let bridgeReady = false
  try {
    bridgeReady = await win.webContents.executeJavaScript(
      'Boolean(window.exedeck && window.exedeck.processes && typeof window.exedeck.processes.onData === "function")',
      true,
    )
  } catch {
    bridgeReady = false
  }

  setTimeout(() => {
    const hasOutput = taskManager.getTaskBuffer(smokeTaskId).length > 0
    if (started.ok && bridgeReady && hasOutput) {
      console.log('SMOKE_OK')
      app.quit()
      return
    }

    console.error(`SMOKE_FAIL started=${started} bridgeReady=${bridgeReady} hasOutput=${hasOutput}`)
    app.exit(1)
  }, 1600)
}

function resolveWindowIcon(): string | undefined {
  const iconNameByPlatform: Partial<Record<NodeJS.Platform, string>> = {
    linux: 'icon.png',
    win32: 'icon.ico',
  }

  const iconName = iconNameByPlatform[process.platform]
  if (!iconName) {
    return undefined
  }

  const candidates = [path.join(process.resourcesPath, 'build', iconName), path.join(repoRoot, 'build', iconName)]

  return candidates.find((candidatePath) => fs.existsSync(candidatePath))
}

function createMainWindow(): BrowserWindow {
  const icon = resolveWindowIcon()
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 760,
    minHeight: 560,
    backgroundColor: '#111318',
    show: false,
    frame: false,
    ...(icon ? { icon } : {}),
    webPreferences: {
      preload: path.join(__dirname, '../preload/preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      spellcheck: false,
      devTools: Boolean(rendererDevServerUrl) || isAccessibilityTest,
    },
  })

  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  win.webContents.on('will-navigate', (event, targetUrl) => {
    if (targetUrl !== win.webContents.getURL()) {
      event.preventDefault()
    }
  })
  win.webContents.session.setPermissionCheckHandler(() => false)
  win.webContents.session.setPermissionRequestHandler((_webContents, _permission, callback) => {
    callback(false)
  })

  win.once('ready-to-show', () => {
    if (!win.isDestroyed()) {
      win.show()
    }
  })

  win.on('closed', () => {
    if (mainWindow === win) {
      mainWindow = null
    }
  })
  win.on('maximize', () => sendWindowState(win))
  win.on('unmaximize', () => sendWindowState(win))
  win.on('enter-full-screen', () => sendWindowState(win))
  win.on('leave-full-screen', () => sendWindowState(win))

  const loadPromise = rendererDevServerUrl
    ? win.loadURL(rendererDevServerUrl)
    : win.loadFile(path.join(__dirname, '../renderer/index.html'))

  void loadPromise.catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error)
    dialog.showErrorBox('Exedeck could not load', message)
  })

  if (isSmoke) {
    win.webContents.once('did-finish-load', () => {
      void runSmokeFlow(win)
    })
  }

  return win
}

const hasSingleInstanceLock = app.requestSingleInstanceLock()
if (!hasSingleInstanceLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (!mainWindow) {
      return
    }
    if (mainWindow.isMinimized()) {
      mainWindow.restore()
    }
    mainWindow.show()
    mainWindow.focus()
  })
}

if (hasSingleInstanceLock) {
  app
    .whenReady()
    .then(async () => {
      app.setAppUserModelId('com.exedeck.app')
      Menu.setApplicationMenu(null)
      appConfig = await loadOrCreateConfig(app.getPath('userData'), repoRoot)

      registerIpcHandlers()
      startStatsPolling()
      if (!isSmoke && !isAccessibilityTest) {
        startConfiguredAutoTasks()
      }

      mainWindow = createMainWindow()
      startUpdateChecks(() => mainWindow)

      app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) {
          mainWindow = createMainWindow()
        }
      })
    })
    .catch((error: unknown) => {
      const message = error instanceof Error ? (error.stack ?? error.message) : String(error)
      console.error(message)
      dialog.showErrorBox('Exedeck could not start', message)
      app.exit(1)
    })
}

app.on('before-quit', (event) => {
  if (cleanupComplete) {
    return
  }

  event.preventDefault()
  if (cleanupStarted) {
    return
  }
  cleanupStarted = true

  if (statsTimer) {
    clearTimeout(statsTimer)
    statsTimer = null
  }
  pidusage.clear()

  const forceQuitTimer = setTimeout(() => {
    taskManager.killAllImmediately()
    agentManager.killAllImmediately()
    provisioningJobManager.killAllImmediately()
    cleanupComplete = true
    app.exit(0)
  }, 4000)

  void Promise.all([taskManager.stopAll(), agentManager.stopAll(), provisioningJobManager.stopAll()]).finally(() => {
    clearTimeout(forceQuitTimer)
    cleanupComplete = true
    app.quit()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
