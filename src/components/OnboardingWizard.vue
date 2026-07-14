<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import type { AppConfig, ProjectConfig, TaskConfig } from '../../shared/types'
import { createId, parseArgs } from '../utils/commandArgs'
import { useDialogFocus } from '../composables/useDialogFocus'

interface DraftTask {
  id: string
  name: string
  command: string
  argsText: string
  autoStart: boolean
}

const emit = defineEmits<{
  complete: [config: AppConfig]
}>()

const projectName = ref('Exedeck Project')
const projectPath = ref('.')
const projectAutoStart = ref(false)
const dialogRef = ref<HTMLElement | null>(null)
const localError = ref('')

useDialogFocus(dialogRef)

const tasks = ref<DraftTask[]>([
  {
    id: createId('task'),
    name: 'Dev server',
    command: 'npm',
    argsText: 'run dev',
    autoStart: false,
  },
])

function addTask(): void {
  tasks.value.push({
    id: createId('task'),
    name: 'New task',
    command: '',
    argsText: '',
    autoStart: false,
  })
}

function removeTask(taskId: string): void {
  tasks.value = tasks.value.filter((task) => task.id !== taskId)
}

async function pickProjectPath(): Promise<void> {
  const selectedPath = await window.exedeck.projects.pickDirectory(projectPath.value || '.')
  if (selectedPath) {
    projectPath.value = selectedPath
  }
}

function submit(): void {
  if (!canSubmit.value) {
    localError.value = 'Enter a project name and choose its folder to continue.'
    return
  }
  const nextTasks: TaskConfig[] = tasks.value
    .filter((task) => task.name.trim() || task.command.trim())
    .map((task) => ({
      id: task.id,
      name: task.name.trim() || 'Task',
      command: task.command.trim(),
      args: parseArgs(task.argsText),
      cwd: projectPath.value.trim() || '.',
      autoStart: task.autoStart,
    }))

  const nextProject: ProjectConfig = {
    id: createId('project'),
    name: projectName.value.trim() || 'My Project',
    path: projectPath.value.trim() || '.',
    framework: 'custom',
    autoStart: projectAutoStart.value,
    tasks: nextTasks,
  }

  const nextConfig: AppConfig = {
    schemaVersion: 4,
    onboardingCompleted: true,
    projects: [nextProject],
    preferences: {
      appearance: 'system',
      editorCommand: '',
      cloneDirectory: '',
      aiProfileId: 'agent-profile-codex',
    },
    agentProfiles: [
      { id: 'agent-profile-codex', name: 'Codex', tool: 'codex', command: 'codex', args: [], enabled: true },
      { id: 'agent-profile-claude', name: 'Claude', tool: 'claude', command: 'claude', args: [], enabled: true },
    ],
    agentSessions: [],
  }

  emit('complete', nextConfig)
}

const canSubmit = computed(() => Boolean(projectName.value.trim() && projectPath.value.trim()))

onMounted(async () => {
  try {
    const defaultDirectory = await window.exedeck.projects.defaultDirectory()
    if (defaultDirectory.trim()) {
      projectPath.value = defaultDirectory
    }
  } catch {
    // The editable fallback path remains available if the native lookup fails.
  }
})
</script>

<template>
  <div class="modal-overlay onboarding">
    <section
      ref="dialogRef"
      class="onboarding-card"
      role="dialog"
      aria-modal="true"
      aria-labelledby="onboarding-title"
      tabindex="-1"
    >
      <header class="onboarding-head">
        <div class="app-mark large" aria-hidden="true">E</div>
        <div>
          <span class="modal-eyebrow">Welcome</span>
          <h2 id="onboarding-title">Set up your first workspace</h2>
          <p>Add an existing project and the commands you use while developing.</p>
        </div>
      </header>

      <div class="form-grid">
        <label>
          <span>Project name</span>
          <input v-model="projectName" type="text" autocomplete="off" autofocus />
        </label>

        <label>
          <span>Project path</span>
          <div class="path-field">
            <input v-model="projectPath" type="text" />
            <button type="button" class="small" @click="pickProjectPath">Browse</button>
          </div>
        </label>

        <label class="inline-checkbox">
          <input v-model="projectAutoStart" type="checkbox" />
          <span>Auto-start this project when the app opens</span>
        </label>
      </div>

      <div class="task-editor-head">
        <h3>Startup commands</h3>
        <button type="button" class="small" @click="addTask">Add Command</button>
      </div>

      <div class="task-editor-list">
        <article class="task-card" v-for="task in tasks" :key="task.id">
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
      </div>

      <footer class="onboarding-footer">
        <p v-if="localError" class="error-note" role="alert">{{ localError }}</p>
        <button type="button" class="primary" :disabled="!canSubmit" @click="submit">Create workspace</button>
      </footer>
    </section>
  </div>
</template>
