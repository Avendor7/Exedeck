import { app, BrowserWindow, dialog, ipcMain } from 'electron'
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
import { TaskManager } from './taskManager'
import type { AppConfig, TaskConfig } from '../shared/types'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const isDev = !app.isPackaged
const isSmoke = process.env.SMOKE === '1'
const repoRoot = resolveRepoRoot(process.cwd())

let mainWindow: BrowserWindow | null = null
let appConfig: AppConfig = createDefaultConfig(repoRoot)
let statsTimer: NodeJS.Timeout | null = null

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

function registerIpcHandlers(): void {
  ipcMain.handle('config:get', async () => appConfig)
  ipcMain.handle('config:set', async (_event, nextConfig: AppConfig) => {
    appConfig = normalizeConfig(nextConfig, repoRoot)
    await saveConfig(app.getPath('userData'), appConfig)
    return true
  })
  ipcMain.handle('dialog:pick-directory', async (_event, initialPath?: string) => {
    const options: Electron.OpenDialogOptions = {
      title: 'Select Directory',
      properties: ['openDirectory', 'createDirectory'],
      defaultPath: initialPath && initialPath.trim() ? initialPath : repoRoot,
    }
    const result = mainWindow
      ? await dialog.showOpenDialog(mainWindow, options)
      : await dialog.showOpenDialog(options)

    if (result.canceled || result.filePaths.length === 0) {
      return null
    }

    return result.filePaths[0]
  })

  ipcMain.handle('task:start', async (_event, taskId: string) => taskManager.startTask(taskId))
  ipcMain.handle('task:stop', async (_event, taskId: string) => taskManager.stopTask(taskId))
  ipcMain.handle('task:restart', async (_event, taskId: string) => taskManager.restartTask(taskId))
  ipcMain.handle('task:input', async (_event, taskId: string, data: string) => taskManager.inputTask(taskId, data))
  ipcMain.handle('task:get-buffer', async (_event, taskId: string) => taskManager.getTaskBuffer(taskId))
  ipcMain.handle('task:clear-buffer', async (_event, taskId: string) => taskManager.clearTaskBuffer(taskId))
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
    minWidth: 1000,
    minHeight: 640,
    backgroundColor: '#0f1115',
    show: false,
    ...(icon ? { icon } : {}),
    webPreferences: {
      preload: path.join(__dirname, '../preload/preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  win.once('ready-to-show', () => {
    win.show()
  })

  if (isDev && process.env.VITE_DEV_SERVER_URL) {
    win.loadURL(process.env.VITE_DEV_SERVER_URL)
  } else {
    win.loadFile(path.join(__dirname, '../renderer/index.html'))
  }

  if (isSmoke) {
    win.webContents.once('did-finish-load', () => {
      void runSmokeFlow(win)
    })
  }

  return win
}

app.whenReady().then(async () => {
  appConfig = await loadOrCreateConfig(app.getPath('userData'), repoRoot)

  registerIpcHandlers()
  startStatsPolling()

  if (!isSmoke) {
    startConfiguredAutoTasks()
  }

  mainWindow = createMainWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      mainWindow = createMainWindow()
    }
  })
})

app.on('before-quit', () => {
  if (statsTimer) {
    clearInterval(statsTimer)
    statsTimer = null
  }
  pidusage.clear()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
