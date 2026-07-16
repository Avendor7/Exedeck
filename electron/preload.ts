import { contextBridge, ipcRenderer } from 'electron'
import type {
  AgentDataEvent,
  AgentExitEvent,
  AgentRuntimeSnapshot,
  AgentStatusEvent,
  AgentToolStatus,
  AiCommitMessage,
  AppConfig,
  Checkout,
  ExedeckApi,
  GitBranch,
  GitBranchCreateRequest,
  GitCloneRequest,
  GitCommit,
  GitOperationResult,
  GitStatus,
  GitWorktreeCreateRequest,
  ProjectConfig,
  ProjectCreateDataEvent,
  ProjectCreateDoneEvent,
  ProjectCreateRequest,
  ProjectCreateSnapshot,
  ProjectCreateStatusEvent,
  TaskDataEvent,
  TaskExitEvent,
  TaskRuntimeSnapshot,
  TaskStartRequest,
  TaskStartResult,
  TaskStatsBatchEvent,
  TaskStatusEvent,
  WindowState,
  WorkspaceCreateRequest,
  WorkspaceCreateResult,
  WorkspaceFinishPreview,
  WorkspaceFinishRequest,
  WorkspaceFinishResult,
  WorkspaceRebindRequest,
  WorkspaceConfig,
} from '../shared/types'

function subscribe<T>(channel: string, listener: (event: T) => void): () => void {
  const handler = (_event: Electron.IpcRendererEvent, payload: T): void => listener(payload)
  ipcRenderer.on(channel, handler)
  return () => ipcRenderer.removeListener(channel, handler)
}

