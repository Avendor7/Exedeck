export interface TaskConfig {
  id: string
  name: string
  command: string
  args: string[]
  cwd: string
  autoStart: boolean
}

export type ProjectFramework = 'laravel' | 'adonisjs' | 'custom'

export interface ProjectConfig {
  id: string
  name: string
  path: string
  framework: ProjectFramework
  autoStart: boolean
  tasks: TaskConfig[]
  branchParents?: Record<string, string>
}

export type AgentTool = 'codex' | 'claude' | 'custom'

export interface AgentProfile {
  id: string
  name: string
  tool: AgentTool
  command: string
  args: string[]
  enabled: boolean
}

export interface AgentSession {
  id: string
  projectId: string
  checkoutId: string
  profileId: string
  title: string
  createdAt: number
  resumeId?: string
}

export type AppearancePreference = 'system' | 'light' | 'dark'

export interface AppPreferences {
  appearance: AppearancePreference
  editorCommand: string
  cloneDirectory: string
  aiProfileId: string
}

export interface AppConfig {
  schemaVersion: number
  onboardingCompleted: boolean
  projects: ProjectConfig[]
  preferences: AppPreferences
  agentProfiles: AgentProfile[]
  agentSessions: AgentSession[]
}

export interface TaskDataEvent {
  taskId: string
  chunk: string
}

export interface TaskStatusEvent {
  taskId: string
  running: boolean
}

export interface TaskRuntimeSnapshot {
  running: boolean
  pid?: number
}

export interface TaskStatsEvent {
  taskId: string
  cpu: number
  memoryMb: number
}

export interface TaskExitEvent {
  taskId: string
  exitCode: number | null
  signal?: number
}

export type AgentRuntimeState = 'starting' | 'running' | 'stopped' | 'crashed'

export interface AgentDataEvent {
  sessionId: string
  chunk: string
}

export interface AgentStatusEvent {
  sessionId: string
  state: AgentRuntimeState
  unread: boolean
}

export interface AgentExitEvent {
  sessionId: string
  exitCode: number | null
  signal?: number
}

export interface AgentRuntimeSnapshot {
  state: AgentRuntimeState
  unread: boolean
  pid?: number
}

export interface AgentToolStatus {
  profileId: string
  command: string
  installed: boolean
  resolvedPath?: string
}

export interface AgentStartRequest {
  sessionId: string
  prompt?: string
}

export interface Checkout {
  id: string
  projectId: string
  path: string
  branch: string
  head: string
  isMain: boolean
  locked: boolean
  busy: boolean
}

export interface GitFileChange {
  path: string
  originalPath?: string
  indexStatus: string
  worktreeStatus: string
  staged: boolean
  unstaged: boolean
  conflicted: boolean
  stagedPatch: string
  workingPatch: string
}

export interface GitStatus {
  isRepository: boolean
  branch: string
  upstream?: string
  ahead: number
  behind: number
  clean: boolean
  detached: boolean
  files: GitFileChange[]
}

export interface GitCommit {
  hash: string
  shortHash: string
  parents: string[]
  author: string
  authorEmail: string
  date: string
  subject: string
  body: string
  refs: string[]
}

export interface GitBranch {
  name: string
  current: boolean
  remote: boolean
  upstream?: string
  ahead: number
  behind: number
  lastCommit: string
}

export interface GitOperationResult {
  ok: boolean
  output: string
  conflict: boolean
}

export interface GitBranchCreateRequest {
  checkoutId: string
  name: string
  startPoint?: string
  switchTo: boolean
}

export interface GitWorktreeCreateRequest {
  projectId: string
  path: string
  branch: string
  createBranch: boolean
  startPoint?: string
}

export interface GitCloneRequest {
  url: string
  directory: string
  name?: string
}

export interface AiCommitMessage {
  summary: string
  description: string
}

export interface ProjectCreateRequest {
  framework: Extract<ProjectFramework, 'laravel' | 'adonisjs'>
  name: string
  directory: string
  laravel?: {
    starterKit: 'none' | 'react' | 'vue' | 'svelte' | 'livewire'
    authMode: 'default' | 'no-authentication' | 'workos'
    boost: boolean
  }
}

export type ProjectCreateState = 'queued' | 'running' | 'success' | 'failed' | 'canceled'

export interface ProjectCreateStatus {
  jobId: string
  framework: ProjectCreateRequest['framework']
  name: string
  directory: string
  targetPath: string
  state: ProjectCreateState
  startedAt: number
  endedAt?: number
  fallbackUsed: boolean
  error?: string
}

export interface ProjectCreateDataEvent {
  jobId: string
  chunk: string
}

export interface ProjectCreateStatusEvent {
  jobId: string
  status: ProjectCreateStatus
}

export interface ProjectCreateDoneEvent {
  jobId: string
  state: Extract<ProjectCreateState, 'success' | 'failed' | 'canceled'>
  projectId?: string
  error?: string
}

