<script setup lang="ts">
import { FitAddon } from '@xterm/addon-fit'
import { Terminal } from '@xterm/xterm'
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'

const props = defineProps<{
  taskId: string
  buffer: string
}>()

const emit = defineEmits<{
  input: [data: string]
  resize: [size: { cols: number; rows: number }]
}>()

const containerRef = ref<HTMLElement | null>(null)

let terminal: Terminal | null = null
let fitAddon: FitAddon | null = null
let resizeObserver: ResizeObserver | null = null
let colorScheme: MediaQueryList | null = null
let themeObserver: MutationObserver | null = null
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

function fitTerminalAndNotify(): void {
  if (!terminal || !fitAddon) {
    return
  }

  try {
    fitAddon.fit()
  } catch {
    return
  }
  emit('resize', {
    cols: terminal.cols,
    rows: terminal.rows,
  })
}

function applyTerminalTheme(): void {
  if (!terminal) {
    return
  }

  const explicitTheme = document.documentElement.dataset.theme
  const useLightTheme = explicitTheme === 'light' || (explicitTheme !== 'dark' && colorScheme?.matches)
  terminal.options.theme = useLightTheme
    ? {
        background: '#f7f8fa',
        foreground: '#20232a',
        cursor: '#155eef',
        selectionBackground: '#b9d0ff',
        black: '#25272c',
        red: '#b4233c',
        green: '#087443',
        yellow: '#8a5b00',
        blue: '#155eef',
        magenta: '#8c3eb8',
        cyan: '#087f8c',
        white: '#e7e9ee',
        brightBlack: '#686d76',
        brightWhite: '#ffffff',
      }
    : {
        background: '#0c0e12',
        foreground: '#e6e8ec',
        cursor: '#8eafff',
        selectionBackground: '#315ea8',
        black: '#111318',
        red: '#ff7f8f',
        green: '#68d89b',
        yellow: '#eac36b',
        blue: '#8eafff',
        magenta: '#d89bff',
        cyan: '#72d5df',
        white: '#d9dce2',
        brightBlack: '#6e737e',
        brightWhite: '#ffffff',
      }
}

onMounted(async () => {
  await nextTick()
  if (!containerRef.value) {
    return
  }

  terminal = new Terminal({
    convertEol: false,
    cursorBlink: true,
    fontFamily: '"SFMono-Regular", Consolas, "Liberation Mono", Menlo, monospace',
    fontSize: 13,
    lineHeight: 1.22,
    minimumContrastRatio: 4.5,
    screenReaderMode: true,
    scrollback: 10_000,
    cursorStyle: 'bar',
    cursorWidth: 2,
    rightClickSelectsWord: true,
  })

  colorScheme = window.matchMedia('(prefers-color-scheme: light)')
  colorScheme.addEventListener('change', applyTerminalTheme)
  themeObserver = new MutationObserver(applyTerminalTheme)
  themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
  applyTerminalTheme()

  fitAddon = new FitAddon()
  terminal.loadAddon(fitAddon)
  terminal.open(containerRef.value)
  fitTerminalAndNotify()

  terminal.onData((data) => {
    emit('input', data)
  })

  terminal.onResize(({ cols, rows }) => {
    emit('resize', { cols, rows })
  })

  containerRef.value.addEventListener('click', focusTerminal)

  resizeObserver = new ResizeObserver(() => {
    fitTerminalAndNotify()
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
  containerRef.value?.removeEventListener('click', focusTerminal)
  colorScheme?.removeEventListener('change', applyTerminalTheme)
  colorScheme = null
  themeObserver?.disconnect()
  themeObserver = null

  terminal?.dispose()
  terminal = null
  fitAddon = null
})
</script>

<template>
  <div class="terminal-root">
    <div ref="containerRef" class="terminal-host" role="region" aria-label="Interactive task terminal" />
  </div>
</template>
