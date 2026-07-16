<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { AppConfig, Checkout, ExternalOpenTarget } from '../shared/types'
import { useStore } from './state/store'
import AgentWorkspace from './components/AgentWorkspace.vue'
import AppMenuBar from './components/AppMenuBar.vue'
import CloneRepositoryModal from './components/CloneRepositoryModal.vue'
import GitWorkspace from './components/GitWorkspace.vue'
import NewProjectWizard from './components/NewProjectWizard.vue'
import OnboardingWizard from './components/OnboardingWizard.vue'
import SettingsModal from './components/SettingsModal.vue'
import Sidebar from './components/Sidebar.vue'
import TerminalView from './components/TerminalView.vue'
import WorkspaceCreateModal from './components/WorkspaceCreateModal.vue'
import WorkspaceFinishModal from './components/WorkspaceFinishModal.vue'

const store = useStore()
const {
  config,
  projects,
  project,
  workspace,
  onboardingRequired,
  filterText,
  lastError,
  selectedProjectId,
  selectedWorkspaceId,
  selectedTask,
  selectedTaskBuffer,
  selectedTaskRuntime,
  selectedTaskStats,
  selectedAgentBuffer,
  selectedAgentRuntime,
} = store

const sidebarRef = ref<InstanceType<typeof Sidebar> | null>(null)
const agentRef = ref<InstanceType<typeof AgentWorkspace> | null>(null)
const taskTerminalRef = ref<InstanceType<typeof TerminalView> | null>(null)
const loading = ref(true)
const loadError = ref('')
const settingsOpen = ref(false)
const settingsProjectId = ref('')
const newProjectOpen = ref(false)
const cloneOpen = ref(false)
const createWorkspaceOpen = ref(false)
const finishWorkspaceOpen = ref(false)
const rebindOpen = ref(false)
const rebindCheckoutId = ref('')
const checkout = ref<Checkout | null>(null)
const projectCheckouts = ref<Checkout[]>([])
const gitOpen = ref(true)
const taskPanelOpen = ref(true)
const taskPanelExpanded = ref(false)

const profile = computed(() => config.value?.agentProfiles.find((item) => item.id === workspace.value?.profileId))
const agentRunning = computed(() => ['starting', 'running'].includes(selectedAgentRuntime.value.state))

watch(
  () => config.value?.preferences.appearance,
  (appearance) => {
    if (!appearance || appearance === 'system') document.documentElement.removeAttribute('data-theme')
    else document.documentElement.dataset.theme = appearance
  },
  { immediate: true },
)

watch(
  () => workspace.value?.checkoutId,
  async () => {
    checkout.value = null
    projectCheckouts.value = []
    if (!workspace.value) return
    projectCheckouts.value = await window.exedeck.git.listCheckouts(workspace.value.projectId)
    checkout.value = projectCheckouts.value.find((item) => item.id === workspace.value?.checkoutId) ?? null
  },
  { immediate: true },
)

async function initialize(): Promise<void> {
  loading.value = true
  loadError.value = ''
  try {
    await store.loadConfig()
  } catch (error) {
    loadError.value = error instanceof Error ? error.message : 'Exedeck could not load its configuration.'
  } finally {
    loading.value = false
  }
}

function onKeydown(event: KeyboardEvent): void {
  const modifier = event.ctrlKey || event.metaKey
  if (modifier && event.key.toLowerCase() === 'f') {
    event.preventDefault()
    sidebarRef.value?.focusSearch()
  }
  if ((event.ctrlKey && event.key === '`') || event.key === 'F6') {
    event.preventDefault()
    if (taskPanelExpanded.value) taskTerminalRef.value?.focusTerminal()
    else agentRef.value?.focusTerminal()
  }
}
onMounted(() => {
  window.addEventListener('keydown', onKeydown)
  void initialize()
})
onBeforeUnmount(() => window.removeEventListener('keydown', onKeydown))

async function onWorkspaceCreated(workspaceId: string): Promise<void> {
  createWorkspaceOpen.value = false
  await store.loadConfig()
  await store.activateWorkspace(workspaceId)
}

