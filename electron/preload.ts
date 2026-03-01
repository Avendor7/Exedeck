import { contextBridge, ipcRenderer } from 'electron'
import type {
  AppConfig,
  ExedeckApi,
  ProjectCreateDataEvent,
  ProjectCreateDoneEvent,
  ProjectCreateRequest,
  ProjectCreateStatus,
  ProjectCreateStatusEvent,
  TaskDataEvent,
  TaskExitEvent,
  TaskStatsEvent,
  TaskStatusEvent,
} from '../shared/types'

const api: ExedeckApi = {
  configGet: () => ipcRenderer.invoke('config:get') as Promise<AppConfig>,
  configSet: (config) => ipcRenderer.invoke('config:set', config) as Promise<boolean>,
  pickDirectory: (initialPath) => ipcRenderer.invoke('dialog:pick-directory', initialPath) as Promise<string | null>,
  projectCreate: (request) => ipcRenderer.invoke('project:create', request as ProjectCreateRequest) as Promise<string | null>,
  projectCreateInput: (jobId, data) => ipcRenderer.invoke('project:create:input', jobId, data) as Promise<boolean>,
  projectCreateCancel: (jobId) => ipcRenderer.invoke('project:create:cancel', jobId) as Promise<boolean>,
  projectCreateGet: (jobId) => ipcRenderer.invoke('project:create:get', jobId) as Promise<ProjectCreateStatus | null>,
  taskStart: (taskId) => ipcRenderer.invoke('task:start', taskId) as Promise<boolean>,
  taskStop: (taskId) => ipcRenderer.invoke('task:stop', taskId) as Promise<boolean>,
  taskRestart: (taskId) => ipcRenderer.invoke('task:restart', taskId) as Promise<boolean>,
  taskInput: (taskId, data) => ipcRenderer.invoke('task:input', taskId, data) as Promise<boolean>,
  taskResize: (taskId, cols, rows) => ipcRenderer.invoke('task:resize', taskId, cols, rows) as Promise<boolean>,
  taskGetBuffer: (taskId) => ipcRenderer.invoke('task:get-buffer', taskId) as Promise<string>,
  taskClearBuffer: (taskId) => ipcRenderer.invoke('task:clear-buffer', taskId) as Promise<boolean>,
  onProjectCreateData: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, payload: ProjectCreateDataEvent): void => {
      listener(payload)
    }
    ipcRenderer.on('project:create:data', handler)
    return () => ipcRenderer.removeListener('project:create:data', handler)
  },
  onProjectCreateStatus: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, payload: ProjectCreateStatusEvent): void => {
      listener(payload)
    }
    ipcRenderer.on('project:create:status', handler)
    return () => ipcRenderer.removeListener('project:create:status', handler)
  },
  onProjectCreateDone: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, payload: ProjectCreateDoneEvent): void => {
      listener(payload)
    }
    ipcRenderer.on('project:create:done', handler)
    return () => ipcRenderer.removeListener('project:create:done', handler)
  },
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
