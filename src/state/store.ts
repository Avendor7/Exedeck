import { computed, ref } from 'vue'
import type {
  AgentRuntimeSnapshot,
  AppConfig,
  ProjectConfig,
  TaskConfig,
  TaskRuntimeSnapshot,
  WorkspaceAgent,
  WorkspaceConfig,
  WorkspaceTerminal,
} from '../../shared/types'
import { prepareConfigForIpc } from '../utils/configSerialization'

export type WorkspaceItemKind = 'workspace' | 'git' | 'agent' | 'terminal' | 'task'

const config = ref<AppConfig | null>(null)
const selectedProjectId = ref('')
const selectedWorkspaceId = ref('')
const selectedItemKind = ref<WorkspaceItemKind>('workspace')
const selectedItemId = ref('')
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
  const preferred = next.workspaces.find((item) => item.id === next.preferences.lastWorkspaceId)
  const selected = next.workspaces.find((item) => item.id === selectedWorkspaceId.value)
  const workspace = selected ?? preferred ?? next.workspaces[0]
  selectedWorkspaceId.value = workspace?.id ?? ''
  const project =
    next.projects.find((item) => item.id === workspace?.projectId) ??
    next.projects.find((item) => item.id === selectedProjectId.value) ??
    next.projects[0]
  selectedProjectId.value = project?.id ?? ''

  const itemStillExists =
    selectedItemKind.value === 'workspace' ||
    (selectedItemKind.value === 'git' && selectedItemId.value === workspace?.id) ||
    (selectedItemKind.value === 'agent' && workspace?.agents.some((item) => item.id === selectedItemId.value)) ||
    (selectedItemKind.value === 'terminal' && workspace?.terminals.some((item) => item.id === selectedItemId.value)) ||
    (selectedItemKind.value === 'task' && project?.tasks.some((item) => item.id === selectedItemId.value))
  if (!itemStillExists) {
    selectedItemKind.value = 'workspace'
    selectedItemId.value = ''
  }
}

async function loadTaskBuffer(taskId: string, force = false): Promise<void> {
  if (!taskId || (loadedTaskBuffers.has(taskId) && !force)) return
  taskBuffers.value[taskId] = await window.exedeck.processes.getBuffer(taskId)
  loadedTaskBuffers.add(taskId)
}

async function loadAgentBuffer(agentId: string, force = false): Promise<void> {
  if (!agentId || (loadedAgentBuffers.has(agentId) && !force)) return
  agentBuffers.value[agentId] = await window.exedeck.agents.getBuffer(agentId)
  loadedAgentBuffers.add(agentId)
}