async function onWorkspaceFinished(): Promise<void> {
  finishWorkspaceOpen.value = false
  await store.loadConfig()
}

async function rebind(): Promise<void> {
  if (!workspace.value || !rebindCheckoutId.value) return
  const rebound = await window.exedeck.workspaces.rebind({
    workspaceId: workspace.value.id,
    checkoutId: rebindCheckoutId.value,
  })
  if (rebound) {
    rebindOpen.value = false
    await store.loadConfig()
    await store.activateWorkspace(rebound.id)
  } else lastError.value = 'The workspace could not be rebound to that checkout.'
}

async function openExternal(target: ExternalOpenTarget): Promise<void> {
  if (!project.value) return
  const ok = checkout.value
    ? await window.exedeck.git.openExternal(checkout.value.id, target)
    : await window.exedeck.projects.openExternal(project.value.id, target)
  if (!ok) lastError.value = `Exedeck could not open this project in ${target}.`
}

function openProjectSettings(projectId: string): void {
  settingsProjectId.value = projectId
  settingsOpen.value = true
}

function openRebind(): void {
  rebindCheckoutId.value = projectCheckouts.value[0]?.id ?? ''
  rebindOpen.value = true
}

function clearSelectedTask(): void {
  if (!selectedTask.value) return
  void store.clearTaskBuffer(selectedTask.value.id)
  taskTerminalRef.value?.clearTerminal()
}

function createProjectFromSettings(): void {
  settingsOpen.value = false
  newProjectOpen.value = true
}

async function saveSettings(next: AppConfig, nextProjectId: string): Promise<void> {
  await store.saveConfig(next)
  settingsOpen.value = false
  settingsProjectId.value = ''
  store.selectProject(nextProjectId)
}

async function onboardingComplete(next: AppConfig): Promise<void> {
  await store.saveConfig(next)
  store.selectProject(next.projects.at(-1)?.id ?? '')
}
async function projectCreated(projectId: string): Promise<void> {
  await store.loadConfig()
  store.selectProject(projectId)
  newProjectOpen.value = false
}
async function projectCloned(projectId: string): Promise<void> {
  await store.loadConfig()
  store.selectProject(projectId)
  cloneOpen.value = false
}
</script>

