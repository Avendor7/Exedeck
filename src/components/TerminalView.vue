<script setup lang="ts">
import { FitAddon } from 'xterm-addon-fit'
import { Terminal } from 'xterm'
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'

const props = defineProps<{
  taskId: string
  buffer: string
}>()

const emit = defineEmits<{
  input: [data: string]
}>()

const containerRef = ref<HTMLElement | null>(null)

let terminal: Terminal | null = null
let fitAddon: FitAddon | null = null
let resizeObserver: ResizeObserver | null = null
let renderedBuffer = ''
let renderedTaskId = ''

function renderFullBuffer(): void {
  if (!terminal) {
    return
  }

  terminal.reset()
  terminal.write(props.buffer)
  renderedBuffer = props.buffer
  renderedTaskId = props.taskId
}

function focusTerminal(): void {
  terminal?.focus()
}

function clearTerminal(): void {
  terminal?.clear()
}

defineExpose({
  focusTerminal,
  clearTerminal,
})

onMounted(async () => {
  await nextTick()
  if (!containerRef.value) {
    return
  }

  terminal = new Terminal({
    convertEol: false,
    cursorBlink: true,
    fontFamily: 'JetBrains Mono, Fira Code, Menlo, monospace',
    fontSize: 13,
    theme: {
      background: '#090c12',
      foreground: '#e3e9f0',
      cursor: '#91a8ff',
      black: '#0a0d13',
      red: '#ff6e8a',
      green: '#70e1a1',
      yellow: '#ffcc66',
      blue: '#7ba2ff',
      magenta: '#d78cff',
      cyan: '#7cd5ff',
      white: '#dbe3ef',
      brightBlack: '#4a556b',
      brightRed: '#ff8ea2',
      brightGreen: '#8ef0b5',
      brightYellow: '#ffd98a',
      brightBlue: '#9ab9ff',
      brightMagenta: '#e1a4ff',
      brightCyan: '#97e4ff',
      brightWhite: '#f4f8ff',
    },
  })

  fitAddon = new FitAddon()
  terminal.loadAddon(fitAddon)
  terminal.open(containerRef.value)
  fitAddon.fit()

  terminal.onData((data) => {
    emit('input', data)
  })

  resizeObserver = new ResizeObserver(() => {
    fitAddon?.fit()
  })
  resizeObserver.observe(containerRef.value)

  renderFullBuffer()
})

watch(
  () => props.taskId,
  () => {
    renderFullBuffer()
  },
)

watch(
  () => props.buffer,
  (nextBuffer) => {
    if (!terminal) {
      return
    }

    if (props.taskId !== renderedTaskId) {
      renderFullBuffer()
      return
    }

    if (nextBuffer.startsWith(renderedBuffer)) {
      const delta = nextBuffer.slice(renderedBuffer.length)
      if (delta) {
        terminal.write(delta)
      }
    } else {
      renderFullBuffer()
    }

    renderedBuffer = nextBuffer
  },
)

onBeforeUnmount(() => {
  resizeObserver?.disconnect()
  resizeObserver = null

  terminal?.dispose()
  terminal = null
  fitAddon = null
})
</script>

<template>
  <div class="terminal-root">
    <div ref="containerRef" class="terminal-host" />
  </div>
</template>
