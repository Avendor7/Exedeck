import { app, BrowserWindow, dialog } from 'electron'
import updater from 'electron-updater'

const { autoUpdater } = updater

function canUpdateCurrentInstallation(): boolean {
  if (!app.isPackaged || process.env.EXEDECK_DISABLE_UPDATES === '1') return false
  // electron-updater supports AppImage updates on Linux. Package-manager
  // installations continue to update through their package manager.
  return process.platform !== 'linux' || Boolean(process.env.APPIMAGE)
}

export function startUpdateChecks(getWindow: () => BrowserWindow | null): void {
  if (!canUpdateCurrentInstallation()) return

  autoUpdater.autoDownload = false
  autoUpdater.autoInstallOnAppQuit = true

  autoUpdater.on('update-available', (info) => {
    const window = getWindow()
    if (!window || window.isDestroyed()) return
    void dialog
      .showMessageBox(window, {
        type: 'info',
        title: 'Exedeck update available',
        message: `Exedeck ${info.version} is available.`,
        detail: 'Download it now? You can continue working while the update downloads.',
        buttons: ['Download', 'Later'],
        defaultId: 0,
        cancelId: 1,
      })
      .then(({ response }) => {
        if (response === 0) void autoUpdater.downloadUpdate()
      })
  })

  autoUpdater.on('update-downloaded', (info) => {
    const window = getWindow()
    if (!window || window.isDestroyed()) return
    void dialog
      .showMessageBox(window, {
        type: 'info',
        title: 'Exedeck update ready',
        message: `Exedeck ${info.version} has been downloaded.`,
        detail: 'Restart Exedeck to finish installing the update.',
        buttons: ['Restart now', 'On next quit'],
        defaultId: 0,
        cancelId: 1,
      })
      .then(({ response }) => {
        if (response === 0) autoUpdater.quitAndInstall(false, true)
      })
  })

  autoUpdater.on('error', (error) => {
    console.warn(`[updates] ${error.message}`)
  })

  setTimeout(() => {
    void autoUpdater.checkForUpdates().catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error)
      console.warn(`[updates] ${message}`)
    })
  }, 10_000)
}
