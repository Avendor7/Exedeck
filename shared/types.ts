export interface TaskConfig {
  id: string
  name: string
  command: string
  args: string[]
  cwd: string
  autoStart: boolean
}

export interface ProjectConfig {
  id: string
  name: string
  path: string
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

export interface ExedeckApi {
  configGet: () => Promise<AppConfig>
  configSet: (config: AppConfig) => Promise<boolean>
  pickDirectory: (initialPath?: string) => Promise<string | null>
  taskStart: (taskId: string) => Promise<boolean>
  taskStop: (taskId: string) => Promise<boolean>
  taskRestart: (taskId: string) => Promise<boolean>
  taskInput: (taskId: string, data: string) => Promise<boolean>
  taskGetBuffer: (taskId: string) => Promise<string>
  taskClearBuffer: (taskId: string) => Promise<boolean>
  onTaskData: (listener: (event: TaskDataEvent) => void) => () => void
  onTaskStatus: (listener: (event: TaskStatusEvent) => void) => () => void
  onTaskStats: (listener: (event: TaskStatsEvent) => void) => () => void
  onTaskExit: (listener: (event: TaskExitEvent) => void) => () => void
}