export interface ProjectsApi {
  getConfig: () => Promise<AppConfig>
  setConfig: (config: AppConfig) => Promise<AppConfig>
  pickDirectory: (initialPath?: string) => Promise<string | null>
  defaultDirectory: () => Promise<string>
  create: (request: ProjectCreateRequest) => Promise<string | null>
  createInput: (jobId: string, data: string) => Promise<boolean>
  createCancel: (jobId: string) => Promise<boolean>
  createGet: (jobId: string) => Promise<ProjectCreateStatus | null>
  openExternal: (projectId: string, target: ExternalOpenTarget) => Promise<boolean>
  onCreateData: (listener: (event: ProjectCreateDataEvent) => void) => () => void
  onCreateStatus: (listener: (event: ProjectCreateStatusEvent) => void) => () => void
  onCreateDone: (listener: (event: ProjectCreateDoneEvent) => void) => () => void
}

export type ExternalOpenTarget = 'editor' | 'terminal' | 'files'

export type WindowCommand =
  | 'minimize'
  | 'maximize'
  | 'close'
  | 'quit'
  | 'toggleFullscreen'
  | 'reload'
  | 'zoomIn'
  | 'zoomOut'
  | 'resetZoom'
  | 'undo'
  | 'redo'
  | 'cut'
  | 'copy'
  | 'paste'
  | 'selectAll'

export interface WindowState {
  maximized: boolean
  fullscreen: boolean
}

export interface WindowApi {
  command: (command: WindowCommand) => Promise<boolean>
  getState: () => Promise<WindowState>
  showAbout: () => Promise<void>
  onState: (listener: (state: WindowState) => void) => () => void
}

export interface ProcessesApi {
  start: (taskId: string) => Promise<boolean>
  stop: (taskId: string) => Promise<boolean>
  restart: (taskId: string) => Promise<boolean>
  input: (taskId: string, data: string) => Promise<boolean>
  resize: (taskId: string, cols: number, rows: number) => Promise<boolean>
  getStatus: (taskId: string) => Promise<TaskRuntimeSnapshot>
  getBuffer: (taskId: string) => Promise<string>
  clearBuffer: (taskId: string) => Promise<boolean>
  onData: (listener: (event: TaskDataEvent) => void) => () => void
  onStatus: (listener: (event: TaskStatusEvent) => void) => () => void
  onStats: (listener: (event: TaskStatsEvent) => void) => () => void
  onExit: (listener: (event: TaskExitEvent) => void) => () => void
}

export interface AgentsApi {
  discoverTools: () => Promise<AgentToolStatus[]>
  start: (request: AgentStartRequest) => Promise<boolean>
  stop: (sessionId: string) => Promise<boolean>
  restart: (sessionId: string) => Promise<boolean>
  input: (sessionId: string, data: string) => Promise<boolean>
  resize: (sessionId: string, cols: number, rows: number) => Promise<boolean>
  getStatus: (sessionId: string) => Promise<AgentRuntimeSnapshot>
  getBuffer: (sessionId: string) => Promise<string>
  clearBuffer: (sessionId: string) => Promise<boolean>
  markRead: (sessionId: string) => Promise<boolean>
  onData: (listener: (event: AgentDataEvent) => void) => () => void
  onStatus: (listener: (event: AgentStatusEvent) => void) => () => void
  onExit: (listener: (event: AgentExitEvent) => void) => () => void
}

export interface GitApi {
  listCheckouts: (projectId: string) => Promise<Checkout[]>
  status: (checkoutId: string) => Promise<GitStatus>
  history: (checkoutId: string, limit?: number) => Promise<GitCommit[]>
  branches: (checkoutId: string) => Promise<GitBranch[]>
  stage: (checkoutId: string, paths: string[]) => Promise<GitOperationResult>
  unstage: (checkoutId: string, paths: string[]) => Promise<GitOperationResult>
  discard: (checkoutId: string, paths: string[]) => Promise<GitOperationResult>
  stash: (checkoutId: string, message?: string) => Promise<GitOperationResult>
  stashPop: (checkoutId: string) => Promise<GitOperationResult>
  commit: (checkoutId: string, summary: string, description?: string) => Promise<GitOperationResult>
  createBranch: (request: GitBranchCreateRequest) => Promise<GitOperationResult>
  switchBranch: (checkoutId: string, branch: string) => Promise<GitOperationResult>
  deleteBranch: (checkoutId: string, branch: string) => Promise<GitOperationResult>
  renameBranch: (checkoutId: string, oldName: string, newName: string) => Promise<GitOperationResult>
  mergeBranch: (checkoutId: string, branch: string) => Promise<GitOperationResult>
  fetch: (checkoutId: string) => Promise<GitOperationResult>
  pull: (checkoutId: string) => Promise<GitOperationResult>
  push: (checkoutId: string) => Promise<GitOperationResult>
  createWorktree: (request: GitWorktreeCreateRequest) => Promise<GitOperationResult>
  removeWorktree: (checkoutId: string) => Promise<GitOperationResult>
  clone: (request: GitCloneRequest) => Promise<ProjectConfig | null>
  openExternal: (checkoutId: string, target: 'editor' | 'terminal' | 'files') => Promise<boolean>
}

export interface AiApi {
  generateCommitMessage: (checkoutId: string) => Promise<AiCommitMessage>
}

export interface ExedeckApi {
  projects: ProjectsApi
  processes: ProcessesApi
  agents: AgentsApi
  git: GitApi
  ai: AiApi
  window: WindowApi
}
