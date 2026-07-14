<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import NewProjectWizard from './components/NewProjectWizard.vue'
import OnboardingWizard from './components/OnboardingWizard.vue'
import SettingsModal from './components/SettingsModal.vue'
import Sidebar from './components/Sidebar.vue'
import TerminalView from './components/TerminalView.vue'
import Toolbar from './components/Toolbar.vue'
import { useStore } from './state/store'
import type { AppConfig } from '../shared/types'

const {
  config,
  projects,
  project,
  onboardingRequired,
  filterText,
  projectCollapsedById,
  lastError,
  selectedTask,
  selectedTaskBuffer,
  selectedTaskRunning,
  selectedTaskStats,
  selectedProjectId,
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
  resizeTask,
  clearTaskBuffer,
  clearError,
} = useStore()

const terminalRef = ref<InstanceType<typeof TerminalView> | null>(null)
const sidebarRef = ref<InstanceType<typeof Sidebar> | null>(null)
const settingsOpen = ref(false)
const settingsProjectId = ref('')
const newProjectOpen = ref(false)
const loading = ref(true)
const loadError = ref('')

const headerText = computed(() => {
  if (!project.value || !selectedTask.value) {
    return 'Exedeck'
  }

  return `${project.value.name} - ${selectedTask.value.name}`
})

const selectedTaskStatusLabel = computed(() => (selectedTaskRunning.value ? 'Running' : 'Stopped'))

async function initialize(): Promise<void> {
  loading.value = true
  loadError.value = ''
  try {
    await loadConfig()
  } catch {
    loadError.value = lastError.value || 'Exedeck could not load its configuration.'
  } finally {
    loading.value = false
  }
}

const onGlobalKeydown = (event: KeyboardEvent): void => {
  if (settingsOpen.value || newProjectOpen.value || onboardingRequired.value) {
    return
  }

  const modifier = event.metaKey || event.ctrlKey
  if (modifier && event.key.toLowerCase() === 'f') {
    event.preventDefault()
    sidebarRef.value?.focusSearch()
    return
  }

  if (modifier && event.key === ',') {
    event.preventDefault()
    if (selectedProjectId.value) {
      onOpenProjectSettings(selectedProjectId.value)
    }
    return
  }

  if ((event.ctrlKey && event.key === '`') || event.key === 'F6') {
    event.preventDefault()
    onFocus()
  }
}

onMounted(() => {
  window.addEventListener('keydown', onGlobalKeydown)
  void initialize()
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onGlobalKeydown)
})

const onTerminalInput = async (data: string): Promise<void> => {
  if (!selectedTask.value) {
    return
  }

  await inputTask(selectedTask.value.id, data)
}

const onTerminalResize = async (size: { cols: number; rows: number }): Promise<void> => {
  if (!selectedTask.value) {
    return
  }

  await resizeTask(selectedTask.value.id, size.cols, size.rows)
}

const onFocus = (): void => {
  terminalRef.value?.focusTerminal()
}

const onClear = async (): Promise<void> => {
  if (!selectedTask.value) {
    return
  }

  await clearTaskBuffer(selectedTask.value.id)
  terminalRef.value?.clearTerminal()
}

const onStart = async (taskId: string): Promise<void> => {
  await startTask(taskId)
}

const onStartSelected = async (): Promise<void> => {
  if (selectedTask.value) {
    await onStart(selectedTask.value.id)
  }
}

const onStop = async (): Promise<void> => {
  if (!selectedTask.value) {
    return
  }

  await stopTask(selectedTask.value.id)
}

const onRestart = async (): Promise<void> => {
  if (!selectedTask.value) {
    return
  }

  await restartTask(selectedTask.value.id)
}

const onFilterChange = (value: string): void => {
  filterText.value = value
}

const onOpenProjectSettings = (projectId: string): void => {
  settingsProjectId.value = projectId
  setProjectCollapsed(projectId, true)
  settingsOpen.value = true
}

const onOpenNewProject = (): void => {
  newProjectOpen.value = true
}

const onSelectTask = (projectId: string, taskId: string): void => {
  setSelectedProjectId(projectId)
  setSelectedTaskId(taskId)
}

const onCloseSettings = (): void => {
  settingsOpen.value = false
  settingsProjectId.value = ''
}

const onCloseNewProject = (): void => {
  newProjectOpen.value = false
}

const onSaveSettings = async (nextConfig: AppConfig, nextProjectId: string): Promise<void> => {
  try {
    await saveConfig(nextConfig)
    setSelectedProjectId(nextProjectId)
    settingsOpen.value = false
    settingsProjectId.value = ''
  } catch {
    // The store exposes the actionable error in the global alert.
  }
}

