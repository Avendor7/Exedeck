<script setup lang="ts">
import { computed, ref } from 'vue'
import type { AppConfig, ProjectConfig, TaskConfig } from '../../shared/types'
import { createId, formatArgs, parseArgs } from '../utils/commandArgs'

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
  autoStart: boolean
  tasks: DraftTask[]
}

interface DraftConfig {
  schemaVersion: number
  onboardingCompleted: boolean
  projects: DraftProject[]
}

const props = defineProps<{
  config: AppConfig
  selectedProjectId: string
}>()

const emit = defineEmits<{
  close: []
  save: [config: AppConfig, selectedProjectId: string]
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
    autoStart: project.autoStart,
    tasks: project.tasks.map(toDraftTask),
  }
}

function toDraftConfig(config: AppConfig): DraftConfig {
  return {
    schemaVersion: config.schemaVersion,
    onboardingCompleted: config.onboardingCompleted,
    projects: config.projects.map(toDraftProject),
  }
}

const draft = ref<DraftConfig>(toDraftConfig(props.config))
const editingProjectId = ref<string>(props.selectedProjectId || draft.value.projects[0]?.id || '')
const pendingProjectRemovalId = ref<string | null>(null)

const currentProject = computed<DraftProject | null>(
  () => draft.value.projects.find((project) => project.id === editingProjectId.value) ?? draft.value.projects[0] ?? null,
)

const pendingProjectRemoval = computed<DraftProject | null>(() => {
  if (!pendingProjectRemovalId.value) {
    return null
  }

  return draft.value.projects.find((project) => project.id === pendingProjectRemovalId.value) ?? null
})

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
    path: '.',
    autoStart: false,
    tasks: [createDraftTask()],
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

  const selectedPath = await window.exedeck.pickDirectory(currentProject.value.path || '.')
  if (selectedPath) {
    currentProject.value.path = selectedPath
  }
}

function saveDraft(): void {
  const nextProjects: ProjectConfig[] = draft.value.projects.map((project) => ({
    id: project.id,
    name: project.name.trim() || 'Untitled project',
    path: project.path.trim() || '.',
    autoStart: project.autoStart,
    tasks: project.tasks
      .filter((task) => task.name.trim() || task.command.trim())
      .map((task) => ({
        id: task.id,
        name: task.name.trim() || 'Task',
        command: task.command.trim(),
        args: parseArgs(task.argsText),
        cwd: project.path.trim() || '.',
        autoStart: task.autoStart,
      })),
  }))

  const nextConfig: AppConfig = {
    schemaVersion: draft.value.schemaVersion,
    onboardingCompleted: nextProjects.length > 0,
    projects: nextProjects,
  }

  const nextSelectedProjectId =
    (editingProjectId.value && nextProjects.find((project) => project.id === editingProjectId.value)?.id) ||
    nextProjects[0]?.id ||
    ''

  emit('save', nextConfig, nextSelectedProjectId)
}
</script>

<template>
  <div class="modal-overlay" role="dialog" aria-modal="true">
    <section class="settings-modal">
      <header class="modal-header">
        <h2>Settings & Configuration</h2>
        <div class="modal-actions">
          <button
            v-if="currentProject"
            type="button"
            class="secondary subtle-danger"
            @click="requestProjectRemoval(currentProject.id)"
          >
            Delete Project
          </button>
          <button type="button" class="secondary" @click="emit('close')">Cancel</button>
          <button type="button" class="primary" @click="saveDraft">Save</button>
        </div>
      </header>

      <div class="modal-body">
        <aside class="settings-sidebar">
          <div class="settings-sidebar-head">
            <h3>Projects</h3>
            <button type="button" class="small" @click="addProject">Add</button>
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

        <section class="settings-editor" v-if="currentProject">
          <div class="form-grid">
            <label>
              <span>Project name</span>
              <input v-model="currentProject.name" type="text" />
            </label>

            <label>
              <span>Project path</span>
              <div class="path-field">
                <input v-model="currentProject.path" type="text" />
                <button type="button" class="small" @click="pickProjectPath">Browse</button>
              </div>
            </label>

            <label class="inline-checkbox">
              <input v-model="currentProject.autoStart" type="checkbox" />
              <span>Auto-start this project on app launch</span>
            </label>
          </div>

          <div class="task-editor-head">
            <h3>Tasks</h3>
            <button type="button" class="small" @click="addTask">Add Task</button>
          </div>

          <div class="task-editor-list">
            <article class="task-card" v-for="task in currentProject.tasks" :key="task.id">
              <div class="task-card-head">
                <strong>{{ task.name || 'Task' }}</strong>
                <button type="button" class="danger small" @click="removeTask(task.id)">Remove</button>
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
            </article>

            <p v-if="currentProject.tasks.length === 0" class="empty-note">
              No tasks configured. Add one to run commands for this project.
            </p>
          </div>
        </section>

        <section class="settings-editor" v-else>
          <p class="empty-note">Add a project to begin configuring commands.</p>
        </section>
      </div>

      <div v-if="pendingProjectRemoval" class="confirm-overlay" role="dialog" aria-modal="true">
        <div class="confirm-dialog">
          <h3>Delete project?</h3>
          <p>
            This will remove <strong>{{ pendingProjectRemoval.name || 'Untitled project' }}</strong> and all of its tasks from
            this configuration.
          </p>
          <div class="confirm-actions">
            <button type="button" class="secondary" @click="cancelProjectRemoval">Cancel</button>
            <button type="button" class="danger" @click="confirmProjectRemoval">Delete Project</button>
          </div>
        </div>
      </div>
    </section>
  </div>
</template>
