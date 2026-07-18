<script setup lang="ts">
import { computed, nextTick, ref } from 'vue'
import type { AppConfig, ProjectConfig, TaskConfig } from '../../shared/types'
import { createId, formatArgs, parseArgs } from '../utils/commandArgs'
import AppIcon from './AppIcon.vue'
import UiButton from './ui/UiButton.vue'
import UiCard from './ui/UiCard.vue'
import UiDialog from './ui/UiDialog.vue'

interface DraftTask {
  id: string
  name: string
  command: string
  argsText: string
  autoStart: boolean
}

interface DraftProject {
  id: string
  name: string
  path: string
  framework: ProjectConfig['framework']
  autoStart: boolean
  tasks: DraftTask[]
  branchParents: Record<string, string>
}

interface DraftConfig {
  schemaVersion: number
  onboardingCompleted: boolean
  projects: DraftProject[]
  preferences: AppConfig['preferences']
  agentProfiles: AppConfig['agentProfiles']
  workspaces: AppConfig['workspaces']
}

const props = defineProps<{
  config: AppConfig
  selectedProjectId: string
}>()

const emit = defineEmits<{
  close: []
  save: [config: AppConfig, selectedProjectId: string]
  createProject: []
}>()

function toDraftTask(task: TaskConfig): DraftTask {
  return {
    id: task.id,
    name: task.name,
    command: task.command,
    argsText: formatArgs(task.args),
    autoStart: task.autoStart,
  }
}

function toDraftProject(project: ProjectConfig): DraftProject {
  return {
    id: project.id,
    name: project.name,
    path: project.path,
    framework: project.framework ?? 'custom',
    autoStart: project.autoStart,
    tasks: project.tasks.map(toDraftTask),
    branchParents: { ...project.branchParents },
  }
}

function toDraftConfig(config: AppConfig): DraftConfig {
  return {
    schemaVersion: config.schemaVersion,
    onboardingCompleted: config.onboardingCompleted,
    projects: config.projects.map(toDraftProject),
    preferences: { ...config.preferences },
    agentProfiles: config.agentProfiles.map((profile) => ({ ...profile, args: [...profile.args] })),
    workspaces: config.workspaces.map((workspace) => ({
      ...workspace,
      agents: workspace.agents.map((agent) => ({ ...agent })),
      terminals: workspace.terminals.map((terminal) => ({ ...terminal, args: [...terminal.args] })),
    })),
  }
}

const draft = ref<DraftConfig>(toDraftConfig(props.config))
const editingProjectId = ref<string>(props.selectedProjectId || draft.value.projects[0]?.id || '')
const pendingProjectRemovalId = ref<string | null>(null)
const confirmCancelRef = ref<HTMLButtonElement | null>(null)

const currentProject = computed<DraftProject | null>(
  () =>
    draft.value.projects.find((project) => project.id === editingProjectId.value) ?? draft.value.projects[0] ?? null,
)

const pendingProjectRemoval = computed<DraftProject | null>(() => {
  if (!pendingProjectRemovalId.value) {
    return null
  }

  return draft.value.projects.find((project) => project.id === pendingProjectRemovalId.value) ?? null
})

const canSave = computed(() => draft.value.projects.every((project) => project.path.trim()))

function createDraftTask(): DraftTask {
  return {
    id: createId('task'),
    name: 'New task',
    command: '',
    argsText: '',
    autoStart: false,
  }
}

function addProject(): void {
  const next: DraftProject = {
    id: createId('project'),
    name: `Project ${draft.value.projects.length + 1}`,
    path: '',
    framework: 'custom',
    autoStart: false,
    tasks: [createDraftTask()],
    branchParents: {},
  }

  draft.value.projects.push(next)
  editingProjectId.value = next.id
}

function removeProject(projectId: string): void {
  draft.value.projects = draft.value.projects.filter((project) => project.id !== projectId)

  if (!draft.value.projects.find((project) => project.id === editingProjectId.value)) {
    editingProjectId.value = draft.value.projects[0]?.id ?? ''
  }
}

function requestProjectRemoval(projectId: string): void {
  pendingProjectRemovalId.value = projectId
  void nextTick(() => confirmCancelRef.value?.focus())
}

function cancelProjectRemoval(): void {
  pendingProjectRemovalId.value = null
}

function confirmProjectRemoval(): void {
  if (!pendingProjectRemovalId.value) {
    return
  }

  removeProject(pendingProjectRemovalId.value)
  pendingProjectRemovalId.value = null
}

function addTask(): void {
  if (!currentProject.value) {
    return
  }

  currentProject.value.tasks.push(createDraftTask())
}

