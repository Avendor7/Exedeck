import { app, BrowserWindow, dialog, ipcMain, Menu } from 'electron'
import type { IpcMainInvokeEvent, MenuItemConstructorOptions } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import pidusage from 'pidusage'
import {
  createDefaultConfig,
  loadOrCreateConfig,
  normalizeConfig,
  resolveRepoRoot,
  saveConfig,
} from './config'
import { ProvisioningJobManager } from './provisioningJobManager'
import { TaskManager } from './taskManager'
import type { AppConfig, ProjectCreateDoneEvent, ProjectCreateRequest, TaskConfig } from '../shared/types'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const isDev = !app.isPackaged
const isSmoke = process.env.SMOKE === '1'
const isAccessibilityTest = isDev && process.env.ACCESSIBILITY_TEST === '1'
if (isDev && process.env.EXEDECK_USER_DATA_DIR) {
  app.setPath('userData', path.resolve(process.env.EXEDECK_USER_DATA_DIR))
}
const repoRoot = resolveRepoRoot(process.cwd())

let mainWindow: BrowserWindow | null = null
let appConfig: AppConfig = createDefaultConfig(repoRoot)
let statsTimer: NodeJS.Timeout | null = null
let cleanupComplete = false
let cleanupStarted = false

function assertTrustedIpc(event: IpcMainInvokeEvent): void {
  if (!mainWindow || event.sender !== mainWindow.webContents || event.senderFrame !== event.sender.mainFrame) {
    throw new Error('Rejected IPC call from an untrusted renderer frame.')
  }
}

