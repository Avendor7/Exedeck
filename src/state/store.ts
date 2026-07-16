import { computed, ref } from 'vue'
import type {
  AgentRuntimeSnapshot,
  AgentWorkspace,
  AppConfig,
  ProjectConfig,
  TaskConfig,
  TaskRuntimeSnapshot,
} from '../../shared/types'
import { prepareConfigForIpc } from '../utils/configSerialization'

const config = ref<AppConfig | null>(null)
const selectedProjectId = ref('')
const selectedWorkspaceId = ref('')
const selectedTaskId = ref('')
const filterText = ref('')
const lastError = ref('')
const taskBuffers = ref<Record<string, string>>({})
const taskRuntime = ref<Record<string, TaskRuntimeSnapshot>>({})
const taskStats = ref<Record<string, { cpu: number; memoryMb: number }>>({})
const agentBuffers = ref<Record<string, string>>({})
const agentRuntime = ref<Record<string, AgentRuntimeSnapshot>>({})
const loadedTaskBuffers = new Set<string>()
const loadedAgentBuffers = new Set<string>()
let listenersAttached = false

function appendBounded(existing: string, chunk: string): string {
  const value = existing + chunk
  return value.length <= 250_000 ? value : value.slice(-250_000)
}

function attachListeners(): void {
  if (listenersAttached) return
  listenersAttached = true
  window.exedeck.processes.onData(({ taskId, chunk }) => {
    taskBuffers.value[taskId] = appendBounded(taskBuffers.value[taskId] ?? '', chunk)
  })
  window.exedeck.processes.onStatus(({ taskId, running, checkoutId }) => {
    taskRuntime.value[taskId] = {
      ...taskRuntime.value[taskId],
      running,
      ...(checkoutId ? { checkoutId } : {}),
    }
  })
  window.exedeck.processes.onStats(({ stats }) => {
    for (const item of stats) taskStats.value[item.taskId] = item
  })
  window.exedeck.processes.onExit(({ taskId }) => {
    taskRuntime.value[taskId] = { ...taskRuntime.value[taskId], running: false }
  })
  window.exedeck.agents.onData(({ workspaceId, chunk }) => {
    agentBuffers.value[workspaceId] = appendBounded(agentBuffers.value[workspaceId] ?? '', chunk)
  })
  window.exedeck.agents.onStatus((event) => {
    agentRuntime.value[event.workspaceId] = { state: event.state, unread: event.unread }
  })
  window.exedeck.agents.onExit(({ workspaceId, exitCode }) => {
    agentRuntime.value[workspaceId] = {
      state: exitCode === 0 ? 'stopped' : 'crashed',
      unread: agentRuntime.value[workspaceId]?.unread ?? false,
    }
  })
}

function ensureSelections(next: AppConfig): void {
  const active = next.agentWorkspaces.filter((workspace) => !workspace.archivedAt)
  const preferred = active.find((workspace) => workspace.id === next.preferences.lastWorkspaceId)
  const selected = active.find((workspace) => workspace.id === selectedWorkspaceId.value)
  const workspace = selected ?? preferred ?? active[0]
  selectedWorkspaceId.value = workspace?.id ?? ''
  const project =
    next.projects.find((item) => item.id === workspace?.projectId) ??
    next.projects.find((item) => item.id === selectedProjectId.value) ??
    next.projects[0]
  selectedProjectId.value = project?.id ?? ''
  if (!project?.tasks.some((task) => task.id === selectedTaskId.value)) {
    selectedTaskId.value = project?.tasks[0]?.id ?? ''
  }
}

async function loadTaskBuffer(taskId: string, force = false): Promise<void> {
  if (!taskId || (loadedTaskBuffers.has(taskId) && !force)) return
  taskBuffers.value[taskId] = await window.exedeck.processes.getBuffer(taskId)
  loadedTaskBuffers.add(taskId)
}

async function loadAgentBuffer(workspaceId: string, force = false): Promise<void> {
  if (!workspaceId || (loadedAgentBuffers.has(workspaceId) && !force)) return
  agentBuffers.value[workspaceId] = await window.exedeck.agents.getBuffer(workspaceId)
  loadedAgentBuffers.add(workspaceId)
}

