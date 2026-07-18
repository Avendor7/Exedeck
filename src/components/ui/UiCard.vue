<script setup lang="ts">
withDefaults(defineProps<{ as?: 'article' | 'section' | 'div' }>(), { as: 'article' })
</script>

<template>
  <component :is="as" class="ui-card"><slot /></component>
</template>
