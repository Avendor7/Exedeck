<script setup lang="ts">
import { computed } from 'vue'

type ButtonVariant = 'default' | 'primary' | 'secondary' | 'danger'
type ButtonSize = 'default' | 'small'

const props = withDefaults(
  defineProps<{
    variant?: ButtonVariant
    size?: ButtonSize
    prominent?: boolean
    iconOnly?: boolean
    type?: 'button' | 'submit' | 'reset'
  }>(),
  {
    variant: 'default',
    size: 'default',
    prominent: false,
    iconOnly: false,
    type: 'button',
  },
)

const classes = computed(() => ({
  [props.variant]: props.variant !== 'default',
  small: props.size === 'small',
  'prominent-danger': props.variant === 'danger' && props.prominent,
  'icon-button': props.iconOnly,
}))
</script>

<template>
  <button :type="type" :class="classes"><slot /></button>
</template>
