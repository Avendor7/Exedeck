<script setup lang="ts">
withDefaults(
  defineProps<{
    label?: string
    hint?: string
    inline?: boolean
  }>(),
  {
    label: '',
    hint: '',
    inline: false,
  },
)
</script>

<template>
  <label :class="{ 'inline-checkbox': inline }">
    <span v-if="label">{{ label }}</span>
    <slot />
    <small v-if="hint" class="ui-field-hint">{{ hint }}</small>
  </label>
</template>