const api: ExedeckApi = {
  projects: {
    getConfig: () => ipcRenderer.invoke('config:get') as Promise<AppConfig>,
    setConfig: (config) => ipcRenderer.invoke('config:set', config) as Promise<AppConfig>,
    pickDirectory: (initialPath) => ipcRenderer.invoke('dialog:pick-directory', initialPath) as Promise<string | null>,
    defaultDirectory: () => ipcRenderer.invoke('project:default-directory') as Promise<string>,
    create: (request) =>
      ipcRenderer.invoke('project:create', request as ProjectCreateRequest) as Promise<string | null>,
    createInput: (jobId, data) => ipcRenderer.invoke('project:create:input', jobId, data) as Promise<boolean>,
    createCancel: (jobId) => ipcRenderer.invoke('project:create:cancel', jobId) as Promise<boolean>,
    createGet: (jobId) => ipcRenderer.invoke('project:create:get', jobId) as Promise<ProjectCreateSnapshot | null>,
    openExternal: (projectId, target) =>
      ipcRenderer.invoke('project:open-external', projectId, target) as Promise<boolean>,
    onCreateData: (listener) => subscribe<ProjectCreateDataEvent>('project:create:data', listener),
    onCreateStatus: (listener) => subscribe<ProjectCreateStatusEvent>('project:create:status', listener),
    onCreateDone: (listener) => subscribe<ProjectCreateDoneEvent>('project:create:done', listener),
  },
  processes: {
    start: (request) => ipcRenderer.invoke('task:start', request as TaskStartRequest) as Promise<TaskStartResult>,
    stop: (id) => ipcRenderer.invoke('task:stop', id) as Promise<boolean>,
    restart: (request) => ipcRenderer.invoke('task:restart', request as TaskStartRequest) as Promise<TaskStartResult>,
    input: (id, data) => ipcRenderer.invoke('task:input', id, data) as Promise<boolean>,
    resize: (id, cols, rows) => ipcRenderer.invoke('task:resize', id, cols, rows) as Promise<boolean>,
    getStatus: (id) => ipcRenderer.invoke('task:get-status', id) as Promise<TaskRuntimeSnapshot>,
    getStatuses: () => ipcRenderer.invoke('task:get-statuses') as Promise<Record<string, TaskRuntimeSnapshot>>,
    getBuffer: (id) => ipcRenderer.invoke('task:get-buffer', id) as Promise<string>,
    clearBuffer: (id) => ipcRenderer.invoke('task:clear-buffer', id) as Promise<boolean>,
    onData: (listener) => subscribe<TaskDataEvent>('task:data', listener),
    onStatus: (listener) => subscribe<TaskStatusEvent>('task:status', listener),
    onStats: (listener) => subscribe<TaskStatsBatchEvent>('task:stats', listener),
    onExit: (listener) => subscribe<TaskExitEvent>('task:exit', listener),
  },
  agents: {
    discoverTools: () => ipcRenderer.invoke('agent:discover-tools') as Promise<AgentToolStatus[]>,
    start: (request) => ipcRenderer.invoke('agent:start', request) as Promise<boolean>,
    stop: (id) => ipcRenderer.invoke('agent:stop', id) as Promise<boolean>,
    restart: (id) => ipcRenderer.invoke('agent:restart', id) as Promise<boolean>,
    input: (id, data) => ipcRenderer.invoke('agent:input', id, data) as Promise<boolean>,
    resize: (id, cols, rows) => ipcRenderer.invoke('agent:resize', id, cols, rows) as Promise<boolean>,
    getStatus: (id) => ipcRenderer.invoke('agent:get-status', id) as Promise<AgentRuntimeSnapshot>,
    getStatuses: () => ipcRenderer.invoke('agent:get-statuses') as Promise<Record<string, AgentRuntimeSnapshot>>,
    getBuffer: (id) => ipcRenderer.invoke('agent:get-buffer', id) as Promise<string>,
    clearBuffer: (id) => ipcRenderer.invoke('agent:clear-buffer', id) as Promise<boolean>,
    markRead: (id) => ipcRenderer.invoke('agent:mark-read', id) as Promise<boolean>,
    onData: (listener) => subscribe<AgentDataEvent>('agent:data', listener),
    onStatus: (listener) => subscribe<AgentStatusEvent>('agent:status', listener),
    onExit: (listener) => subscribe<AgentExitEvent>('agent:exit', listener),
  },
  workspaces: {
    create: (request) =>
      ipcRenderer.invoke('workspace:create', request as WorkspaceCreateRequest) as Promise<WorkspaceCreateResult>,
    rebind: (request) =>
      ipcRenderer.invoke('workspace:rebind', request as WorkspaceRebindRequest) as Promise<WorkspaceConfig | null>,
    finishPreview: (workspaceId) =>
      ipcRenderer.invoke('workspace:finish-preview', workspaceId) as Promise<WorkspaceFinishPreview | null>,
    finish: (request) =>
      ipcRenderer.invoke('workspace:finish', request as WorkspaceFinishRequest) as Promise<WorkspaceFinishResult>,
  },
  git: {
    listCheckouts: (id) => ipcRenderer.invoke('git:list-checkouts', id) as Promise<Checkout[]>,
    status: (id) => ipcRenderer.invoke('git:status', id) as Promise<GitStatus>,
    history: (id, limit) => ipcRenderer.invoke('git:history', id, limit) as Promise<GitCommit[]>,
    branches: (id) => ipcRenderer.invoke('git:branches', id) as Promise<GitBranch[]>,
    stage: (id, paths) => ipcRenderer.invoke('git:stage', id, paths) as Promise<GitOperationResult>,
    unstage: (id, paths) => ipcRenderer.invoke('git:unstage', id, paths) as Promise<GitOperationResult>,
    discard: (id, paths) => ipcRenderer.invoke('git:discard', id, paths) as Promise<GitOperationResult>,
    stash: (id, message) => ipcRenderer.invoke('git:stash', id, message) as Promise<GitOperationResult>,
    stashPop: (id) => ipcRenderer.invoke('git:stash-pop', id) as Promise<GitOperationResult>,
    commit: (id, summary, description) =>
      ipcRenderer.invoke('git:commit', id, summary, description) as Promise<GitOperationResult>,
    createBranch: (request) =>
      ipcRenderer.invoke('git:create-branch', request as GitBranchCreateRequest) as Promise<GitOperationResult>,
    switchBranch: (id, branch) => ipcRenderer.invoke('git:switch-branch', id, branch) as Promise<GitOperationResult>,
    deleteBranch: (id, branch) => ipcRenderer.invoke('git:delete-branch', id, branch) as Promise<GitOperationResult>,
    renameBranch: (id, oldName, newName) =>
      ipcRenderer.invoke('git:rename-branch', id, oldName, newName) as Promise<GitOperationResult>,
    mergeBranch: (id, branch) => ipcRenderer.invoke('git:merge-branch', id, branch) as Promise<GitOperationResult>,
    fetch: (id) => ipcRenderer.invoke('git:fetch', id) as Promise<GitOperationResult>,
    pull: (id) => ipcRenderer.invoke('git:pull', id) as Promise<GitOperationResult>,
    push: (id) => ipcRenderer.invoke('git:push', id) as Promise<GitOperationResult>,
    createWorktree: (request) =>
      ipcRenderer.invoke('git:create-worktree', request as GitWorktreeCreateRequest) as Promise<GitOperationResult>,
    removeWorktree: (id) => ipcRenderer.invoke('git:remove-worktree', id) as Promise<GitOperationResult>,
    clone: (request) => ipcRenderer.invoke('git:clone', request as GitCloneRequest) as Promise<ProjectConfig | null>,
    openExternal: (id, target) => ipcRenderer.invoke('git:open-external', id, target) as Promise<boolean>,
  },
  ai: {
    generateCommitMessage: (id) => ipcRenderer.invoke('ai:generate-commit-message', id) as Promise<AiCommitMessage>,
  },
  window: {
    command: (command) => ipcRenderer.invoke('window:command', command) as Promise<boolean>,
    getState: () => ipcRenderer.invoke('window:get-state') as Promise<WindowState>,
    showAbout: () => ipcRenderer.invoke('window:show-about') as Promise<void>,
    onState: (listener) => subscribe<WindowState>('window:state', listener),
  },
}

contextBridge.exposeInMainWorld('exedeck', api)
