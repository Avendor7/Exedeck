<script setup lang="ts">
defineProps<{
  disabled: boolean
  running: boolean
}>()

const emit = defineEmits<{
  focus: []
  clear: []
  start: []
  stop: []
  restart: []
}>()
</script>

<template>
  <div class="toolbar" role="toolbar" aria-label="Task actions">
    <button type="button" class="toolbar-button primary-action" :disabled="disabled || running" @click="emit('start')">
      <svg viewBox="0 0 20 20" aria-hidden="true"><path d="m7 4 9 6-9 6z" /></svg>
      Start
    </button>
    <button type="button" class="toolbar-button" :disabled="disabled || !running" @click="emit('stop')">
      <svg viewBox="0 0 20 20" aria-hidden="true"><rect x="5" y="5" width="10" height="10" rx="1" /></svg>
      Stop
    </button>
    <button type="button" class="toolbar-button" :disabled="disabled" @click="emit('restart')">
      <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M15.2 7A6 6 0 1 0 16 12M15 3v4h-4" /></svg>
      Restart
    </button>
    <span class="toolbar-separator" aria-hidden="true" />
    <button type="button" class="toolbar-button" :disabled="disabled" title="Focus terminal (Ctrl+`)" @click="emit('focus')">
      <svg viewBox="0 0 20 20" aria-hidden="true"><path d="m4 6 4 4-4 4m6 0h6" /></svg>
      Focus
    </button>
    <button type="button" class="toolbar-button" :disabled="disabled" @click="emit('clear')">
      <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M4 5h12M8 5V3h4v2m3 0-1 12H6L5 5" /></svg>
      Clear
    </button>
  </div>
</template>