function isSafeId(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 128
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

  const laravelSource = source.laravel && typeof source.laravel === 'object'
    ? (source.laravel as Record<string, unknown>)
    : {}
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

const taskManager = new TaskManager({
  getConfig: () => appConfig,
  onData: (event) => {
    mainWindow?.webContents.send('task:data', event)
  },
  onStatus: (event) => {
    mainWindow?.webContents.send('task:status', event)

    if (!event.running) {
      mainWindow?.webContents.send('task:stats', {
        taskId: event.taskId,
        cpu: 0,
        memoryMb: 0,
      })
    }
  },
  onExit: (event) => {
    mainWindow?.webContents.send('task:exit', event)
  },
})

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

  const previousConfig = appConfig
  const nextConfig = normalizeConfig(
    {
      ...appConfig,
      onboardingCompleted: true,
      projects: [...appConfig.projects, createdProject],
    },
    repoRoot,
  )

  try {
    await saveConfig(app.getPath('userData'), nextConfig)
    appConfig = nextConfig
  } catch (error) {
    appConfig = previousConfig
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
    const nextConfig = normalizeConfig(candidate, repoRoot)
    await taskManager.reconcileConfig(nextConfig)
    appConfig = nextConfig
    await saveConfig(app.getPath('userData'), appConfig)
    return appConfig
  })
  ipcMain.handle('dialog:pick-directory', async (event, initialPath?: unknown) => {
    assertTrustedIpc(event)
    const options: Electron.OpenDialogOptions = {
      title: 'Select Directory',
      properties: ['openDirectory', 'createDirectory'],
      defaultPath:
        typeof initialPath === 'string' && initialPath.trim() && initialPath.length <= 4096
          ? initialPath
          : repoRoot,
    }
    const result = mainWindow
      ? await dialog.showOpenDialog(mainWindow, options)
      : await dialog.showOpenDialog(options)

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
    return isSafeId(jobId) ? provisioningJobManager.getStatus(jobId) : null
  })

  ipcMain.handle('task:start', async (event, taskId: unknown) => {
    assertTrustedIpc(event)
    return isSafeId(taskId) ? taskManager.startTask(taskId) : false
  })
  ipcMain.handle('task:stop', async (event, taskId: unknown) => {
    assertTrustedIpc(event)
    return isSafeId(taskId) ? taskManager.stopTask(taskId) : false
  })
  ipcMain.handle('task:restart', async (event, taskId: unknown) => {
    assertTrustedIpc(event)
    return isSafeId(taskId) ? taskManager.restartTask(taskId) : false
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
  ipcMain.handle('task:get-buffer', async (event, taskId: unknown) => {
    assertTrustedIpc(event)
    return isSafeId(taskId) ? taskManager.getTaskBuffer(taskId) : ''
  })
  ipcMain.handle('task:clear-buffer', async (event, taskId: unknown) => {
    assertTrustedIpc(event)
    return isSafeId(taskId) ? taskManager.clearTaskBuffer(taskId) : false
  })
}

function startConfiguredAutoTasks(): void {
  for (const project of appConfig.projects) {
    if (!project.autoStart) {
      continue
    }

    for (const task of project.tasks) {
      if (task.autoStart) {
        taskManager.startTask(task.id)
      }
    }
  }
}

function startStatsPolling(): void {
  if (statsTimer) {
    clearInterval(statsTimer)
  }

  statsTimer = setInterval(() => {
    const runningTaskIds = taskManager.listRunningTaskIds()

    for (const taskId of runningTaskIds) {
      const pid = taskManager.getTaskPid(taskId)
      if (!pid) {
        continue
      }

      void pidusage(pid)
        .then((stats) => {
          mainWindow?.webContents.send('task:stats', {
            taskId,
            cpu: stats.cpu,
            memoryMb: stats.memory / 1024 / 1024,
          })
        })
        .catch(() => {
          mainWindow?.webContents.send('task:stats', {
            taskId,
            cpu: 0,
            memoryMb: 0,
          })
        })
    }
  }, 1000)
}

function ensureSmokeTask(): string {
  const existing = appConfig.projects.flatMap((project) => project.tasks).find((task) => task.name === 'Smoke demo task')
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
  const started = taskManager.startTask(smokeTaskId)

  let bridgeReady = false
  try {
    bridgeReady = await win.webContents.executeJavaScript(
      'Boolean(window.exedeck && typeof window.exedeck.onTaskData === "function")',
      true,
    )
  } catch {
    bridgeReady = false
  }

  setTimeout(() => {
    const hasOutput = taskManager.getTaskBuffer(smokeTaskId).length > 0
    if (started && bridgeReady && hasOutput) {
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

  const candidates = [
    path.join(process.resourcesPath, 'build', iconName),
    path.join(repoRoot, 'build', iconName),
  ]

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
    ...(icon ? { icon } : {}),
    webPreferences: {
      preload: path.join(__dirname, '../preload/preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      spellcheck: false,
      devTools: isDev,
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

  const loadPromise = isDev && process.env.VITE_DEV_SERVER_URL
    ? win.loadURL(process.env.VITE_DEV_SERVER_URL)
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

function installApplicationMenu(): void {
  const template: MenuItemConstructorOptions[] = [
    ...(process.platform === 'darwin'
      ? [{ label: app.name, submenu: [{ role: 'about' as const }, { type: 'separator' as const }, { role: 'quit' as const }] }]
      : []),
    {
      label: 'File',
      submenu: [{ role: process.platform === 'darwin' ? 'close' : 'quit' }],
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' },
      ],
    },
    {
      label: 'View',
      submenu: [
        ...(isDev ? [{ role: 'reload' as const }, { role: 'toggleDevTools' as const }, { type: 'separator' as const }] : []),
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    {
      label: 'Window',
      submenu: [{ role: 'minimize' }, ...(process.platform === 'darwin' ? [{ role: 'front' as const }] : [])],
    },
  ]

  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
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
  app.whenReady().then(async () => {
    app.setAppUserModelId('com.exedeck.app')
    appConfig = await loadOrCreateConfig(app.getPath('userData'), repoRoot)

    registerIpcHandlers()
    startStatsPolling()
    installApplicationMenu()

    if (!isSmoke && !isAccessibilityTest) {
      startConfiguredAutoTasks()
    }

    mainWindow = createMainWindow()

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        mainWindow = createMainWindow()
      }
    })
  }).catch((error: unknown) => {
    const message = error instanceof Error ? error.stack ?? error.message : String(error)
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
    clearInterval(statsTimer)
    statsTimer = null
  }
  pidusage.clear()

  const forceQuitTimer = setTimeout(() => {
    taskManager.killAllImmediately()
    provisioningJobManager.killAllImmediately()
    cleanupComplete = true
    app.exit(0)
  }, 4000)

  void Promise.all([taskManager.stopAll(), provisioningJobManager.stopAll()]).finally(() => {
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
