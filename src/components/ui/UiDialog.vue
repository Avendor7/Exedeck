<script setup lang="ts">
import { ref } from 'vue'
import { useDialogFocus } from '../../composables/useDialogFocus'

const props = withDefaults(
  defineProps<{
    labelledby: string
    panelClass?: string
    overlayClass?: string
    closeOnEscape?: boolean
  }>(),
  {
    panelClass: '',
    overlayClass: '',
    closeOnEscape: true,
  },
)
const emit = defineEmits<{ close: [] }>()
const dialogRef = ref<HTMLElement | null>(null)

useDialogFocus(dialogRef, props.closeOnEscape ? () => emit('close') : undefined)
</script>

<template>
  <div class="modal-overlay" :class="overlayClass">
    <section
      ref="dialogRef"
      :class="panelClass"
      role="dialog"
      aria-modal="true"
      :aria-labelledby="labelledby"
      tabindex="-1"
    >
      <slot />
    </section>
  </div>
</template>
