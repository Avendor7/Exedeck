<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import type { AppConfig, Checkout, ProjectConfig, WorkspaceCheckoutMode } from '../../shared/types'
import { useDialogFocus } from '../composables/useDialogFocus'

const props = defineProps<{ config: AppConfig; project: ProjectConfig }>()
const emit = defineEmits<{ close: []; created: [workspaceId: string] }>()
const dialogRef = ref<HTMLElement | null>(null)
const checkouts = ref<Checkout[]>([])
const mode = ref<WorkspaceCheckoutMode>('root')
const checkoutId = ref('')
const profileId = ref(props.config.agentProfiles.find((item) => item.enabled)?.id ?? '')
const title = ref('Agent workspace')
const branch = ref('agent/workspace')
const parentBranch = ref('')
const worktreePath = ref('')
const busy = ref(false)
const error = ref('')
useDialogFocus(dialogRef, () => emit('close'))

const slug = computed(
  () =>
    title.value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '') || 'workspace',
)
const canCreate = computed(() =>
  Boolean(
    profileId.value &&
    title.value.trim() &&
    (mode.value === 'root' ? checkoutId.value : branch.value.trim() && worktreePath.value.trim()),
  ),
)

watch(slug, (value, previous) => {
  if (!branch.value || branch.value === `agent/${previous}`) branch.value = `agent/${value}`
  const separator = props.project.path.includes('\\') ? '\\' : '/'
  const normalized = props.project.path.replace(/[\\/]+$/, '')
  const parent = normalized.slice(0, Math.max(normalized.lastIndexOf('/'), normalized.lastIndexOf('\\')))
  const name = normalized.slice(Math.max(normalized.lastIndexOf('/'), normalized.lastIndexOf('\\')) + 1)
  const oldDefault = `${parent}${separator}${name}-${previous}`
  if (!worktreePath.value || worktreePath.value === oldDefault) {
    worktreePath.value = `${parent}${separator}${name}-${value}`
  }
})

async function create(start: boolean): Promise<void> {
  if (!canCreate.value) return
  busy.value = true
  error.value = ''
  try {
    const result = await window.exedeck.workspaces.create({
      projectId: props.project.id,
      profileId: profileId.value,
      title: title.value,
      mode: mode.value,
      ...(mode.value === 'root'
        ? { checkoutId: checkoutId.value }
        : {
            branch: branch.value,
            worktreePath: worktreePath.value,
            ...(parentBranch.value ? { parentBranch: parentBranch.value } : {}),
          }),
      start,
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
  checkouts.value = await window.exedeck.git.listCheckouts(props.project.id)
  const root = checkouts.value.find((item) => item.isMain) ?? checkouts.value[0]
  checkoutId.value = root?.id ?? ''
  parentBranch.value = root?.branch === '(detached)' ? '' : (root?.branch ?? '')
  const initial = slug.value
  branch.value = `agent/${initial}`
  const separator = props.project.path.includes('\\') ? '\\' : '/'
  const normalized = props.project.path.replace(/[\\/]+$/, '')
  const split = Math.max(normalized.lastIndexOf('/'), normalized.lastIndexOf('\\'))
  worktreePath.value = `${normalized.slice(0, split)}${separator}${normalized.slice(split + 1)}-${initial}`
})
</script>

<template>
  <div class="modal-overlay">
    <section
      ref="dialogRef"
      class="workspace-create-modal"
      role="dialog"
      aria-modal="true"
      aria-labelledby="workspace-create-title"
      tabindex="-1"
    >
      <header class="modal-header">
        <div>
          <span class="modal-eyebrow">{{ project.name }}</span>
          <h2 id="workspace-create-title">New agent workspace</h2>
        </div>
        <button type="button" class="secondary" @click="emit('close')">Cancel</button>
      </header>
      <div class="workspace-create-body">
        <label><span>Title</span><input v-model="title" type="text" autofocus /></label>
        <label
          ><span>Agent</span
          ><select v-model="profileId">
            <option
              v-for="profile in config.agentProfiles.filter((item) => item.enabled)"
              :key="profile.id"
              :value="profile.id"
            >
              {{ profile.name }}
            </option>
          </select></label
        >
        <fieldset>
          <legend>Checkout</legend>
          <label class="choice-card"
            ><input v-model="mode" type="radio" value="root" /><span
              ><strong>Current checkout</strong><small>Use the project root or another existing worktree.</small></span
            ></label
          >
          <label class="choice-card"
            ><input v-model="mode" type="radio" value="worktree" /><span
              ><strong>Isolated worktree</strong><small>Create an agent branch and sibling worktree.</small></span
            ></label
          >
        </fieldset>
        <label v-if="mode === 'root'"
          ><span>Existing checkout</span
          ><select v-model="checkoutId">
            <option v-for="checkout in checkouts" :key="checkout.id" :value="checkout.id">
              {{ checkout.branch }} — {{ checkout.path }}
            </option>
          </select></label
        >
        <template v-else>
          <label><span>Branch</span><input v-model="branch" type="text" /></label>
          <label><span>Parent branch</span><input v-model="parentBranch" type="text" placeholder="main" /></label>
          <label><span>Worktree path</span><input v-model="worktreePath" type="text" /></label>
        </template>
        <p v-if="checkouts.length === 0" class="inline-error">
          This project is not a detected Git repository. Initialize Git before creating an agent workspace.
        </p>
        <p v-if="error" class="inline-error" role="alert">{{ error }}</p>
      </div>
      <footer class="modal-actions">
        <button type="button" :disabled="!canCreate || busy" @click="create(false)">Create</button>
        <button type="button" class="primary" :disabled="!canCreate || busy" @click="create(true)">
          Create &amp; Start
        </button>
      </footer>
    </section>
  </div>
</template>