const onOnboardingComplete = async (nextConfig: AppConfig): Promise<void> => {
  try {
    await saveConfig(nextConfig)
    setSelectedProjectId(nextConfig.projects[0]?.id ?? '')
  } catch {
    // The onboarding dialog remains open so the user can retry.
  }
}

const onProjectCreated = async (projectId: string): Promise<void> => {
  try {
    await loadConfig()
    setSelectedProjectId(projectId)
    newProjectOpen.value = false
  } catch {
    // The store exposes the load error without discarding the completed job view.
  }
}

const onCreateProjectFromSettings = (): void => {
  settingsOpen.value = false
  settingsProjectId.value = ''
  newProjectOpen.value = true
}
</script>

<template>
  <div class="layout" v-if="config">
    <Sidebar
      ref="sidebarRef"
      :projects="projects"
      :selected-project-id="selectedProjectId"
      :selected-task-id="selectedTask?.id ?? ''"
      :collapsed-by-project="projectCollapsedById"
      :filter-text="filterText"
      :is-running="getTaskRunning"
      :get-stats="getTaskStats"
      @select-project="setSelectedProjectId"
      @select-task="onSelectTask"
      @start="onStart"
      @toggle-project-collapsed="setProjectCollapsed"
      @update-filter="onFilterChange"
      @open-project-settings="onOpenProjectSettings"
      @create-project="onOpenNewProject"
    />

    <main class="main-panel">
      <header class="panel-header">
        <div class="panel-heading">
          <span v-if="project" class="panel-eyebrow">{{ project.name }}</span>
          <h1>{{ selectedTask?.name ?? 'No task selected' }}</h1>
        </div>
        <span class="running-pill" :class="{ active: selectedTaskRunning }" role="status">
          <span class="status-dot" :class="{ running: selectedTaskRunning }" aria-hidden="true" />
          {{ selectedTaskStatusLabel }}
        </span>
      </header>

      <section v-if="selectedTask" class="terminal-section" :aria-label="`${headerText} terminal`">
        <TerminalView
          ref="terminalRef"
          :task-id="selectedTask?.id ?? ''"
          :buffer="selectedTaskBuffer"
          @input="onTerminalInput"
          @resize="onTerminalResize"
        />
      </section>

      <section v-else class="workspace-empty" aria-labelledby="empty-workspace-title">
        <div class="empty-illustration" aria-hidden="true">›_</div>
        <h2 id="empty-workspace-title">No task selected</h2>
        <p>Add a task in project settings, then start it here to stream its terminal output.</p>
        <button
          v-if="selectedProjectId"
          type="button"
          class="primary"
          @click="onOpenProjectSettings(selectedProjectId)"
        >
          Open project settings
        </button>
      </section>

      <footer class="bottom-bar">
        <Toolbar
          :disabled="!selectedTask"
          :running="selectedTaskRunning"
          @focus="onFocus"
          @clear="onClear"
          @start="onStartSelected"
          @stop="onStop"
          @restart="onRestart"
        />

        <div v-if="selectedTask" class="bottom-status" role="group" aria-label="Selected task resource usage">
          <span>{{ selectedTask.name }}</span>
          <span title="CPU usage">CPU {{ selectedTaskStats.cpu.toFixed(1) }}%</span>
          <span title="Memory usage">MEM {{ selectedTaskStats.memoryMb.toFixed(0) }} MB</span>
        </div>
      </footer>
    </main>
  </div>

  <main v-else-if="loading" class="loading" aria-live="polite">
    <span class="loading-spinner" aria-hidden="true" />
    <span>Loading workspace…</span>
  </main>

  <main v-else class="fatal-state">
    <div class="empty-illustration" aria-hidden="true">!</div>
    <h1>Exedeck couldn’t open the workspace</h1>
    <p>{{ loadError }}</p>
    <button type="button" class="primary" @click="initialize">Try again</button>
  </main>

  <div v-if="lastError && config" class="error-toast" role="alert">
    <span>{{ lastError }}</span>
    <button type="button" aria-label="Dismiss error" @click="clearError">×</button>
  </div>

  <OnboardingWizard v-if="config && onboardingRequired" @complete="onOnboardingComplete" />

  <SettingsModal
    v-if="settingsOpen && config"
    :config="config"
    :selected-project-id="settingsProjectId || selectedProjectId"
    @close="onCloseSettings"
    @save="onSaveSettings"
    @create-project="onCreateProjectFromSettings"
  />

  <NewProjectWizard
    v-if="newProjectOpen"
    @close="onCloseNewProject"
    @created="onProjectCreated"
  />
</template>
