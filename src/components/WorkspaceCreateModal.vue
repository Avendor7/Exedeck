<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import type { Checkout, ProjectConfig } from '../../shared/types'
import AppIcon from './AppIcon.vue'
import UiButton from './ui/UiButton.vue'
import UiDialog from './ui/UiDialog.vue'
import UiField from './ui/UiField.vue'

const props = defineProps<{ project: ProjectConfig }>()
const emit = defineEmits<{ close: []; created: [workspaceId: string] }>()
const name = ref('Feature workspace')
const branch = ref('work/feature-workspace')
const parentBranch = ref('')
const worktreePath = ref('')
const busy = ref(false)
const error = ref('')

const slug = computed(
  () =>
    name.value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '') || 'workspace',
)
const canCreate = computed(() => Boolean(name.value.trim() && branch.value.trim() && worktreePath.value.trim()))

watch(slug, (value, previous) => {
  if (!branch.value || branch.value === `work/${previous}`) branch.value = `work/${value}`
  const separator = props.project.path.includes('\\') ? '\\' : '/'
  const normalized = props.project.path.replace(/[\\/]+$/, '')
  const split = Math.max(normalized.lastIndexOf('/'), normalized.lastIndexOf('\\'))
  const parent = normalized.slice(0, split)
  const projectName = normalized.slice(split + 1)
  const oldDefault = `${parent}${separator}${projectName}-${previous}`
  if (!worktreePath.value || worktreePath.value === oldDefault) {
    worktreePath.value = `${parent}${separator}${projectName}-${value}`
  }
})

async function create(): Promise<void> {
  if (!canCreate.value) return
  busy.value = true
  error.value = ''
  try {
    const result = await window.exedeck.workspaces.create({
      projectId: props.project.id,
      name: name.value,
      branch: branch.value,
      worktreePath: worktreePath.value,
      ...(parentBranch.value ? { parentBranch: parentBranch.value } : {}),
    })
    if (!result.ok || !result.workspace) {
      error.value = result.error || 'The workspace could not be created.'
      return
    }
    emit('created', result.workspace.id)
  } catch (caught) {
    error.value = caught instanceof Error ? caught.message : 'The workspace could not be created.'
  } finally {
    busy.value = false
  }
}

onMounted(async () => {
  const checkouts: Checkout[] = await window.exedeck.git.listCheckouts(props.project.id)
  const root = checkouts.find((item) => item.isMain) ?? checkouts[0]
  parentBranch.value = root?.branch === '(detached)' ? '' : (root?.branch ?? '')
  const separator = props.project.path.includes('\\') ? '\\' : '/'
  const normalized = props.project.path.replace(/[\\/]+$/, '')
  const split = Math.max(normalized.lastIndexOf('/'), normalized.lastIndexOf('\\'))
  worktreePath.value = `${normalized.slice(0, split)}${separator}${normalized.slice(split + 1)}-${slug.value}`
})
</script>

<template>
  <UiDialog labelledby="workspace-create-title" panel-class="workspace-create-modal" @close="emit('close')">
    <header class="modal-header">
      <div>
        <span class="modal-eyebrow">{{ project.name }}</span>
        <h2 id="workspace-create-title">New worktree workspace</h2>
      </div>
      <UiButton variant="secondary" @click="emit('close')"><AppIcon name="x" />Cancel</UiButton>
    </header>
    <div class="workspace-create-body">
      <p>
        The Root workspace is always available. Create an isolated worktree when you need a separate branch and
        checkout.
      </p>
      <UiField label="Name"><input v-model="name" type="text" autofocus /></UiField>
      <UiField label="Branch"><input v-model="branch" type="text" /></UiField>
      <UiField label="Parent branch"><input v-model="parentBranch" type="text" placeholder="main" /></UiField>
      <UiField label="Worktree path"><input v-model="worktreePath" type="text" /></UiField>
      <p v-if="error" class="inline-error" role="alert">{{ error }}</p>
    </div>
    <footer class="modal-actions">
      <UiButton variant="primary" :disabled="!canCreate || busy" @click="create">
        <AppIcon name="git-branch" />Create workspace
      </UiButton>
    </footer>
  </UiDialog>
</template>