<template>
  <div v-if="config" class="app-shell workspace-first-shell">
    <AppMenuBar
      :project-name="project?.name ?? ''"
      :has-project="Boolean(project)"
      :has-workspace="Boolean(workspace)"
      :agent-running="agentRunning"
      :git-open="gitOpen"
      :task-panel-open="taskPanelOpen"
      @new-project="newProjectOpen = true"
      @clone-project="cloneOpen = true"
      @new-workspace="project && (createWorkspaceOpen = true)"
      @finish-workspace="workspace && (finishWorkspaceOpen = true)"
      @settings="project && openProjectSettings(project.id)"
      @start-agent="store.startAgent()"
      @stop-agent="store.stopAgent()"
      @toggle-git="gitOpen = !gitOpen"
      @toggle-tasks="taskPanelOpen = !taskPanelOpen"
      @open-project="openExternal"
    />
    <div class="layout">
      <Sidebar
        ref="sidebarRef"
        :projects="projects"
        :workspaces="config.agentWorkspaces"
        :selected-project-id="selectedProjectId"
        :selected-workspace-id="selectedWorkspaceId"
        :filter-text="filterText"
        :get-agent-runtime="store.getAgentRuntime"
        @select-project="store.selectProject"
        @select-workspace="store.activateWorkspace"
        @update-filter="filterText = $event"
        @open-project-settings="openProjectSettings"
        @create-workspace="createWorkspaceOpen = true"
        @create-project="newProjectOpen = true"
        @clone-project="cloneOpen = true"
      />

      <main class="main-panel workbench-main">
        <template v-if="workspace && project">
          <div class="workbench-row">
            <AgentWorkspace
              ref="agentRef"
              :workspace="workspace"
              :profile="profile"
              :checkout="checkout"
              :runtime="selectedAgentRuntime"
              :buffer="selectedAgentBuffer"
              @start="store.startAgent"
              @stop="store.stopAgent"
              @restart="store.restartAgent"
              @input="store.inputAgent"
              @resize="store.resizeAgent($event.cols, $event.rows)"
              @clear="store.clearAgentBuffer"
              @finish="finishWorkspaceOpen = true"
              @rebind="openRebind"
            >
              <template #task-panel>
                <section v-if="taskPanelOpen" class="task-panel" :class="{ expanded: taskPanelExpanded }">
                  <header class="task-panel-header" @click="taskPanelExpanded = !taskPanelExpanded">
                    <div>
                      <strong>Tasks</strong
                      ><span
                        >{{ project.tasks.length }} definitions · {{ checkout?.branch ?? 'checkout missing' }}</span
                      >
                    </div>
                    <div class="task-tabs" @click.stop>
                      <button
                        v-for="task in project.tasks"
                        :key="task.id"
                        :class="{ active: selectedTask?.id === task.id }"
                        @click="store.selectTask(task.id)"
                      >
                        <span class="status-dot" :class="{ running: store.getTaskRuntime(task.id).running }" />{{
                          task.name
                        }}
                      </button>
                    </div>
                    <button
                      type="button"
                      class="icon-button"
                      :aria-label="taskPanelExpanded ? 'Collapse task panel' : 'Expand task panel'"
                    >
                      {{ taskPanelExpanded ? '⌄' : '⌃' }}
                    </button>
                  </header>
                  <div v-if="taskPanelExpanded && selectedTask" class="task-panel-body">
                    <TerminalView
                      ref="taskTerminalRef"
                      :task-id="selectedTask.id"
                      :buffer="selectedTaskBuffer"
                      @input="store.inputTask(selectedTask.id, $event)"
                      @resize="store.resizeTask(selectedTask.id, $event.cols, $event.rows)"
                    />
                    <div class="task-panel-controls">
                      <span
                        v-if="
                          selectedTaskRuntime.running &&
                          selectedTaskRuntime.checkoutId &&
                          selectedTaskRuntime.checkoutId !== workspace.checkoutId
                        "
                        >Running in {{ selectedTaskRuntime.checkoutId }}</span
                      >
                      <span
                        >CPU {{ selectedTaskStats.cpu.toFixed(1) }}% · MEM
                        {{ selectedTaskStats.memoryMb.toFixed(0) }} MB</span
                      >
                      <button
                        v-if="!selectedTaskRuntime.running"
                        :disabled="!checkout"
                        @click="store.startTask(selectedTask.id)"
                      >
                        Start
                      </button>
                      <button v-else @click="store.stopTask(selectedTask.id)">Stop</button>
                      <button @click="store.restartTask(selectedTask.id)">Restart</button>
                      <button @click="clearSelectedTask">Clear</button>
                    </div>
                  </div>
                </section>
              </template>
            </AgentWorkspace>
            <aside v-if="gitOpen && checkout" class="git-inspector" aria-label="Git inspector">
              <GitWorkspace
                :project="project"
                :config="config"
                :active-checkout-id="checkout.id"
                :agent-running="agentRunning"
                @save-config="store.saveConfig"
              />
            </aside>
          </div>
        </template>

        <section v-else-if="project" class="project-landing">
          <span class="panel-eyebrow">{{ project.framework === 'custom' ? 'Project' : project.framework }}</span>
          <h1>{{ project.name }}</h1>
          <p>{{ project.path }}</p>
          <div class="landing-primary">
            <button class="primary" @click="createWorkspaceOpen = true">New agent workspace</button>
          </div>
          <div class="landing-actions">
            <button @click="openExternal('editor')">
              <strong>Open in editor</strong><span>Continue in your configured editor</span>
            </button>
            <button @click="openExternal('terminal')">
              <strong>Open terminal</strong><span>Shell at the project root</span>
            </button>
            <button @click="openExternal('files')">
              <strong>Show files</strong><span>Open the system file manager</span>
            </button>
            <button @click="cloneOpen = true"><strong>Clone repository</strong><span>Add another project</span></button>
            <button @click="newProjectOpen = true">
              <strong>New application</strong><span>Laravel or AdonisJS scaffolding</span>
            </button>
          </div>
          <section v-if="project.tasks.length" class="landing-tasks">
            <div class="task-editor-head">
              <div>
                <h2>Project tasks</h2>
                <p>Without an active agent workspace, these run at the project root.</p>
              </div>
              <div class="task-tabs">
                <button
                  v-for="task in project.tasks"
                  :key="task.id"
                  :class="{ active: selectedTask?.id === task.id }"
                  @click="store.selectTask(task.id)"
                >
                  <span class="status-dot" :class="{ running: store.getTaskRuntime(task.id).running }" />
                  {{ task.name }}
                </button>
              </div>
            </div>
            <div v-if="selectedTask" class="landing-task-console">
              <TerminalView
                :task-id="selectedTask.id"
                :buffer="selectedTaskBuffer"
                @input="store.inputTask(selectedTask.id, $event)"
                @resize="store.resizeTask(selectedTask.id, $event.cols, $event.rows)"
              />
              <div class="task-panel-controls">
                <span
                  >CPU {{ selectedTaskStats.cpu.toFixed(1) }}% · MEM
                  {{ selectedTaskStats.memoryMb.toFixed(0) }} MB</span
                >
                <button v-if="!selectedTaskRuntime.running" @click="store.startTask(selectedTask.id)">Start</button>
                <button v-else @click="store.stopTask(selectedTask.id)">Stop</button>
                <button @click="store.restartTask(selectedTask.id)">Restart</button>
              </div>
            </div>
          </section>
        </section>
        <section v-else class="project-landing">
          <h1>Choose a project</h1>
          <p>Open a folder, clone a repository, or scaffold a new application.</p>
        </section>
      </main>
    </div>
  </div>

  <main v-else-if="loading" class="loading"><span class="loading-spinner" />Loading workspaces…</main>
  <main v-else class="fatal-state">
    <h1>Exedeck couldn’t open</h1>
    <p>{{ loadError }}</p>
    <button class="primary" @click="initialize">Try again</button>
  </main>
  <div v-if="lastError && config" class="error-toast" role="alert">
    <span>{{ lastError }}</span
    ><button @click="store.clearError">×</button>
  </div>

  <OnboardingWizard
    v-if="config && onboardingRequired"
    :config="config"
    @complete="onboardingComplete"
    @clone="cloneOpen = true"
  />
  <SettingsModal
    v-if="settingsOpen && config"
    :config="config"
    :selected-project-id="settingsProjectId || selectedProjectId"
    @close="settingsOpen = false"
    @save="saveSettings"
    @create-project="createProjectFromSettings"
  />
  <NewProjectWizard v-if="newProjectOpen" @close="newProjectOpen = false" @created="projectCreated" />
  <CloneRepositoryModal
    v-if="cloneOpen && config"
    :preferences="config.preferences"
    @close="cloneOpen = false"
    @cloned="projectCloned"
  />
  <WorkspaceCreateModal
    v-if="createWorkspaceOpen && config && project"
    :config="config"
    :project="project"
    @close="createWorkspaceOpen = false"
    @created="onWorkspaceCreated"
  />
  <WorkspaceFinishModal
    v-if="finishWorkspaceOpen && workspace"
    :workspace="workspace"
    @close="finishWorkspaceOpen = false"
    @finished="onWorkspaceFinished"
  />
  <div v-if="rebindOpen && workspace" class="modal-overlay">
    <section class="workspace-rebind-modal" role="dialog" aria-modal="true">
      <header class="modal-header">
        <div>
          <span class="modal-eyebrow">Recover workspace</span>
          <h2>Rebind checkout</h2>
        </div>
      </header>
      <label
        ><span>Available checkout</span
        ><select v-model="rebindCheckoutId">
          <option v-for="item in projectCheckouts" :key="item.id" :value="item.id">
            {{ item.branch }} — {{ item.path }}
          </option>
        </select></label
      >
      <footer class="modal-actions">
        <button @click="rebindOpen = false">Cancel</button
        ><button class="primary" :disabled="!rebindCheckoutId" @click="rebind">Rebind</button>
      </footer>
    </section>
  </div>
</template>
