<script setup lang="ts">
import { computed, ref } from 'vue'
import type { AppPreferences } from '../../shared/types'
import { useDialogFocus } from '../composables/useDialogFocus'
import AppIcon from './AppIcon.vue'

const props = defineProps<{ preferences: AppPreferences }>()
const emit = defineEmits<{ close: []; cloned: [projectId: string] }>()
const dialogRef = ref<HTMLElement | null>(null)
const url = ref('')
const name = ref('')
const parentDirectory = ref(props.preferences.cloneDirectory)
const folderName = ref('')
const busy = ref(false)
const error = ref('')
useDialogFocus(dialogRef, () => emit('close'))

const derivedFolderName = computed(() => {
  const repository =
    url.value
      .trim()
      .replace(/[\\/]+$/, '')
      .split(/[\\/:]/)
      .pop() ?? ''
  return repository
    .replace(/\.git$/i, '')
    .replace(/[\u0000-\u001f<>:"|?*]/g, '-')
    .trim()
})
const effectiveFolderName = computed(() => folderName.value.trim() || derivedFolderName.value)
const folderNameValid = computed(() =>
  Boolean(
    effectiveFolderName.value &&
    effectiveFolderName.value !== '.' &&
    effectiveFolderName.value !== '..' &&
    !/[/\\\0]/.test(effectiveFolderName.value),
  ),
)
const destinationPath = computed(() => {
  const parent = parentDirectory.value.trim().replace(/[\\/]+$/, '')
  if (!parent || !folderNameValid.value) return ''
  const separator = parent.includes('\\') && !parent.includes('/') ? '\\' : '/'
  return `${parent}${separator}${effectiveFolderName.value}`
})
const canClone = computed(() => Boolean(url.value.trim() && destinationPath.value && !busy.value))

async function pickDirectory(): Promise<void> {
  const selected = await window.exedeck.projects.pickDirectory(parentDirectory.value || undefined)
  if (selected) parentDirectory.value = selected
}

async function clone(): Promise<void> {
  if (!canClone.value) return
  busy.value = true
  error.value = ''
  try {
    const project = await window.exedeck.git.clone({
      url: url.value.trim(),
      directory: destinationPath.value,
      ...(name.value.trim() ? { name: name.value.trim() } : {}),
    })
    if (!project) {
      error.value = 'Clone failed. Check the URL, destination, and your existing Git authentication.'
      return
    }
    emit('cloned', project.id)
  } catch (caught) {
    error.value = caught instanceof Error ? caught.message : 'Clone failed.'
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <div class="modal-overlay">
    <section
      ref="dialogRef"
      class="onboarding-card clone-card"
      role="dialog"
      aria-modal="true"
      aria-labelledby="clone-title"
      tabindex="-1"
    >
      <header class="modal-header">
        <div>
          <span class="modal-eyebrow">Git</span>
          <h2 id="clone-title">Clone repository</h2>
        </div>
        <button type="button" class="secondary" :disabled="busy" @click="emit('close')">
          <AppIcon name="x" />Cancel
        </button>
      </header>
      <div class="form-grid">
        <label
          ><span>Repository URL</span
          ><input v-model="url" type="text" placeholder="git@github.com:owner/project.git" autofocus
        /></label>
        <label
          ><span>Project name (optional)</span><input v-model="name" type="text" placeholder="Derived from destination"
        /></label>
        <label
          ><span>Parent directory</span>
          <div class="path-field">
            <input v-model="parentDirectory" type="text" placeholder="/home/me/Code" /><button
              type="button"
              class="small"
              @click="pickDirectory"
            >
              <AppIcon name="folder" />Browse
            </button>
          </div></label
        >
        <label
          ><span>Repository folder (optional)</span
          ><input v-model="folderName" type="text" :placeholder="derivedFolderName || 'project'"
        /></label>
      </div>
      <p class="empty-note">
        Destination: {{ destinationPath || 'Enter a repository URL and parent directory.' }} Existing Git credentials
        are reused.
      </p>
      <p v-if="error" class="inline-error" role="alert">{{ error }}</p>
      <footer class="confirm-actions">
        <button type="button" class="primary" :disabled="!canClone" @click="clone">
          <AppIcon :name="busy ? 'refresh' : 'git-clone'" />{{ busy ? 'Cloning…' : 'Clone and add project' }}
        </button>
      </footer>
    </section>
  </div>
</template>
