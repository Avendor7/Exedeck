<script setup lang="ts">
import { computed, ref } from 'vue'
import type { AppConfig, ProjectConfig } from '../../shared/types'
import { createId } from '../utils/commandArgs'
import { useDialogFocus } from '../composables/useDialogFocus'

const props = defineProps<{ config: AppConfig }>()
const emit = defineEmits<{ complete: [config: AppConfig]; clone: [] }>()
const dialogRef = ref<HTMLElement | null>(null)
const projectPath = ref('')
const projectName = ref('')
const error = ref('')
useDialogFocus(dialogRef)
const canSubmit = computed(() => Boolean(projectPath.value.trim()))

async function pickFolder(): Promise<void> {
  const selected = await window.exedeck.projects.pickDirectory(projectPath.value || '.')
  if (!selected) return
  projectPath.value = selected
  projectName.value =
    selected
      .replace(/[\\/]+$/, '')
      .split(/[\\/]/)
      .at(-1) || 'Project'
}

function submit(): void {
  if (!canSubmit.value) {
    error.value = 'Choose a project folder first.'
    return
  }
  const project: ProjectConfig = {
    id: createId('project'),
    name: projectName.value.trim() || 'Project',
    path: projectPath.value.trim(),
    framework: 'custom',
    autoStart: false,
    tasks: [],
    branchParents: {},
  }
  emit('complete', { ...props.config, onboardingCompleted: true, projects: [...props.config.projects, project] })
}
</script>

<template>
  <div class="modal-overlay onboarding">
    <section
      ref="dialogRef"
      class="onboarding-card first-run-card"
      role="dialog"
      aria-modal="true"
      aria-labelledby="onboarding-title"
      tabindex="-1"
    >
      <header class="onboarding-head">
        <div class="app-mark large">E</div>
        <div>
          <span class="modal-eyebrow">Welcome to Exedeck</span>
          <h2 id="onboarding-title">Open your first project</h2>
          <p>Agent workspaces, Git, and optional development tasks all begin with a project folder.</p>
        </div>
      </header>
      <div class="first-run-actions">
        <button type="button" class="choice-card" @click="pickFolder">
          <span class="choice-icon">↗</span
          ><span><strong>Open Folder</strong><small>Use an existing local checkout.</small></span>
        </button>
        <button type="button" class="choice-card" @click="emit('clone')">
          <span class="choice-icon">⌘</span
          ><span><strong>Clone Repository</strong><small>Clone Git and register the new project.</small></span>
        </button>
      </div>
      <div v-if="projectPath" class="form-grid">
        <label><span>Project name</span><input v-model="projectName" type="text" /></label
        ><label><span>Folder</span><input :value="projectPath" readonly /></label>
      </div>
      <p v-if="error" class="inline-error">{{ error }}</p>
      <footer class="onboarding-footer">
        <span>Tasks can be added later in project settings.</span
        ><button class="primary" :disabled="!canSubmit" @click="submit">Open Project</button>
      </footer>
    </section>
  </div>
</template>
