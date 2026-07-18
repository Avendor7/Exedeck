<script setup lang="ts">
import { computed, ref } from 'vue'
import type { AppPreferences } from '../../shared/types'
import AppIcon from './AppIcon.vue'
import UiButton from './ui/UiButton.vue'
import UiDialog from './ui/UiDialog.vue'
import UiField from './ui/UiField.vue'

const props = defineProps<{ preferences: AppPreferences }>()
const emit = defineEmits<{ close: []; cloned: [projectId: string] }>()
const url = ref('')
const name = ref('')
const parentDirectory = ref(props.preferences.cloneDirectory)
const folderName = ref('')
const busy = ref(false)
const error = ref('')

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
  <UiDialog labelledby="clone-title" panel-class="onboarding-card clone-card" @close="emit('close')">
    <header class="modal-header">
      <div>
        <span class="modal-eyebrow">Git</span>
        <h2 id="clone-title">Clone repository</h2>
      </div>
      <UiButton variant="secondary" :disabled="busy" @click="emit('close')"> <AppIcon name="x" />Cancel </UiButton>
    </header>
    <div class="form-grid">
      <UiField label="Repository URL">
        <input v-model="url" type="text" placeholder="git@github.com:owner/project.git" autofocus />
      </UiField>
      <UiField label="Project name (optional)">
        <input v-model="name" type="text" placeholder="Derived from destination" />
      </UiField>
      <UiField label="Parent directory">
        <div class="path-field">
          <input v-model="parentDirectory" type="text" placeholder="/home/me/Code" />
          <UiButton size="small" @click="pickDirectory"> <AppIcon name="folder" />Browse </UiButton>
        </div>
      </UiField>
      <UiField label="Repository folder (optional)">
        <input v-model="folderName" type="text" :placeholder="derivedFolderName || 'project'" />
      </UiField>
    </div>
    <p class="empty-note">
      Destination: {{ destinationPath || 'Enter a repository URL and parent directory.' }} Existing Git credentials are
      reused.
    </p>
    <p v-if="error" class="inline-error" role="alert">{{ error }}</p>
    <footer class="confirm-actions">
      <UiButton variant="primary" :disabled="!canClone" @click="clone">
        <AppIcon :name="busy ? 'refresh' : 'git-clone'" />{{ busy ? 'Cloning…' : 'Clone and add project' }}
      </UiButton>
    </footer>
  </UiDialog>
</template>
