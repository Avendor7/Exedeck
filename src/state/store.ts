import { computed, ref } from 'vue'
import type { AgentRuntimeSnapshot, AppConfig, ProjectConfig, TaskConfig, TaskStatsEvent } from '../../shared/types'

const config = ref<AppConfig | null>(null)
const selectedProjectId = ref<string>('')
const selectedTaskId = ref<string>('')
const filterText = ref('')
const projectCollapsedById = ref<Record<string, boolean>>({})
const lastError = ref('')

const taskBuffers = ref<Record<string, string>>({})
const taskRunning = ref<Record<string, boolean>>({})
const taskStats = ref<Record<string, TaskStatsEvent>>({})
const agentRuntime = ref<Record<string, AgentRuntimeSnapshot>>({})

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

  window.exedeck.processes.onData(({ taskId, chunk }) => {
    pushBuffer(taskId, chunk)
  })

  window.exedeck.processes.onStatus(({ taskId, running }) => {
    taskRunning.value[taskId] = running
  })

  window.exedeck.processes.onStats((stats) => {
    taskStats.value[stats.taskId] = stats
  })

  window.exedeck.processes.onExit(({ taskId }) => {
    taskRunning.value[taskId] = false
  })

  window.exedeck.agents.onStatus(({ sessionId, state, unread }) => {
    agentRuntime.value[sessionId] = { state, unread }
  })

  window.exedeck.agents.onExit(({ sessionId, exitCode }) => {
    agentRuntime.value[sessionId] = {
      state: exitCode === 0 ? 'stopped' : 'crashed',
      unread: agentRuntime.value[sessionId]?.unread ?? true,
    }
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
  const activeAgentIds = new Set(nextConfig.agentSessions.map((session) => session.id))

  taskBuffers.value = Object.fromEntries(
    Object.entries(taskBuffers.value).filter(([taskId]) => activeTaskIds.has(taskId)),
  )
  taskRunning.value = Object.fromEntries(
    Object.entries(taskRunning.value).filter(([taskId]) => activeTaskIds.has(taskId)),
  )
  taskStats.value = Object.fromEntries(
    Object.entries(taskStats.value).filter(([taskId]) => activeTaskIds.has(taskId)),
  )
  agentRuntime.value = Object.fromEntries(
    Object.entries(agentRuntime.value).filter(([sessionId]) => activeAgentIds.has(sessionId)),
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
  await Promise.all(
    tasks.map(async (task) => {
      const [buffer, status] = await Promise.all([
        window.exedeck.processes.getBuffer(task.id),
        window.exedeck.processes.getStatus(task.id),
      ])
      taskBuffers.value[task.id] = buffer
      taskRunning.value[task.id] = status.running
    }),
  )
}

async function hydrateAgentStatuses(sessionIds: string[]): Promise<void> {
  await Promise.all(sessionIds.map(async (sessionId) => {
    agentRuntime.value[sessionId] = await window.exedeck.agents.getStatus(sessionId)
  }))
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

  const getAgentRuntime = (sessionId: string): AgentRuntimeSnapshot =>
    agentRuntime.value[sessionId] ?? { state: 'stopped', unread: false }

  const loadConfig = async (): Promise<void> => {
    try {
      lastError.value = ''
      attachTaskListeners()
      const nextConfig = await window.exedeck.projects.getConfig()
      config.value = nextConfig
      ensureSelections(config.value)
      await hydrateTaskBuffers(nextConfig.projects.flatMap((item) => item.tasks))
      await hydrateAgentStatuses(nextConfig.agentSessions.map((session) => session.id))
    } catch (error) {
      lastError.value = error instanceof Error ? error.message : 'Could not load the application configuration.'
      throw error
    }
  }

  const saveConfig = async (nextConfig: AppConfig): Promise<void> => {
    try {
      lastError.value = ''
      const prepared = withOnboardingState(nextConfig)
      const savedConfig = await window.exedeck.projects.setConfig(prepared)
      config.value = savedConfig
      ensureSelections(config.value)
      await hydrateTaskBuffers(savedConfig.projects.flatMap((item) => item.tasks))
      await hydrateAgentStatuses(savedConfig.agentSessions.map((session) => session.id))
    } catch (error) {
      lastError.value = error instanceof Error ? error.message : 'Could not save the application configuration.'
      throw error
    }
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
    lastError.value = ''
    if (!(await window.exedeck.processes.start(taskId))) {
      lastError.value = 'The task could not be started. Check its command and working directory.'
    }
  }

  const stopTask = async (taskId: string): Promise<void> => {
    lastError.value = ''
    if (!(await window.exedeck.processes.stop(taskId))) {
      lastError.value = 'The task did not stop cleanly.'
    }
  }

  const restartTask = async (taskId: string): Promise<void> => {
    lastError.value = ''
    if (!(await window.exedeck.processes.restart(taskId))) {
      lastError.value = 'The task could not be restarted.'
    }
  }

  const inputTask = async (taskId: string, data: string): Promise<void> => {
    await window.exedeck.processes.input(taskId, data)
  }

  const resizeTask = async (taskId: string, cols: number, rows: number): Promise<void> => {
    await window.exedeck.processes.resize(taskId, cols, rows)
  }

  const clearTaskBuffer = async (taskId: string): Promise<void> => {
    if (await window.exedeck.processes.clearBuffer(taskId)) {
      taskBuffers.value[taskId] = ''
    }
  }

  const clearError = (): void => {
    lastError.value = ''
  }

  return {
    config,
    projects,
    project,
    onboardingRequired,
    filterText,
    projectCollapsedById,
    lastError,
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
    getAgentRuntime,
    startTask,
    stopTask,
    restartTask,
    inputTask,
    resizeTask,
    clearTaskBuffer,
    clearError,
  }
}