export function useStore() {
  const projects = computed(() => config.value?.projects ?? [])
  const project = computed<ProjectConfig | null>(
    () => projects.value.find((item) => item.id === selectedProjectId.value) ?? null,
  )
  const workspace = computed<AgentWorkspace | null>(
    () => config.value?.agentWorkspaces.find((item) => item.id === selectedWorkspaceId.value) ?? null,
  )
  const activeWorkspaces = computed(() => config.value?.agentWorkspaces.filter((item) => !item.archivedAt) ?? [])
  const archivedWorkspaces = computed(() => config.value?.agentWorkspaces.filter((item) => item.archivedAt) ?? [])
  const selectedTask = computed<TaskConfig | null>(
    () => project.value?.tasks.find((item) => item.id === selectedTaskId.value) ?? project.value?.tasks[0] ?? null,
  )
  const selectedTaskBuffer = computed(() =>
    selectedTask.value ? (taskBuffers.value[selectedTask.value.id] ?? '') : '',
  )
  const selectedTaskRuntime = computed<TaskRuntimeSnapshot>(() =>
    selectedTask.value ? (taskRuntime.value[selectedTask.value.id] ?? { running: false }) : { running: false },
  )
  const selectedTaskStats = computed(() =>
    selectedTask.value ? (taskStats.value[selectedTask.value.id] ?? { cpu: 0, memoryMb: 0 }) : { cpu: 0, memoryMb: 0 },
  )
  const selectedAgentBuffer = computed(() => (workspace.value ? (agentBuffers.value[workspace.value.id] ?? '') : ''))
  const selectedAgentRuntime = computed<AgentRuntimeSnapshot>(() =>
    workspace.value
      ? (agentRuntime.value[workspace.value.id] ?? { state: 'stopped', unread: false })
      : { state: 'stopped', unread: false },
  )
  const onboardingRequired = computed(() => Boolean(config.value && config.value.projects.length === 0))

  async function loadConfig(): Promise<void> {
    attachListeners()
    const next = await window.exedeck.projects.getConfig()
    config.value = next
    ensureSelections(next)
    ;[taskRuntime.value, agentRuntime.value] = await Promise.all([
      window.exedeck.processes.getStatuses(),
      window.exedeck.agents.getStatuses(),
    ])
    await Promise.all([loadTaskBuffer(selectedTaskId.value), loadAgentBuffer(selectedWorkspaceId.value)])
  }

  async function saveConfig(next: AppConfig): Promise<void> {
    try {
      lastError.value = ''
      config.value = await window.exedeck.projects.setConfig(prepareConfigForIpc(next))
      ensureSelections(config.value)
    } catch (error) {
      lastError.value = error instanceof Error ? error.message : 'Could not save the configuration.'
      throw error
    }
  }

  async function activateWorkspace(workspaceId: string): Promise<void> {
    const nextWorkspace = config.value?.agentWorkspaces.find((item) => item.id === workspaceId && !item.archivedAt)
    if (!nextWorkspace || !config.value) return
    selectedWorkspaceId.value = workspaceId
    selectedProjectId.value = nextWorkspace.projectId
    selectedTaskId.value = config.value.projects.find((item) => item.id === nextWorkspace.projectId)?.tasks[0]?.id ?? ''
    await Promise.all([loadAgentBuffer(workspaceId), window.exedeck.agents.markRead(workspaceId)])
    if (config.value.preferences.lastWorkspaceId !== workspaceId) {
      config.value = await window.exedeck.projects.setConfig({
        ...config.value,
        preferences: { ...config.value.preferences, lastWorkspaceId: workspaceId },
      })
    }
  }

  function selectProject(projectId: string): void {
    selectedProjectId.value = projectId
    selectedWorkspaceId.value = ''
    selectedTaskId.value = config.value?.projects.find((item) => item.id === projectId)?.tasks[0]?.id ?? ''
    void loadTaskBuffer(selectedTaskId.value)
  }

  function selectTask(taskId: string): void {
    selectedTaskId.value = taskId
    void loadTaskBuffer(taskId)
  }

  async function startTask(taskId: string): Promise<void> {
    const result = await window.exedeck.processes.start({
      taskId,
      ...(workspace.value ? { checkoutId: workspace.value.checkoutId } : {}),
    })
    if (!result.ok) {
      lastError.value =
        result.alreadyRunning && result.checkoutId
          ? `This task is already running in checkout ${result.checkoutId}.`
          : result.message || 'The task could not be started.'
    }
  }

  async function restartTask(taskId: string): Promise<void> {
    const result = await window.exedeck.processes.restart({
      taskId,
      ...(workspace.value ? { checkoutId: workspace.value.checkoutId } : {}),
    })
    if (!result.ok) lastError.value = result.message || 'The task could not be restarted.'
  }

  return {
    config,
    projects,
    project,
    workspace,
    activeWorkspaces,
    archivedWorkspaces,
    onboardingRequired,
    filterText,
    lastError,
    selectedProjectId,
    selectedWorkspaceId,
    selectedTaskId,
    selectedTask,
    selectedTaskBuffer,
    selectedTaskRuntime,
    selectedTaskStats,
    selectedAgentBuffer,
    selectedAgentRuntime,
    taskRuntime,
    agentRuntime,
    loadConfig,
    saveConfig,
    activateWorkspace,
    selectProject,
    selectTask,
    startTask,
    restartTask,
    stopTask: (taskId: string) => window.exedeck.processes.stop(taskId),
    inputTask: (taskId: string, data: string) => window.exedeck.processes.input(taskId, data),
    resizeTask: (taskId: string, cols: number, rows: number) => window.exedeck.processes.resize(taskId, cols, rows),
    clearTaskBuffer: async (taskId: string) => {
      if (await window.exedeck.processes.clearBuffer(taskId)) taskBuffers.value[taskId] = ''
    },
    startAgent: (prompt?: string) =>
      workspace.value
        ? window.exedeck.agents.start({ workspaceId: workspace.value.id, prompt })
        : Promise.resolve(false),
    stopAgent: () => (workspace.value ? window.exedeck.agents.stop(workspace.value.id) : Promise.resolve(false)),
    restartAgent: () => (workspace.value ? window.exedeck.agents.restart(workspace.value.id) : Promise.resolve(false)),
    inputAgent: (data: string) =>
      workspace.value ? window.exedeck.agents.input(workspace.value.id, data) : Promise.resolve(false),
    resizeAgent: (cols: number, rows: number) =>
      workspace.value ? window.exedeck.agents.resize(workspace.value.id, cols, rows) : Promise.resolve(false),
    clearAgentBuffer: async () => {
      if (workspace.value && (await window.exedeck.agents.clearBuffer(workspace.value.id))) {
        agentBuffers.value[workspace.value.id] = ''
      }
    },
    getAgentRuntime: (id: string) => agentRuntime.value[id] ?? { state: 'stopped', unread: false },
    getTaskRuntime: (id: string) => taskRuntime.value[id] ?? { running: false },
    clearError: () => {
      lastError.value = ''
    },
  }
}
