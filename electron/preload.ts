import { contextBridge, ipcRenderer } from 'electron'
import type {
  AppConfig,
  ExedeckApi,
  TaskDataEvent,
  TaskExitEvent,
  TaskStatsEvent,
  TaskStatusEvent,
} from '../shared/types'

const api: ExedeckApi = {
  configGet: () => ipcRenderer.invoke('config:get') as Promise<AppConfig>,
  configSet: (config) => ipcRenderer.invoke('config:set', config) as Promise<boolean>,
  pickDirectory: (initialPath) => ipcRenderer.invoke('dialog:pick-directory', initialPath) as Promise<string | null>,
  taskStart: (taskId) => ipcRenderer.invoke('task:start', taskId) as Promise<boolean>,
  taskStop: (taskId) => ipcRenderer.invoke('task:stop', taskId) as Promise<boolean>,
  taskRestart: (taskId) => ipcRenderer.invoke('task:restart', taskId) as Promise<boolean>,
  taskInput: (taskId, data) => ipcRenderer.invoke('task:input', taskId, data) as Promise<boolean>,
  taskGetBuffer: (taskId) => ipcRenderer.invoke('task:get-buffer', taskId) as Promise<string>,
  taskClearBuffer: (taskId) => ipcRenderer.invoke('task:clear-buffer', taskId) as Promise<boolean>,
  onTaskData: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, payload: TaskDataEvent): void => {
      listener(payload)
    }
    ipcRenderer.on('task:data', handler)
    return () => ipcRenderer.removeListener('task:data', handler)
  },
  onTaskStatus: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, payload: TaskStatusEvent): void => {
      listener(payload)
    }
    ipcRenderer.on('task:status', handler)
    return () => ipcRenderer.removeListener('task:status', handler)
  },
  onTaskStats: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, payload: TaskStatsEvent): void => {
      listener(payload)
    }
    ipcRenderer.on('task:stats', handler)
    return () => ipcRenderer.removeListener('task:stats', handler)
  },
  onTaskExit: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, payload: TaskExitEvent): void => {
      listener(payload)
    }
    ipcRenderer.on('task:exit', handler)
    return () => ipcRenderer.removeListener('task:exit', handler)
  },
}

contextBridge.exposeInMainWorld('exedeck', api)
