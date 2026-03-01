<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue'
import type {
  ProjectCreateDataEvent,
  ProjectCreateDoneEvent,
  ProjectCreateRequest,
  ProjectCreateStatus,
  ProjectCreateStatusEvent,
} from '../../shared/types'

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

const unsubscribers: Array<() => void> = []
const ansiPattern = /\u001b\[[0-?]*[ -/]*[@-~]/g

function sanitizeTerminalChunk(chunk: string): string {
  return chunk.replace(ansiPattern, '')
}

function attachListeners(): void {
  if (unsubscribers.length > 0) {
    return
  }

  unsubscribers.push(
    window.exedeck.onProjectCreateData((event: ProjectCreateDataEvent) => {
      if (event.jobId !== jobId.value) {
        return
      }
      logs.value = `${logs.value}${sanitizeTerminalChunk(event.chunk)}`
      localError.value = ''
    }),
  )

  unsubscribers.push(
    window.exedeck.onProjectCreateStatus((event: ProjectCreateStatusEvent) => {
      if (event.jobId !== jobId.value) {
        return
      }
      status.value = event.status
      localError.value = ''
    }),
  )

  unsubscribers.push(
    window.exedeck.onProjectCreateDone((event: ProjectCreateDoneEvent) => {
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
  const selectedPath = await window.exedeck.pickDirectory(projectDirectory.value || '.')
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

  const nextJobId = await window.exedeck.projectCreate({
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

  if (!nextJobId) {
    localError.value = 'Failed to start project scaffold job.'
    return
  }

  jobId.value = nextJobId
  const snapshot = await window.exedeck.projectCreateGet(nextJobId)
  if (snapshot) {
    status.value = snapshot
  }
}

async function cancelCreate(): Promise<void> {
  if (!jobId.value) {
    return
  }

  await window.exedeck.projectCreateCancel(jobId.value)
}

async function sendInput(): Promise<void> {
  if (!jobId.value || !inputLine.value.trim()) {
    return
  }

  await window.exedeck.projectCreateInput(jobId.value, `${inputLine.value}\n`)
  inputLine.value = ''
}
</script>

<template>
  <div class="modal-overlay" role="dialog" aria-modal="true">
    <section class="new-project-modal">
      <header class="modal-header">
        <h2>Create New Project</h2>
        <div class="modal-actions">
          <span class="pill">{{ statusLabel }}</span>
          <button type="button" class="secondary" @click="emit('close')">Close</button>
        </div>
      </header>

      <div class="new-project-body">
        <section class="new-project-form">
          <label>
            <span>Framework</span>
            <select v-model="framework" :disabled="isRunning">
              <option value="laravel">Laravel</option>
              <option value="adonisjs">AdonisJS</option>
            </select>
          </label>

          <label>
            <span>Project name</span>
            <input v-model="projectName" type="text" placeholder="my-app" :disabled="isRunning" />
          </label>

          <label>
            <span>Directory</span>
            <div class="path-field">
              <input v-model="projectDirectory" type="text" :disabled="isRunning" />
              <button type="button" class="small" :disabled="isRunning" @click="pickDirectory">Browse</button>
            </div>
          </label>

          <template v-if="isLaravel">
            <label>
              <span>Starter kit</span>
              <select v-model="laravelStarterKit" :disabled="isRunning">
                <option value="none">None</option>
                <option value="react">React</option>
                <option value="vue">Vue</option>
                <option value="svelte">Svelte</option>
                <option value="livewire">Livewire</option>
              </select>
            </label>

            <label>
              <span>Authentication</span>
              <select v-model="laravelAuthMode" :disabled="isRunning">
                <option value="default">Default</option>
                <option value="no-authentication">No authentication</option>
                <option value="workos">WorkOS</option>
              </select>
            </label>

            <label class="inline-checkbox">
              <input v-model="laravelBoost" type="checkbox" :disabled="isRunning" />
              <span>Install Laravel Boost</span>
            </label>
            <p class="empty-note">SQLite is always configured and npm dependencies are installed and built automatically.</p>
          </template>

          <div class="wizard-actions">
            <button type="button" class="primary" :disabled="!canStart" @click="startCreate">Start Scaffold</button>
            <button type="button" class="danger" :disabled="!isRunning" @click="cancelCreate">Cancel</button>
          </div>

          <p v-if="status?.fallbackUsed" class="empty-note">Primary scaffold failed and fallback command was used.</p>
          <p v-if="localError" class="error-note">{{ localError }}</p>
        </section>

        <section class="new-project-output">
          <h3>Scaffold Output</h3>
          <pre class="provision-log">{{ logs || 'No output yet.' }}</pre>

          <div class="provision-input-row">
            <input
              v-model="inputLine"
              type="text"
              placeholder="Send input to scaffold process..."
              :disabled="!isRunning"
              @keyup.enter="sendInput"
            />
            <button type="button" class="small" :disabled="!isRunning || !inputLine.trim()" @click="sendInput">Send</button>
          </div>
        </section>
      </div>
    </section>
  </div>
</template>
