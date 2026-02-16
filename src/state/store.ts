import { computed, ref } from 'vue'
import type { AppConfig, ProjectConfig, TaskConfig, TaskStatsEvent } from '../../shared/types'

const config = ref<AppConfig | null>(null)
const selectedProjectId = ref<string>('')
const selectedTaskId = ref<string>('')
const filterText = ref('')
const projectCollapsedById = ref<Record<string, boolean>>({})

const taskBuffers = ref<Record<string, string>>({})
const taskRunning = ref<Record<string, boolean>>({})
const taskStats = ref<Record<string, TaskStatsEvent>>({})

let listenersAttached = false

function pushBuffer(taskId: string, chunk: string): void {
  const next = `${taskBuffers.value[taskId] ?? ''}${chunk}`
  const maxChars = 250_000
  taskBuffers.value[taskId] = next.length > maxChars ? next.slice(next.length - maxChars) : next
}

function attachTaskListeners(): void {
  if (listenersAttached) {
    return
  }

  listenersAttached = true

  window.exedeck.onTaskData(({ taskId, chunk }) => {
    pushBuffer(taskId, chunk)
  })

  window.exedeck.onTaskStatus(({ taskId, running }) => {
    taskRunning.value[taskId] = running
  })

  window.exedeck.onTaskStats((stats) => {
    taskStats.value[stats.taskId] = stats
  })

  window.exedeck.onTaskExit(({ taskId }) => {
    taskRunning.value[taskId] = false
  })
}

function pruneTaskState(nextConfig: AppConfig | null): void {
  if (!nextConfig) {
    taskBuffers.value = {}
    taskRunning.value = {}
    taskStats.value = {}
    return
  }

  const activeTaskIds = new Set(nextConfig.projects.flatMap((project) => project.tasks.map((task) => task.id)))

  taskBuffers.value = Object.fromEntries(
    Object.entries(taskBuffers.value).filter(([taskId]) => activeTaskIds.has(taskId)),
  )
  taskRunning.value = Object.fromEntries(
    Object.entries(taskRunning.value).filter(([taskId]) => activeTaskIds.has(taskId)),
  )
  taskStats.value = Object.fromEntries(
    Object.entries(taskStats.value).filter(([taskId]) => activeTaskIds.has(taskId)),
  )
}

function ensureSelections(nextConfig: AppConfig | null): void {
  pruneTaskState(nextConfig)

  if (!nextConfig) {
    selectedProjectId.value = ''
    selectedTaskId.value = ''
    projectCollapsedById.value = {}
    return
  }

  const projects = nextConfig.projects
  const selectedProject = projects.find((project) => project.id === selectedProjectId.value) ?? projects[0]

  if (!selectedProject) {
    selectedProjectId.value = ''
    selectedTaskId.value = ''
    return
  }

  selectedProjectId.value = selectedProject.id

  const selectedTask = selectedProject.tasks.find((task) => task.id === selectedTaskId.value) ?? selectedProject.tasks[0]
  selectedTaskId.value = selectedTask?.id ?? ''

  const nextCollapsed: Record<string, boolean> = {}
  for (const item of nextConfig.projects) {
    nextCollapsed[item.id] = projectCollapsedById.value[item.id] ?? false
  }
  projectCollapsedById.value = nextCollapsed
}

async function hydrateTaskBuffers(tasks: TaskConfig[]): Promise<void> {
  for (const task of tasks) {
    if (Object.hasOwn(taskBuffers.value, task.id)) {
      continue
    }

    const buffer = await window.exedeck.taskGetBuffer(task.id)
    taskBuffers.value[task.id] = buffer
  }
}

function withOnboardingState(nextConfig: AppConfig): AppConfig {
  return {
    ...nextConfig,
    onboardingCompleted: nextConfig.projects.length > 0 && nextConfig.onboardingCompleted,
  }
}

