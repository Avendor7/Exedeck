<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { AppConfig, Checkout, ExternalOpenTarget } from '../shared/types'
import { useStore } from './state/store'
import { parseArgs } from './utils/commandArgs'
import AgentWorkspace from './components/AgentWorkspace.vue'
import AppIcon from './components/AppIcon.vue'
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
  selectedItemKind,
  selectedItemId,
  selectedAgent,
  selectedProcess,
  selectedTaskBuffer,
  selectedTaskRuntime,
  selectedTaskStats,
  selectedAgentBuffer,
  selectedAgentRuntime,
} = store

const sidebarRef = ref<InstanceType<typeof Sidebar> | null>(null)
const agentRef = ref<InstanceType<typeof AgentWorkspace> | null>(null)
const terminalRef = ref<InstanceType<typeof TerminalView> | null>(null)
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
const itemModal = ref<'agent' | 'terminal' | null>(null)
const itemWorkspaceId = ref('')
const itemName = ref('')
const itemProfileId = ref('')
const itemCommand = ref('')

const profile = computed(() => config.value?.agentProfiles.find((item) => item.id === selectedAgent.value?.profileId))
const agentRunning = computed(() => ['starting', 'running'].includes(selectedAgentRuntime.value.state))
const workspaceAgentRunning = computed(() =>
  Boolean(
    workspace.value?.agents.some((agent) => ['starting', 'running'].includes(store.getAgentRuntime(agent.id).state)),
  ),
)

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
    if (selectedItemKind.value === 'agent') agentRef.value?.focusTerminal()
    else terminalRef.value?.focusTerminal()
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
  } else lastError.value = 'Stop all workspace items before rebinding the checkout.'
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

function openItemModal(kind: 'agent' | 'terminal', workspaceId: string): void {
  itemModal.value = kind
  itemWorkspaceId.value = workspaceId
  itemName.value = kind === 'agent' ? 'Codex' : 'Terminal'
  itemProfileId.value = config.value?.agentProfiles.find((item) => item.enabled)?.id ?? ''
  itemCommand.value = ''
}

async function addWorkspaceItem(): Promise<void> {
  const kind = itemModal.value
  if (!config.value || !kind) return
  const target = config.value.workspaces.find((item) => item.id === itemWorkspaceId.value)
  if (!target) return
  const id = `${kind}-${crypto.randomUUID()}`
  const nextWorkspace =
    kind === 'agent'
      ? {
          ...target,
          agents: [
            ...target.agents,
            { id, profileId: itemProfileId.value, name: itemName.value.trim() || 'Agent', createdAt: Date.now() },
          ],
        }
      : {
          ...target,
          terminals: [
            ...target.terminals,
            {
              id,
              name: itemName.value.trim() || 'Terminal',
              command: parseArgs(itemCommand.value)[0] ?? '',
              args: parseArgs(itemCommand.value).slice(1),
              createdAt: Date.now(),
            },
          ],
        }
  await store.saveConfig({
    ...config.value,
    workspaces: config.value.workspaces.map((item) => (item.id === target.id ? nextWorkspace : item)),
  })
  await store.activateWorkspace(target.id)
  await store.selectWorkspaceItem(kind, id)
  if (kind === 'terminal') await store.startTask(id)
  itemModal.value = null
}

async function removeItem(kind: 'agent' | 'terminal', id: string): Promise<void> {
  if (!config.value) return
  if (kind === 'agent') await window.exedeck.agents.stop(id)
  else await window.exedeck.processes.stop(id)
  await store.saveConfig({
    ...config.value,
    workspaces: config.value.workspaces.map((item) => ({
      ...item,
      agents: kind === 'agent' ? item.agents.filter((agent) => agent.id !== id) : item.agents,
      terminals: kind === 'terminal' ? item.terminals.filter((terminal) => terminal.id !== id) : item.terminals,
    })),
  })
}

async function selectItem(kind: 'git' | 'agent' | 'terminal' | 'task', id: string): Promise<void> {
  await store.selectWorkspaceItem(kind, id)
}

function clearProcess(): void {
  if (!selectedProcess.value) return
  void store.clearTaskBuffer(selectedProcess.value.id)
  terminalRef.value?.clearTerminal()
}

async function openGitWorkspace(): Promise<void> {
  if (!workspace.value) return
  await store.selectWorkspaceItem('git', workspace.value.id)
}
</script>

