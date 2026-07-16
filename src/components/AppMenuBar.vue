<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import type { ExternalOpenTarget, WindowCommand, WindowState } from '../../shared/types'

const props = defineProps<{
  projectName: string
  hasProject: boolean
  hasAgent: boolean
  canFinishWorkspace: boolean
  agentRunning: boolean
  gitOpen: boolean
}>()
const emit = defineEmits<{
  newProject: []
  cloneProject: []
  newWorkspace: []
  finishWorkspace: []
  settings: []
  startAgent: []
  stopAgent: []
  toggleGit: []
  openProject: [target: ExternalOpenTarget]
}>()
const openMenu = ref<string | null>(null)
const windowState = ref<WindowState>({ maximized: false, fullscreen: false })
let dispose: (() => void) | undefined

async function command(value: WindowCommand): Promise<void> {
  openMenu.value = null
  await window.exedeck.window.command(value)
}
function action(callback: () => void): void {
  openMenu.value = null
  callback()
}
function showAbout(): void {
  openMenu.value = null
  void window.exedeck.window.showAbout()
}
function onKeydown(event: KeyboardEvent): void {
  const modifier = event.ctrlKey || event.metaKey
  if (modifier && event.shiftKey && event.key.toLowerCase() === 'n' && props.hasProject) {
    event.preventDefault()
    emit('newWorkspace')
  }
  if (modifier && event.key.toLowerCase() === 'g') {
    event.preventDefault()
    emit('toggleGit')
  }
  if (event.key === 'Escape') openMenu.value = null
}
onMounted(async () => {
  windowState.value = await window.exedeck.window.getState()
  dispose = window.exedeck.window.onState((state) => {
    windowState.value = state
  })
  window.addEventListener('keydown', onKeydown)
})
onBeforeUnmount(() => {
  dispose?.()
  window.removeEventListener('keydown', onKeydown)
})
</script>

<template>
  <div class="app-menu-bar" role="region" aria-label="Application title bar">
    <div class="titlebar-brand" aria-label="Exedeck"><span class="titlebar-mark">E</span></div>
    <nav class="app-menubar" aria-label="Application menu">
      <div class="app-menu-group">
        <button
          type="button"
          :class="{ active: openMenu === 'file' }"
          @click="openMenu = openMenu === 'file' ? null : 'file'"
        >
          File
        </button>
        <div v-if="openMenu === 'file'" class="app-menu-popover">
          <button :disabled="!hasProject" @click="action(() => emit('newWorkspace'))">
            <span>New Worktree Workspace</span><kbd>Ctrl+Shift+N</kbd>
          </button>
          <button @click="action(() => emit('newProject'))">New Application</button>
          <button @click="action(() => emit('cloneProject'))">Clone Repository</button>
          <div class="app-menu-separator" />
          <button :disabled="!hasProject" @click="action(() => emit('settings'))">Project Settings</button>
          <button @click="command('quit')">Quit</button>
        </div>
      </div>
      <div class="app-menu-group">
        <button
          type="button"
          :class="{ active: openMenu === 'workspace' }"
          @click="openMenu = openMenu === 'workspace' ? null : 'workspace'"
        >
          Workspace
        </button>
        <div v-if="openMenu === 'workspace'" class="app-menu-popover">
          <button :disabled="!hasAgent || agentRunning" @click="action(() => emit('startAgent'))">Start Agent</button>
          <button :disabled="!agentRunning" @click="action(() => emit('stopAgent'))">Stop Agent</button>
          <button :disabled="!canFinishWorkspace" @click="action(() => emit('finishWorkspace'))">
            Remove Workspace…
          </button>
          <div class="app-menu-separator" />
          <button :disabled="!hasProject" @click="action(() => emit('openProject', 'editor'))">Open in Editor</button>
          <button :disabled="!hasProject" @click="action(() => emit('openProject', 'terminal'))">Open Terminal</button>
          <button :disabled="!hasProject" @click="action(() => emit('openProject', 'files'))">Open Files</button>
        </div>
      </div>
      <div class="app-menu-group">
        <button
          type="button"
          :class="{ active: openMenu === 'view' }"
          @click="openMenu = openMenu === 'view' ? null : 'view'"
        >
          View
        </button>
        <div v-if="openMenu === 'view'" class="app-menu-popover">
          <button @click="action(() => emit('toggleGit'))">
            <span>{{ gitOpen ? 'Hide' : 'Show' }} Git Inspector</span><kbd>Ctrl+G</kbd>
          </button>
          <div class="app-menu-separator" />
          <button @click="command('zoomIn')">Zoom In</button><button @click="command('zoomOut')">Zoom Out</button
          ><button @click="command('resetZoom')">Actual Size</button>
        </div>
      </div>
      <div class="app-menu-group">
        <button
          type="button"
          :class="{ active: openMenu === 'help' }"
          @click="openMenu = openMenu === 'help' ? null : 'help'"
        >
          Help
        </button>
        <div v-if="openMenu === 'help'" class="app-menu-popover"><button @click="showAbout">About Exedeck</button></div>
      </div>
    </nav>
    <div class="titlebar-context">{{ projectName || 'No project' }}</div>
    <div class="window-controls">
      <button type="button" aria-label="Minimize" @click="command('minimize')">
        <svg aria-hidden="true" viewBox="0 0 16 16">
          <path d="M3 8.5h10" />
        </svg>
      </button>
      <button type="button" :aria-label="windowState.maximized ? 'Restore' : 'Maximize'" @click="command('maximize')">
        <svg v-if="windowState.maximized" aria-hidden="true" viewBox="0 0 16 16">
          <path d="M5 5V3h8v8h-2" />
          <rect x="3" y="5" width="8" height="8" />
        </svg>
        <svg v-else aria-hidden="true" viewBox="0 0 16 16">
          <rect x="3" y="3" width="10" height="10" />
        </svg>
      </button>
      <button type="button" class="window-close" aria-label="Close" @click="command('close')">
        <svg aria-hidden="true" viewBox="0 0 16 16">
          <path d="m3 3 10 10m0-10L3 13" />
        </svg>
      </button>
    </div>
  </div>
</template>