export function useStore() {
  const projects = computed<ProjectConfig[]>(() => config.value?.projects ?? [])

  const onboardingRequired = computed<boolean>(() => {
    if (!config.value) {
      return false
    }

    return !config.value.onboardingCompleted || config.value.projects.length === 0
  })

  const project = computed<ProjectConfig | null>(
    () => projects.value.find((item) => item.id === selectedProjectId.value) ?? projects.value[0] ?? null,
  )

  const allTasks = computed<TaskConfig[]>(() => project.value?.tasks ?? [])

  const selectedTask = computed<TaskConfig | null>(() => {
    const fallback = allTasks.value[0] ?? null
    if (!selectedTaskId.value) {
      return fallback
    }

    return allTasks.value.find((task) => task.id === selectedTaskId.value) ?? fallback
  })

  const selectedTaskBuffer = computed<string>(() => {
    if (!selectedTask.value) {
      return ''
    }
    return taskBuffers.value[selectedTask.value.id] ?? ''
  })

  const selectedTaskRunning = computed<boolean>(() => {
    if (!selectedTask.value) {
      return false
    }
    return taskRunning.value[selectedTask.value.id] === true
  })

  const selectedTaskStats = computed<{ cpu: number; memoryMb: number }>(() => {
    if (!selectedTask.value) {
      return { cpu: 0, memoryMb: 0 }
    }

    const stats = taskStats.value[selectedTask.value.id]
    if (!stats) {
      return { cpu: 0, memoryMb: 0 }
    }

    return {
      cpu: stats.cpu,
      memoryMb: stats.memoryMb,
    }
  })

  const getTaskRunning = (taskId: string): boolean => taskRunning.value[taskId] === true

  const getTaskStats = (taskId: string): { cpu: number; memoryMb: number } => {
    const stats = taskStats.value[taskId]
    if (!stats) {
      return { cpu: 0, memoryMb: 0 }
    }

    return {
      cpu: stats.cpu,
      memoryMb: stats.memoryMb,
    }
  }

  const loadConfig = async (): Promise<void> => {
    attachTaskListeners()
    const nextConfig = await window.exedeck.configGet()
    config.value = nextConfig
    ensureSelections(config.value)
    await hydrateTaskBuffers(nextConfig.projects.flatMap((item) => item.tasks))
  }

  const saveConfig = async (nextConfig: AppConfig): Promise<void> => {
    const prepared = withOnboardingState(nextConfig)
    await window.exedeck.configSet(prepared)
    config.value = prepared
    ensureSelections(config.value)
    await hydrateTaskBuffers(prepared.projects.flatMap((item) => item.tasks))
  }

  const setSelectedTaskId = (taskId: string): void => {
    selectedTaskId.value = taskId
  }

  const setSelectedProjectId = (projectId: string): void => {
    selectedProjectId.value = projectId
    ensureSelections(config.value)
  }

  const setProjectCollapsed = (projectId: string, collapsed: boolean): void => {
    projectCollapsedById.value = {
      ...projectCollapsedById.value,
      [projectId]: collapsed,
    }
  }

  const startTask = async (taskId: string): Promise<void> => {
    await window.exedeck.taskStart(taskId)
  }

  const stopTask = async (taskId: string): Promise<void> => {
    await window.exedeck.taskStop(taskId)
  }

  const restartTask = async (taskId: string): Promise<void> => {
    await window.exedeck.taskRestart(taskId)
  }

  const inputTask = async (taskId: string, data: string): Promise<void> => {
    await window.exedeck.taskInput(taskId, data)
  }

  const clearTaskBuffer = async (taskId: string): Promise<void> => {
    await window.exedeck.taskClearBuffer(taskId)
    taskBuffers.value[taskId] = ''
  }

  return {
    config,
    projects,
    project,
    onboardingRequired,
    filterText,
    projectCollapsedById,
    selectedTask,
    selectedTaskId,
    selectedProjectId,
    selectedTaskBuffer,
    selectedTaskRunning,
    selectedTaskStats,
    loadConfig,
    saveConfig,
    setSelectedTaskId,
    setSelectedProjectId,
    setProjectCollapsed,
    getTaskRunning,
    getTaskStats,
    startTask,
    stopTask,
    restartTask,
    inputTask,
    clearTaskBuffer,
  }
}
