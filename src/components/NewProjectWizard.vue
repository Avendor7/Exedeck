<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import type {
  ProjectCreateDataEvent,
  ProjectCreateDoneEvent,
  ProjectCreateRequest,
  ProjectCreateStatus,
  ProjectCreateStatusEvent,
} from '../../shared/types'
import AppIcon from './AppIcon.vue'
import UiButton from './ui/UiButton.vue'
import UiDialog from './ui/UiDialog.vue'

const emit = defineEmits<{
  close: []
  created: [projectId: string]
}>()

const framework = ref<ProjectCreateRequest['framework']>('laravel')
const projectName = ref('')
const projectDirectory = ref('.')
const laravelStarterKit = ref<NonNullable<ProjectCreateRequest['laravel']>['starterKit']>('none')
const laravelAuthMode = ref<NonNullable<ProjectCreateRequest['laravel']>['authMode']>('default')
const laravelBoost = ref<NonNullable<ProjectCreateRequest['laravel']>['boost']>(false)
const jobId = ref('')
const status = ref<ProjectCreateStatus | null>(null)
const logs = ref('')
const inputLine = ref('')
const localError = ref('')

function requestClose(): void {
  if (isRunning.value) {
    localError.value = 'Cancel the running scaffold before closing this window.'
    return
  }
  emit('close')
}

const unsubscribers: Array<() => void> = []
function sanitizeTerminalChunk(chunk: string): string {
  let next = chunk
    .replace(/\u001b\][\s\S]*?(?:\u0007|\u001b\\)/g, '')
    .replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, '')
    .replace(/\u001b[@-Z\\-_]/g, '')
    .replace(/[\u2800-\u28ff]/g, '')

  // Resolve backspace-based redraws used by CLI spinners/progress bars.
  while (/[^\n]\u0008/.test(next)) {
    next = next.replace(/[^\n]\u0008/g, '')
  }

  // Convert carriage-return redraw frames into plain new lines for log readability.
  next = next.replace(/\r(?!\n)/g, '\n')

  return next
}

function attachListeners(): void {
  if (unsubscribers.length > 0) {
    return
  }

  unsubscribers.push(
    window.exedeck.projects.onCreateData((event: ProjectCreateDataEvent) => {
      if (event.jobId !== jobId.value) {
        return
      }
      const nextLogs = `${logs.value}${sanitizeTerminalChunk(event.chunk)}`
      logs.value = nextLogs.length > 500_000 ? nextLogs.slice(-500_000) : nextLogs
      localError.value = ''
    }),
  )

  unsubscribers.push(
    window.exedeck.projects.onCreateStatus((event: ProjectCreateStatusEvent) => {
      if (event.jobId !== jobId.value) {
        return
      }
      status.value = event.status
      localError.value = ''
    }),
  )

  unsubscribers.push(
    window.exedeck.projects.onCreateDone((event: ProjectCreateDoneEvent) => {
      if (event.jobId !== jobId.value) {
        return
      }

      if (event.state === 'success' && event.projectId) {
        emit('created', event.projectId)
        return
      }

      localError.value = event.error ?? 'Project creation did not complete successfully.'
    }),
  )
}

function detachListeners(): void {
  for (const unsubscribe of unsubscribers.splice(0)) {
    unsubscribe()
  }
}

onBeforeUnmount(() => {
  detachListeners()
})

onMounted(async () => {
  if (projectDirectory.value.trim() && projectDirectory.value.trim() !== '.') {
    return
  }

  try {
    const defaultDirectory = await window.exedeck.projects.defaultDirectory()
    if (defaultDirectory.trim()) {
      projectDirectory.value = defaultDirectory
    }
  } catch {
    localError.value = 'Could not determine the default projects folder. Choose a folder manually.'
  }
})

const canStart = computed<boolean>(() => {
  if (isRunning.value) {
    return false
  }

  return projectName.value.trim().length > 0 && projectDirectory.value.trim().length > 0
})

const isRunning = computed<boolean>(() => status.value?.state === 'running' || status.value?.state === 'queued')
const isLaravel = computed<boolean>(() => framework.value === 'laravel')

const statusLabel = computed<string>(() => {
  if (!status.value) {
    return 'Idle'
  }

  if (status.value.state === 'queued') {
    return 'Queued'
  }
  if (status.value.state === 'running') {
    return 'Running'
  }
  if (status.value.state === 'success') {
    return 'Completed'
  }
  if (status.value.state === 'failed') {
    return 'Failed'
  }
  return 'Canceled'
})

async function pickDirectory(): Promise<void> {
  const selectedPath = await window.exedeck.projects.pickDirectory(projectDirectory.value || '.')
  if (selectedPath) {
    projectDirectory.value = selectedPath
  }
}

