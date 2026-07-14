<script setup lang="ts">
import { computed, ref } from 'vue'
import type { AppPreferences } from '../../shared/types'
import { useDialogFocus } from '../composables/useDialogFocus'

const props = defineProps<{ preferences: AppPreferences }>()
const emit = defineEmits<{ close: []; cloned: [projectId: string] }>()
const dialogRef = ref<HTMLElement | null>(null)
const url = ref('')
const name = ref('')
const directory = ref(props.preferences.cloneDirectory)
const busy = ref(false)
const error = ref('')
useDialogFocus(dialogRef, () => emit('close'))

const canClone = computed(() => Boolean(url.value.trim() && directory.value.trim() && !busy.value))

async function pickDirectory(): Promise<void> {
  const selected = await window.exedeck.projects.pickDirectory(directory.value || undefined)
  if (selected) directory.value = selected
}

async function clone(): Promise<void> {
  if (!canClone.value) return
  busy.value = true
  error.value = ''
  try {
    const project = await window.exedeck.git.clone({
      url: url.value.trim(),
      directory: directory.value.trim(),
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
    <section ref="dialogRef" class="onboarding-card clone-card" role="dialog" aria-modal="true" aria-labelledby="clone-title" tabindex="-1">
      <header class="modal-header">
        <div><span class="modal-eyebrow">Git</span><h2 id="clone-title">Clone repository</h2></div>
        <button type="button" class="secondary" :disabled="busy" @click="emit('close')">Cancel</button>
      </header>
      <div class="form-grid">
        <label><span>Repository URL</span><input v-model="url" type="text" placeholder="git@github.com:owner/project.git" autofocus /></label>
        <label><span>Project name (optional)</span><input v-model="name" type="text" placeholder="Derived from destination" /></label>
        <label><span>Destination path</span><div class="path-field"><input v-model="directory" type="text" placeholder="/home/me/Code/project" /><button type="button" class="small" @click="pickDirectory">Browse</button></div></label>
      </div>
      <p class="empty-note">The destination must be the new repository folder, not only its parent directory. Existing Git credentials are reused.</p>
      <p v-if="error" class="inline-error" role="alert">{{ error }}</p>
      <footer class="confirm-actions"><button type="button" class="primary" :disabled="!canClone" @click="clone">{{ busy ? 'Cloning…' : 'Clone and add project' }}</button></footer>
    </section>
  </div>
</template>