function addAgentProfile(): void {
  draft.value.agentProfiles.push({
    id: createId('agent-profile'),
    name: 'Custom agent',
    tool: 'custom',
    command: '',
    args: [],
    enabled: true,
  })
}

function removeAgentProfile(profileId: string): void {
  if (draft.value.workspaces.some((workspace) => workspace.agents.some((agent) => agent.profileId === profileId))) {
    return
  }
  draft.value.agentProfiles = draft.value.agentProfiles.filter((profile) => profile.id !== profileId)
  if (draft.value.preferences.aiProfileId === profileId) {
    draft.value.preferences.aiProfileId = draft.value.agentProfiles[0]?.id ?? ''
  }
}

function removeTask(taskId: string): void {
  if (!currentProject.value) {
    return
  }

  currentProject.value.tasks = currentProject.value.tasks.filter((task) => task.id !== taskId)
}

async function pickProjectPath(): Promise<void> {
  if (!currentProject.value) {
    return
  }

  const selectedPath = await window.exedeck.projects.pickDirectory(currentProject.value.path || '.')
  if (selectedPath) {
    currentProject.value.path = selectedPath
  }
}

function saveDraft(): void {
  const nextProjects: ProjectConfig[] = draft.value.projects.map((project) => ({
    id: project.id,
    name: project.name.trim() || 'Untitled project',
    path: project.path.trim() || '.',
    framework: project.framework ?? 'custom',
    autoStart: project.autoStart,
    tasks: project.tasks
      .filter((task) => task.command.trim())
      .map((task) => ({
        id: task.id,
        name: task.name.trim() || 'Task',
        command: task.command.trim(),
        args: parseArgs(task.argsText),
        cwd: project.path.trim() || '.',
        autoStart: task.autoStart,
      })),
    branchParents: { ...project.branchParents },
  }))

  const nextConfig: AppConfig = {
    schemaVersion: draft.value.schemaVersion,
    onboardingCompleted: nextProjects.length > 0,
    projects: nextProjects,
    preferences: { ...draft.value.preferences },
    agentProfiles: draft.value.agentProfiles.map((profile) => ({ ...profile, args: [...profile.args] })),
    workspaces: draft.value.workspaces.map((workspace) => ({
      ...workspace,
      agents: workspace.agents.map((agent) => ({ ...agent })),
      terminals: workspace.terminals.map((terminal) => ({ ...terminal, args: [...terminal.args] })),
    })),
  }

  const nextSelectedProjectId =
    (editingProjectId.value && nextProjects.find((project) => project.id === editingProjectId.value)?.id) ||
    nextProjects[0]?.id ||
    ''

  emit('save', nextConfig, nextSelectedProjectId)
}
</script>

