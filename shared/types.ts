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
}

export interface AppConfig {
  schemaVersion: number
  onboardingCompleted: boolean
  projects: ProjectConfig[]
}

export interface TaskDataEvent {
  taskId: string
  chunk: string
}

export interface TaskStatusEvent {
  taskId: string
  running: boolean
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

export interface ExedeckApi {
  configGet: () => Promise<AppConfig>
  configSet: (config: AppConfig) => Promise<boolean>
  pickDirectory: (initialPath?: string) => Promise<string | null>
  projectCreate: (request: ProjectCreateRequest) => Promise<string | null>
  projectCreateInput: (jobId: string, data: string) => Promise<boolean>
  projectCreateCancel: (jobId: string) => Promise<boolean>
  projectCreateGet: (jobId: string) => Promise<ProjectCreateStatus | null>
  taskStart: (taskId: string) => Promise<boolean>
  taskStop: (taskId: string) => Promise<boolean>
  taskRestart: (taskId: string) => Promise<boolean>
  taskInput: (taskId: string, data: string) => Promise<boolean>
  taskResize: (taskId: string, cols: number, rows: number) => Promise<boolean>
  taskGetBuffer: (taskId: string) => Promise<string>
  taskClearBuffer: (taskId: string) => Promise<boolean>
  onProjectCreateData: (listener: (event: ProjectCreateDataEvent) => void) => () => void
  onProjectCreateStatus: (listener: (event: ProjectCreateStatusEvent) => void) => () => void
  onProjectCreateDone: (listener: (event: ProjectCreateDoneEvent) => void) => () => void
  onTaskData: (listener: (event: TaskDataEvent) => void) => () => void
  onTaskStatus: (listener: (event: TaskStatusEvent) => void) => () => void
  onTaskStats: (listener: (event: TaskStatsEvent) => void) => () => void
  onTaskExit: (listener: (event: TaskExitEvent) => void) => () => void
}
