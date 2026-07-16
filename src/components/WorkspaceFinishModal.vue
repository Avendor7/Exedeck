<script setup lang="ts">
import { onMounted, ref } from 'vue'
import type { WorkspaceConfig, WorkspaceFinishPreview } from '../../shared/types'
import { useDialogFocus } from '../composables/useDialogFocus'

const props = defineProps<{ workspace: WorkspaceConfig }>()
const emit = defineEmits<{ close: []; finished: [] }>()
const dialogRef = ref<HTMLElement | null>(null)
const preview = ref<WorkspaceFinishPreview | null>(null)
const merge = ref(false)
const removeWorktree = ref(false)
const deleteBranch = ref(false)
const busy = ref(true)
const error = ref('')
const completed = ref<string[]>([])
useDialogFocus(dialogRef, () => emit('close'))

async function finish(): Promise<void> {
  busy.value = true
  error.value = ''
  try {
    const result = await window.exedeck.workspaces.finish({
      workspaceId: props.workspace.id,
      merge: merge.value,
      removeWorktree: removeWorktree.value,
      deleteBranch: deleteBranch.value,
    })
    completed.value = result.completed
    if (result.ok) emit('finished')
    else error.value = result.error || `Pending: ${result.pending.join(', ')}`
  } catch (caught) {
    error.value = caught instanceof Error ? caught.message : 'The finish operation failed.'
  } finally {
    busy.value = false
  }
}

onMounted(async () => {
  preview.value = await window.exedeck.workspaces.finishPreview(props.workspace.id)
  removeWorktree.value = preview.value?.canRemoveWorktree ?? false
  busy.value = false
})
</script>

<template>
  <div class="modal-overlay">
    <section
      ref="dialogRef"
      class="workspace-finish-modal"
      role="dialog"
      aria-modal="true"
      aria-labelledby="finish-title"
      tabindex="-1"
    >
      <header class="modal-header">
        <div>
          <span class="modal-eyebrow">Guided finish</span>
          <h2 id="finish-title">Remove {{ workspace.name }}</h2>
        </div>
        <button type="button" @click="emit('close')">Cancel</button>
      </header>
      <div v-if="preview" class="workspace-finish-body">
        <dl class="finish-preview">
          <div>
            <dt>Running items</dt>
            <dd>{{ preview.runningItems }}</dd>
          </div>
          <div>
            <dt>Checkout</dt>
            <dd>{{ preview.checkout?.path ?? 'Missing' }}</dd>
          </div>
          <div>
            <dt>Working tree</dt>
            <dd>{{ preview.checkoutMissing ? 'Unavailable' : preview.clean ? 'Clean' : 'Has changes' }}</dd>
          </div>
          <div v-if="preview.parentBranch">
            <dt>Parent</dt>
            <dd>{{ preview.parentBranch }}</dd>
          </div>
        </dl>
        <p v-for="blocker in preview.blockers" :key="blocker" class="inline-error">{{ blocker }}</p>
        <template v-if="!preview.rootCheckout && !preview.checkoutMissing">
          <label class="inline-checkbox"
            ><input v-model="merge" type="checkbox" :disabled="!preview.canMerge" /><span
              >Merge into {{ preview.parentBranch || 'configured parent' }}</span
            ></label
          >
          <label class="inline-checkbox"
            ><input v-model="removeWorktree" type="checkbox" :disabled="!preview.canRemoveWorktree" /><span
              >Remove worktree</span
            ></label
          >
          <label class="inline-checkbox"
            ><input v-model="deleteBranch" type="checkbox" :disabled="!merge || !removeWorktree" /><span
              >Safely delete merged branch</span
            ></label
          >
        </template>
        <p v-else-if="preview.rootCheckout">The Root workspace is permanent and cannot be removed.</p>
        <p v-else>The missing checkout can be archived without removing Git resources.</p>
        <p v-if="completed.length" class="operation-message">Completed: {{ completed.join(', ') }}</p>
        <p v-if="error" class="inline-error" role="alert">{{ error }}</p>
      </div>
      <footer class="modal-actions">
        <button type="button" class="primary" :disabled="busy || !preview?.canArchive" @click="finish">
          Remove workspace
        </button>
      </footer>
    </section>
  </div>
</template>