<template>
  <UiDialog labelledby="settings-title" panel-class="settings-modal" @close="emit('close')">
    <header class="modal-header" :inert="Boolean(pendingProjectRemoval)">
      <div>
        <span class="modal-eyebrow">Workspace</span>
        <h2 id="settings-title">Project settings</h2>
      </div>
      <div class="modal-actions">
        <UiButton variant="primary" @click="emit('createProject')"> <AppIcon name="plus" />Create Project </UiButton>
        <UiButton
          v-if="currentProject"
          variant="danger"
          prominent
          class="subtle-danger"
          @click="requestProjectRemoval(currentProject.id)"
        >
          <AppIcon name="trash" />Delete Project
        </UiButton>
        <UiButton variant="secondary" @click="emit('close')">Cancel</UiButton>
        <UiButton variant="primary" :disabled="!canSave" @click="saveDraft"> <AppIcon name="check" />Save </UiButton>
      </div>
    </header>

    <div class="modal-body" :inert="Boolean(pendingProjectRemoval)">
      <aside class="settings-sidebar">
        <div class="settings-sidebar-head">
          <h3>Projects</h3>
          <button type="button" class="small" @click="addProject"><AppIcon name="plus" />Add</button>
        </div>

        <div class="settings-project-list">
          <button
            v-for="project in draft.projects"
            :key="project.id"
            type="button"
            class="settings-project-item"
            :class="{ active: project.id === editingProjectId }"
            @click="editingProjectId = project.id"
          >
            <span>{{ project.name || 'Untitled project' }}</span>
            <span class="pill">{{ project.tasks.length }} tasks</span>
          </button>
        </div>
      </aside>

      <section v-if="currentProject" class="settings-editor">
        <div class="task-editor-head">
          <h3>Application</h3>
        </div>
        <div class="form-grid settings-global-grid">
          <label>
            <span>Appearance</span>
            <select v-model="draft.preferences.appearance">
              <option value="system">System</option>
              <option value="dark">Dark</option>
              <option value="light">Light</option>
            </select>
          </label>
          <label>
            <span>Editor command</span>
            <input v-model="draft.preferences.editorCommand" type="text" placeholder="code" />
          </label>
          <label>
            <span>Default clone directory</span>
            <input v-model="draft.preferences.cloneDirectory" type="text" placeholder="/home/me/Code" />
          </label>
          <label>
            <span>AI Git profile</span>
            <select v-model="draft.preferences.aiProfileId">
              <option v-for="profile in draft.agentProfiles" :key="profile.id" :value="profile.id">
                {{ profile.name }}
              </option>
            </select>
          </label>
        </div>

        <div class="task-editor-head">
          <h3>Agent tools</h3>
          <button type="button" class="small" @click="addAgentProfile"><AppIcon name="plus" />Add Custom</button>
        </div>
        <div class="agent-profile-grid">
          <UiCard v-for="profile in draft.agentProfiles" :key="profile.id" class="task-card compact-card">
            <div class="task-grid">
              <label><span>Name</span><input v-model="profile.name" type="text" /></label>
              <label><span>Command</span><input v-model="profile.command" type="text" /></label>
              <label
                ><span>Arguments</span
                ><input
                  :value="formatArgs(profile.args)"
                  type="text"
                  @input="profile.args = parseArgs(($event.target as HTMLInputElement).value)"
              /></label>
              <label class="inline-checkbox"
                ><input v-model="profile.enabled" type="checkbox" /><span>Enabled</span></label
              >
            </div>
            <button
              v-if="profile.tool === 'custom'"
              type="button"
              class="danger small"
              :disabled="
                draft.workspaces.some((workspace) => workspace.agents.some((agent) => agent.profileId === profile.id))
              "
              @click="removeAgentProfile(profile.id)"
            >
              <AppIcon name="trash" />Remove
            </button>
          </UiCard>
        </div>

        <div class="form-grid">
          <label>
            <span>Project name</span>
            <input v-model="currentProject.name" type="text" />
          </label>

          <label>
            <span>Project path</span>
            <div class="path-field">
              <input v-model="currentProject.path" type="text" />
              <button type="button" class="small" @click="pickProjectPath"><AppIcon name="folder" />Browse</button>
            </div>
          </label>

          <label class="inline-checkbox">
            <input v-model="currentProject.autoStart" type="checkbox" />
            <span>Auto-start this project on app launch</span>
          </label>
        </div>

        <div class="task-editor-head">
          <h3>Tasks</h3>
          <button type="button" class="small" @click="addTask"><AppIcon name="plus" />Add Task</button>
        </div>

        <div class="task-editor-list">
          <UiCard v-for="task in currentProject.tasks" :key="task.id" class="task-card">
            <div class="task-card-head">
              <strong>{{ task.name || 'Task' }}</strong>
              <button type="button" class="danger small" @click="removeTask(task.id)">
                <AppIcon name="trash" />Remove
              </button>
            </div>

            <div class="task-grid">
              <label>
                <span>Name</span>
                <input v-model="task.name" type="text" />
              </label>

              <label>
                <span>Command</span>
                <input v-model="task.command" type="text" placeholder="npm" />
              </label>

              <label>
                <span>Args</span>
                <input v-model="task.argsText" type="text" placeholder="run dev" />
              </label>

              <label class="inline-checkbox">
                <input v-model="task.autoStart" type="checkbox" />
                <span>Auto-start this task</span>
              </label>
            </div>
          </UiCard>

          <p v-if="currentProject.tasks.length === 0" class="empty-note">
            No tasks configured. Add one to run commands for this project.
          </p>
        </div>
      </section>

      <section v-else class="settings-editor">
        <p class="empty-note">Add a project to begin configuring commands.</p>
      </section>
    </div>

    <div v-if="pendingProjectRemoval" class="confirm-overlay" @keydown.esc.stop.prevent="cancelProjectRemoval">
      <div class="confirm-dialog" role="alertdialog" aria-modal="true" aria-labelledby="delete-project-title">
        <div class="confirm-dialog-intro">
          <span class="confirm-dialog-icon"><AppIcon name="alert" :size="22" /></span>
          <div>
            <h2 id="delete-project-title">Delete project?</h2>
            <p>
              This will remove <strong>{{ pendingProjectRemoval.name || 'Untitled project' }}</strong> and all of its
              tasks from this configuration.
            </p>
          </div>
        </div>
        <div class="confirm-actions">
          <button ref="confirmCancelRef" type="button" class="secondary" @click="cancelProjectRemoval">Cancel</button>
          <button type="button" class="danger prominent-danger" @click="confirmProjectRemoval">
            <AppIcon name="trash" />Delete Project
          </button>
        </div>
      </div>
    </div>
  </UiDialog>
</template>