async function startCreate(): Promise<void> {
  if (!canStart.value) {
    return
  }

  attachListeners()
  logs.value = ''
  status.value = null
  localError.value = ''

  let nextJobId: string | null
  try {
    nextJobId = await window.exedeck.projects.create({
      framework: framework.value,
      name: projectName.value.trim(),
      directory: projectDirectory.value.trim(),
      ...(framework.value === 'laravel'
        ? {
            laravel: {
              starterKit: laravelStarterKit.value,
              authMode: laravelAuthMode.value,
              boost: laravelBoost.value,
            },
          }
        : {}),
    })
  } catch (error) {
    localError.value = error instanceof Error ? error.message : 'Failed to start the scaffold job.'
    return
  }

  if (!nextJobId) {
    localError.value = 'Failed to start project scaffold job.'
    return
  }

  jobId.value = nextJobId
  const snapshot = await window.exedeck.projects.createGet(nextJobId)
  if (snapshot) {
    status.value = snapshot.status
    logs.value = sanitizeTerminalChunk(snapshot.buffer)
  }
}

async function cancelCreate(): Promise<void> {
  if (!jobId.value) {
    return
  }

  await window.exedeck.projects.createCancel(jobId.value)
}

async function sendInput(): Promise<void> {
  if (!jobId.value || !inputLine.value.trim()) {
    return
  }

  await window.exedeck.projects.createInput(jobId.value, `${inputLine.value}\n`)
  inputLine.value = ''
}
</script>

<template>
  <UiDialog labelledby="new-project-title" panel-class="new-project-modal" @close="requestClose">
    <header class="modal-header">
      <div>
        <span class="modal-eyebrow">Scaffolding</span>
        <h2 id="new-project-title">Create a new project</h2>
      </div>
      <div class="modal-actions">
        <span class="pill" :class="`state-${status?.state ?? 'idle'}`" role="status">{{ statusLabel }}</span>
        <UiButton variant="secondary" @click="requestClose"><AppIcon name="x" />Close</UiButton>
      </div>
    </header>

    <div class="new-project-body">
      <section class="new-project-form">
        <label>
          <span>Framework</span>
          <span class="select-field">
            <select v-model="framework" :disabled="isRunning">
              <option value="laravel">Laravel</option>
              <option value="adonisjs">AdonisJS</option>
            </select>
            <span class="select-indicator" aria-hidden="true">
              <svg viewBox="0 0 20 20"><path d="m4.5 7 5.5 5.5L15.5 7" /></svg>
            </span>
          </span>
        </label>

        <label>
          <span>Project name</span>
          <input
            v-model="projectName"
            type="text"
            placeholder="my-app"
            autocomplete="off"
            autofocus
            :disabled="isRunning"
          />
        </label>

        <label>
          <span>Directory</span>
          <div class="path-field">
            <input v-model="projectDirectory" type="text" :disabled="isRunning" />
            <button type="button" class="small" :disabled="isRunning" @click="pickDirectory">
              <AppIcon name="folder" />Browse
            </button>
          </div>
        </label>

        <template v-if="isLaravel">
          <label>
            <span>Starter kit</span>
            <span class="select-field">
              <select v-model="laravelStarterKit" :disabled="isRunning">
                <option value="none">None</option>
                <option value="react">React</option>
                <option value="vue">Vue</option>
                <option value="svelte">Svelte</option>
                <option value="livewire">Livewire</option>
              </select>
              <span class="select-indicator" aria-hidden="true">
                <svg viewBox="0 0 20 20"><path d="m4.5 7 5.5 5.5L15.5 7" /></svg>
              </span>
            </span>
          </label>

          <label>
            <span>Authentication</span>
            <span class="select-field">
              <select v-model="laravelAuthMode" :disabled="isRunning">
                <option value="default">Default</option>
                <option value="no-authentication">No authentication</option>
                <option value="workos">WorkOS</option>
              </select>
              <span class="select-indicator" aria-hidden="true">
                <svg viewBox="0 0 20 20"><path d="m4.5 7 5.5 5.5L15.5 7" /></svg>
              </span>
            </span>
          </label>

          <label class="inline-checkbox">
            <input v-model="laravelBoost" type="checkbox" :disabled="isRunning" />
            <span>Install Laravel Boost</span>
          </label>
          <p class="empty-note">
            SQLite is always configured and npm dependencies are installed and built automatically.
          </p>
        </template>

        <div class="wizard-actions">
          <UiButton variant="primary" :disabled="!canStart" @click="startCreate">
            <AppIcon name="sparkles" />Start Scaffold
          </UiButton>
          <UiButton variant="danger" :disabled="!isRunning" @click="cancelCreate">
            <AppIcon name="square" />Cancel process
          </UiButton>
        </div>

        <p v-if="status?.fallbackUsed" class="empty-note">Primary scaffold failed and fallback command was used.</p>
        <p v-if="localError" class="error-note" role="alert">{{ localError }}</p>
      </section>

      <section class="new-project-output">
        <h3>Scaffold Output</h3>
        <pre class="provision-log" role="log" aria-live="polite" aria-label="Scaffold output">{{
          logs || 'No output yet.'
        }}</pre>

        <div class="provision-input-row">
          <label class="sr-only" for="scaffold-input">Input for the scaffold process</label>
          <input
            id="scaffold-input"
            v-model="inputLine"
            type="text"
            placeholder="Send input to scaffold process..."
            :disabled="!isRunning"
            @keyup.enter="sendInput"
          />
          <UiButton size="small" :disabled="!isRunning || !inputLine.trim()" @click="sendInput">
            <AppIcon name="arrow-up" />Send
          </UiButton>
        </div>
      </section>
    </div>
  </UiDialog>
</template>
