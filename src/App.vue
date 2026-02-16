<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
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
  clearTaskBuffer,
} = useStore()

const terminalRef = ref<InstanceType<typeof TerminalView> | null>(null)
const settingsOpen = ref(false)
const settingsProjectId = ref('')

const headerText = computed(() => {
  if (!project.value || !selectedTask.value) {
    return 'Exedeck'
  }

  return `${project.value.name} - ${selectedTask.value.name}`
})

const selectedTaskStatusLabel = computed(() => (selectedTaskRunning.value ? 'Running' : 'Stopped'))

onMounted(async () => {
  await loadConfig()
})

const onTerminalInput = async (data: string): Promise<void> => {
  if (!selectedTask.value) {
    return
  }

  await inputTask(selectedTask.value.id, data)
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

const onSelectTask = (projectId: string, taskId: string): void => {
  setSelectedProjectId(projectId)
  setSelectedTaskId(taskId)
}

const onCloseSettings = (): void => {
  settingsOpen.value = false
  settingsProjectId.value = ''
}

const onSaveSettings = async (nextConfig: AppConfig, nextProjectId: string): Promise<void> => {
  await saveConfig(nextConfig)
  setSelectedProjectId(nextProjectId)
  settingsOpen.value = false
  settingsProjectId.value = ''
}

const onOnboardingComplete = async (nextConfig: AppConfig): Promise<void> => {
  await saveConfig(nextConfig)
  setSelectedProjectId(nextConfig.projects[0]?.id ?? '')
}
</script>

<template>
  <div class="layout" v-if="config">
    <Sidebar
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
    />

    <main class="main-panel">
      <header class="panel-header">
        <h1>{{ headerText }}</h1>
        <span class="running-pill" :class="{ active: selectedTaskRunning }">{{ selectedTaskStatusLabel }}</span>
      </header>

      <section class="terminal-section">
        <TerminalView
          ref="terminalRef"
          :task-id="selectedTask?.id ?? ''"
          :buffer="selectedTaskBuffer"
          @input="onTerminalInput"
        />
      </section>

      <footer class="bottom-bar">
        <Toolbar
          :disabled="!selectedTask"
          @focus="onFocus"
          @clear="onClear"
          @stop="onStop"
          @restart="onRestart"
        />

        <div v-if="selectedTask" class="bottom-status">
          <span class="status-dot" :class="{ running: selectedTaskRunning }" />
          <span>{{ selectedTask.name }}</span>
          <span>{{ selectedTaskStats.cpu.toFixed(1) }}%</span>
          <span>{{ selectedTaskStats.memoryMb.toFixed(0) }} MB</span>
        </div>
      </footer>
    </main>
  </div>

  <main v-else class="loading">Loading...</main>

  <OnboardingWizard v-if="config && onboardingRequired" @complete="onOnboardingComplete" />

  <SettingsModal
    v-if="settingsOpen && config"
    :config="config"
    :selected-project-id="settingsProjectId || selectedProjectId"
    @close="onCloseSettings"
    @save="onSaveSettings"
  />
</template>
