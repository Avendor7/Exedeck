<script setup lang="ts">
defineProps<{
  disabled: boolean
}>()

const emit = defineEmits<{
  focus: []
  clear: []
  stop: []
  restart: []
}>()
</script>

<template>
  <div class="toolbar">
    <button type="button" :disabled="disabled" @click="emit('focus')">Focus</button>
    <button type="button" :disabled="disabled" @click="emit('clear')">Clear</button>
    <button type="button" :disabled="disabled" @click="emit('stop')">Stop</button>
    <button type="button" :disabled="disabled" @click="emit('restart')">Restart</button>
  </div>
</template>
