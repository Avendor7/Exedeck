<script setup lang="ts">
import UiButton from './UiButton.vue'

withDefaults(
  defineProps<{
    label: string
    variant?: 'default' | 'primary' | 'secondary' | 'danger'
  }>(),
  { variant: 'default' },
)
</script>

<template>
  <UiButton :variant="variant" icon-only :aria-label="label"><slot /></UiButton>
</template>