<template>
  <div v-if="config" class="app-shell workspace-first-shell">
    <AppMenuBar
      :project-name="project?.name ?? ''"
      :has-project="Boolean(project)"
      :has-agent="Boolean(selectedAgent)"
      :can-finish-workspace="workspace?.kind === 'worktree'"
      :agent-running="agentRunning"
      :git-active="selectedItemKind === 'git'"
      @new-project="newProjectOpen = true"
      @clone-project="cloneOpen = true"
      @new-workspace="project && (createWorkspaceOpen = true)"
      @finish-workspace="workspace?.kind === 'worktree' && (finishWorkspaceOpen = true)"
      @settings="project && openProjectSettings(project.id)"
      @start-agent="store.startAgent()"
      @stop-agent="store.stopAgent()"
      @toggle-git="openGitWorkspace"
      @open-project="openExternal"
    />
    <div class="layout">
      <Sidebar
        ref="sidebarRef"
        :projects="projects"
        :workspaces="config.workspaces"
        :selected-project-id="selectedProjectId"
        :selected-workspace-id="selectedWorkspaceId"
        :selected-item-kind="selectedItemKind"
        :selected-item-id="selectedItemId"
        :filter-text="filterText"
        :get-agent-runtime="store.getAgentRuntime"
        :get-task-runtime="store.getTaskRuntime"
        @select-project="store.selectProject"
        @select-workspace="store.activateWorkspace"
        @select-item="selectItem"
        @update-filter="filterText = $event"
        @open-project-settings="openProjectSettings"
        @create-workspace="createWorkspaceOpen = true"
        @create-agent="openItemModal('agent', $event)"
        @create-terminal="openItemModal('terminal', $event)"
        @remove-workspace="store.activateWorkspace($event).then(() => (finishWorkspaceOpen = true))"
        @remove-item="removeItem"
        @create-project="newProjectOpen = true"
        @clone-project="cloneOpen = true"
      />

      <main class="main-panel workbench-main">
        <template v-if="workspace && project">
          <div v-if="selectedItemKind === 'agent' && selectedAgent" class="workbench-row">
            <AgentWorkspace
              ref="agentRef"
              :workspace="workspace"
              :agent="selectedAgent"
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
              @finish="workspace.kind === 'worktree' && (finishWorkspaceOpen = true)"
              @rebind="openRebind"
            />
          </div>

          <div v-else-if="selectedProcess" class="workbench-row">
            <section class="agent-surface process-surface">
              <header class="agent-surface-header">
                <div>
                  <span class="panel-eyebrow">{{ selectedItemKind }}</span>
                  <h1>{{ selectedProcess.name }}</h1>
                  <p>{{ checkout?.branch ?? 'Checkout missing' }} · {{ checkout?.path ?? workspace.checkoutId }}</p>
                </div>
                <div class="button-row">
                  <span class="running-pill" :class="{ active: selectedTaskRuntime.running }">{{
                    selectedTaskRuntime.running ? 'running' : 'stopped'
                  }}</span>
                  <button class="small" @click="clearProcess"><AppIcon name="eraser" />Clear</button>
                  <button
                    v-if="selectedTaskRuntime.running"
                    class="small"
                    @click="store.restartTask(selectedProcess.id)"
                  >
                    <AppIcon name="refresh" />Restart
                  </button>
                  <button
                    v-if="selectedTaskRuntime.running"
                    class="small danger"
                    @click="store.stopTask(selectedProcess.id)"
                  >
                    <AppIcon name="square" />Stop
                  </button>
                  <button
                    v-else
                    class="small primary"
                    :disabled="!checkout"
                    @click="store.startTask(selectedProcess.id)"
                  >
                    <AppIcon name="play" />Start
                  </button>
                </div>
              </header>
              <div class="agent-terminal">
                <TerminalView
                  ref="terminalRef"
                  :task-id="selectedProcess.id"
                  :buffer="selectedTaskBuffer"
                  @input="store.inputTask(selectedProcess.id, $event)"
                  @resize="store.resizeTask(selectedProcess.id, $event.cols, $event.rows)"
                />
              </div>
              <footer class="process-status">
                CPU {{ selectedTaskStats.cpu.toFixed(1) }}% · MEM {{ selectedTaskStats.memoryMb.toFixed(0) }} MB
              </footer>
            </section>
          </div>

          <GitWorkspace
            v-else-if="selectedItemKind === 'git' && checkout"
            :project="project"
            :config="config"
            :active-checkout-id="checkout.id"
            :agent-running="workspaceAgentRunning"
            @save-config="store.saveConfig"
          />

          <section v-else class="project-landing workspace-landing">
            <span class="panel-eyebrow">{{ workspace.kind === 'root' ? 'Root workspace' : 'Worktree workspace' }}</span>
            <h1>{{ workspace.name }}</h1>
            <p>{{ checkout?.branch ?? 'Checkout unavailable' }} · {{ checkout?.path ?? workspace.checkoutId }}</p>
            <div class="landing-primary">
              <button class="primary" @click="openItemModal('agent', workspace.id)">
                <AppIcon name="bot" />Add agent
              </button>
              <button @click="openItemModal('terminal', workspace.id)"><AppIcon name="terminal" />Add terminal</button>
              <button v-if="workspace.kind === 'worktree'" class="danger" @click="finishWorkspaceOpen = true">
                <AppIcon name="trash" />Remove workspace…
              </button>
            </div>
            <div class="workspace-summary-grid">
              <button v-for="agent in workspace.agents" :key="agent.id" @click="selectItem('agent', agent.id)">
                <span class="action-card-icon"><AppIcon name="bot" /></span>
                <span class="action-card-copy"
                  ><strong>{{ agent.name }}</strong
                  ><span>Agent · {{ store.getAgentRuntime(agent.id).state }}</span></span
                >
              </button>
              <button
                v-for="terminal in workspace.terminals"
                :key="terminal.id"
                @click="selectItem('terminal', terminal.id)"
              >
                <span class="action-card-icon"><AppIcon name="terminal" /></span>
                <span class="action-card-copy"
                  ><strong>{{ terminal.name }}</strong
                  ><span>Terminal · {{ store.getTaskRuntime(terminal.id).running ? 'running' : 'stopped' }}</span></span
                >
              </button>
              <button v-for="task in project.tasks" :key="task.id" @click="selectItem('task', task.id)">
                <span class="action-card-icon"><AppIcon name="play" /></span>
                <span class="action-card-copy"
                  ><strong>{{ task.name }}</strong
                  ><span>Project task · {{ store.getTaskRuntime(task.id).running ? 'running' : 'stopped' }}</span></span
                >
              </button>
            </div>
          </section>
        </template>

        <section v-else-if="project" class="project-landing">
          <span class="panel-eyebrow">{{ project.framework === 'custom' ? 'Project' : project.framework }}</span>
          <h1>{{ project.name }}</h1>
          <p>{{ project.path }}</p>
          <div class="landing-primary">
            <button class="primary" @click="createWorkspaceOpen = true">
              <AppIcon name="plus" />New worktree workspace
            </button>
          </div>
          <div class="landing-actions">
            <button @click="openExternal('editor')">
              <span class="action-card-icon"><AppIcon name="code" /></span>
              <span class="action-card-copy"
                ><strong>Open in editor</strong><span>Continue in your configured editor</span></span
              >
            </button>
            <button @click="openExternal('terminal')">
              <span class="action-card-icon"><AppIcon name="terminal" /></span>
              <span class="action-card-copy"><strong>Open terminal</strong><span>Shell at the project root</span></span>
            </button>
            <button @click="openExternal('files')">
              <span class="action-card-icon"><AppIcon name="folder" /></span>
              <span class="action-card-copy"><strong>Show files</strong><span>Open the system file manager</span></span>
            </button>
          </div>
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
    <AppIcon name="alert" />
    <span>{{ lastError }}</span
    ><button class="icon-button" aria-label="Dismiss error" @click="store.clearError"><AppIcon name="x" /></button>
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
    v-if="createWorkspaceOpen && project"
    :project="project"
    @close="createWorkspaceOpen = false"
    @created="onWorkspaceCreated"
  />
  <WorkspaceFinishModal
    v-if="finishWorkspaceOpen && workspace?.kind === 'worktree'"
    :workspace="workspace"
    @close="finishWorkspaceOpen = false"
    @finished="onWorkspaceFinished"
  />

  <div v-if="itemModal && config" class="modal-overlay">
    <section class="workspace-rebind-modal" role="dialog" aria-modal="true">
      <header class="modal-header">
        <div>
          <span class="modal-eyebrow">Workspace item</span>
          <h2>Add {{ itemModal }}</h2>
        </div>
      </header>
      <label><span>Name</span><input v-model="itemName" type="text" autofocus /></label>
      <label v-if="itemModal === 'agent'"
        ><span>CLI tool</span
        ><select v-model="itemProfileId">
          <option
            v-for="item in config.agentProfiles.filter((profile) => profile.enabled)"
            :key="item.id"
            :value="item.id"
          >
            {{ item.name }} ({{ item.command }})
          </option>
        </select></label
      >
      <label v-else
        ><span>Command (optional)</span><input v-model="itemCommand" type="text" placeholder="npm run dev" /><small
          >Leave empty for an interactive shell.</small
        ></label
      >
      <footer class="modal-actions">
        <button @click="itemModal = null">Cancel</button
        ><button
          class="primary"
          :disabled="!itemName.trim() || (itemModal === 'agent' && !itemProfileId)"
          @click="addWorkspaceItem"
        >
          <AppIcon name="plus" />Add {{ itemModal }}
        </button>
      </footer>
    </section>
  </div>

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
        ><button class="primary" :disabled="!rebindCheckoutId" @click="rebind">
          <AppIcon name="git-branch" />Rebind
        </button>
      </footer>
    </section>
  </div>
</template>