export function useStore() {
  const projects = computed(() => config.value?.projects ?? [])
  const project = computed<ProjectConfig | null>(
    () => projects.value.find((item) => item.id === selectedProjectId.value) ?? null,
  )
  const workspace = computed<WorkspaceConfig | null>(
    () => config.value?.workspaces.find((item) => item.id === selectedWorkspaceId.value) ?? null,
  )
  const selectedAgent = computed<WorkspaceAgent | null>(
    () =>
      (selectedItemKind.value === 'agent'
        ? workspace.value?.agents.find((item) => item.id === selectedItemId.value)
        : null) ?? null,
  )
  const selectedTerminal = computed<WorkspaceTerminal | null>(
    () =>
      (selectedItemKind.value === 'terminal'
        ? workspace.value?.terminals.find((item) => item.id === selectedItemId.value)
        : null) ?? null,
  )
  const selectedTask = computed<TaskConfig | null>(
    () =>
      (selectedItemKind.value === 'task'
        ? project.value?.tasks.find((item) => item.id === selectedItemId.value)
        : null) ?? null,
  )
  const selectedProcess = computed(() => selectedTerminal.value ?? selectedTask.value)
  const selectedTaskBuffer = computed(() =>
    selectedProcess.value ? (taskBuffers.value[selectedProcess.value.id] ?? '') : '',
  )
  const selectedTaskRuntime = computed<TaskRuntimeSnapshot>(() =>
    selectedProcess.value ? (taskRuntime.value[selectedProcess.value.id] ?? { running: false }) : { running: false },
  )
  const selectedTaskStats = computed(() =>
    selectedProcess.value
      ? (taskStats.value[selectedProcess.value.id] ?? { cpu: 0, memoryMb: 0 })
      : { cpu: 0, memoryMb: 0 },
  )
  const selectedAgentBuffer = computed(() =>
    selectedAgent.value ? (agentBuffers.value[selectedAgent.value.id] ?? '') : '',
  )
  const selectedAgentRuntime = computed<AgentRuntimeSnapshot>(() =>
    selectedAgent.value
      ? (agentRuntime.value[selectedAgent.value.id] ?? { state: 'stopped', unread: false })
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
    const nextWorkspace = config.value?.workspaces.find((item) => item.id === workspaceId)
    if (!nextWorkspace || !config.value) return
    selectedWorkspaceId.value = workspaceId
    selectedProjectId.value = nextWorkspace.projectId
    selectedItemKind.value = 'workspace'
    selectedItemId.value = ''
    if (config.value.preferences.lastWorkspaceId !== workspaceId) {
      await saveConfig({
        ...config.value,
        preferences: { ...config.value.preferences, lastWorkspaceId: workspaceId },
      })
    }
  }

  function selectProject(projectId: string): void {
    selectedProjectId.value = projectId
    selectedWorkspaceId.value = ''
    selectedItemKind.value = 'workspace'
    selectedItemId.value = ''
  }

  async function selectWorkspaceItem(kind: Exclude<WorkspaceItemKind, 'workspace'>, id: string): Promise<void> {
    selectedItemKind.value = kind
    selectedItemId.value = id
    if (kind === 'agent') {
      await Promise.all([loadAgentBuffer(id), window.exedeck.agents.markRead(id)])
    } else if (kind === 'terminal' || kind === 'task') {
      await loadTaskBuffer(id)
    }
  }

  async function startTask(taskId: string): Promise<void> {
    const result = await window.exedeck.processes.start({
      taskId,
      ...(workspace.value ? { checkoutId: workspace.value.checkoutId } : {}),
    })
    if (!result.ok) lastError.value = result.message || 'The process could not be started.'
  }

  async function restartTask(taskId: string): Promise<void> {
    const result = await window.exedeck.processes.restart({
      taskId,
      ...(workspace.value ? { checkoutId: workspace.value.checkoutId } : {}),
    })
    if (!result.ok) lastError.value = result.message || 'The process could not be restarted.'
  }

  return {
    config,
    projects,
    project,
    workspace,
    onboardingRequired,
    filterText,
    lastError,
    selectedProjectId,
    selectedWorkspaceId,
    selectedItemKind,
    selectedItemId,
    selectedAgent,
    selectedTerminal,
    selectedTask,
    selectedProcess,
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
    selectWorkspaceItem,
    startTask,
    restartTask,
    stopTask: (taskId: string) => window.exedeck.processes.stop(taskId),
    inputTask: (taskId: string, data: string) => window.exedeck.processes.input(taskId, data),
    resizeTask: (taskId: string, cols: number, rows: number) => window.exedeck.processes.resize(taskId, cols, rows),
    clearTaskBuffer: async (taskId: string) => {
      if (await window.exedeck.processes.clearBuffer(taskId)) taskBuffers.value[taskId] = ''
    },
    startAgent: (prompt?: string) =>
      selectedAgent.value
        ? window.exedeck.agents.start({ workspaceId: selectedAgent.value.id, prompt })
        : Promise.resolve(false),
    stopAgent: () =>
      selectedAgent.value ? window.exedeck.agents.stop(selectedAgent.value.id) : Promise.resolve(false),
    restartAgent: () =>
      selectedAgent.value ? window.exedeck.agents.restart(selectedAgent.value.id) : Promise.resolve(false),
    inputAgent: (data: string) =>
      selectedAgent.value ? window.exedeck.agents.input(selectedAgent.value.id, data) : Promise.resolve(false),
    resizeAgent: (cols: number, rows: number) =>
      selectedAgent.value ? window.exedeck.agents.resize(selectedAgent.value.id, cols, rows) : Promise.resolve(false),
    clearAgentBuffer: async () => {
      if (selectedAgent.value && (await window.exedeck.agents.clearBuffer(selectedAgent.value.id))) {
        agentBuffers.value[selectedAgent.value.id] = ''
      }
    },
    getAgentRuntime: (id: string) => agentRuntime.value[id] ?? { state: 'stopped', unread: false },
    getTaskRuntime: (id: string) => taskRuntime.value[id] ?? { running: false },
    clearError: () => {
      lastError.value = ''
    },
  }
}
