<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import type { ExternalOpenTarget, WindowCommand, WindowState } from '../../shared/types'

type WorkspaceKind = 'tasks' | 'agents' | 'git'
type MenuId = 'file' | 'edit' | 'view' | 'process' | 'window' | 'help'
type ActionId =
  | 'newProject' | 'cloneProject' | 'settings' | 'openFiles' | 'openEditor' | 'openTerminal'
  | 'tasks' | 'agents' | 'git' | 'start' | 'stop' | 'restart' | 'focus' | 'clear'
  | 'about' | WindowCommand

interface MenuEntry {
  label?: string
  shortcut?: string
  action?: ActionId
  separator?: boolean
  disabled?: boolean
}

const props = defineProps<{
  projectName: string
  hasProject: boolean
  workspace: WorkspaceKind
  hasTask: boolean
  taskRunning: boolean
}>()

const emit = defineEmits<{
  newProject: []
  cloneProject: []
  settings: []
  selectWorkspace: [workspace: WorkspaceKind]
  start: []
  stop: []
  restart: []
  focus: []
  clear: []
  openProject: [target: ExternalOpenTarget]
}>()

const rootRef = ref<HTMLElement | null>(null)
const openMenu = ref<MenuId | null>(null)
const windowState = ref<WindowState>({ maximized: false, fullscreen: false })
let disposeState: (() => void) | null = null

const menus = computed<Record<MenuId, MenuEntry[]>>(() => ({
  file: [
    { label: 'New project…', shortcut: 'Ctrl+N', action: 'newProject' },
    { label: 'Clone repository…', shortcut: 'Ctrl+Shift+N', action: 'cloneProject' },
    { separator: true },
    { label: 'Project settings…', shortcut: 'Ctrl+,', action: 'settings', disabled: !props.hasProject },
    { label: 'Open project folder', action: 'openFiles', disabled: !props.hasProject },
    { label: 'Open in editor', action: 'openEditor', disabled: !props.hasProject },
    { label: 'Open in terminal', action: 'openTerminal', disabled: !props.hasProject },
    { separator: true },
    { label: 'Quit Exedeck', shortcut: 'Ctrl+Q', action: 'quit' },
  ],
  edit: [
    { label: 'Undo', shortcut: 'Ctrl+Z', action: 'undo' },
    { label: 'Redo', shortcut: 'Ctrl+Shift+Z', action: 'redo' },
    { separator: true },
    { label: 'Cut', shortcut: 'Ctrl+X', action: 'cut' },
    { label: 'Copy', shortcut: 'Ctrl+C', action: 'copy' },
    { label: 'Paste', shortcut: 'Ctrl+V', action: 'paste' },
    { label: 'Select all', shortcut: 'Ctrl+A', action: 'selectAll' },
  ],
  view: [
    { label: 'Tasks', shortcut: 'Ctrl+1', action: 'tasks', disabled: !props.hasProject },
    { label: 'Agents', shortcut: 'Ctrl+2', action: 'agents', disabled: !props.hasProject },
    { label: 'Git', shortcut: 'Ctrl+3', action: 'git', disabled: !props.hasProject },
    { separator: true },
    { label: 'Focus task terminal', shortcut: 'Ctrl+`', action: 'focus', disabled: props.workspace !== 'tasks' || !props.hasTask },
    { separator: true },
    { label: 'Zoom in', shortcut: 'Ctrl++', action: 'zoomIn' },
    { label: 'Zoom out', shortcut: 'Ctrl+-', action: 'zoomOut' },
    { label: 'Actual size', shortcut: 'Ctrl+0', action: 'resetZoom' },
    { label: windowState.value.fullscreen ? 'Exit full screen' : 'Enter full screen', shortcut: 'F11', action: 'toggleFullscreen' },
    { separator: true },
    { label: 'Reload interface', shortcut: 'Ctrl+R', action: 'reload' },
  ],
  process: [
    { label: 'Start selected task', shortcut: 'F5', action: 'start', disabled: !props.hasTask || props.taskRunning },
    { label: 'Stop selected task', shortcut: 'Shift+F5', action: 'stop', disabled: !props.hasTask || !props.taskRunning },
    { label: 'Restart selected task', shortcut: 'Ctrl+Shift+F5', action: 'restart', disabled: !props.hasTask },
    { separator: true },
    { label: 'Clear task output', action: 'clear', disabled: !props.hasTask },
  ],
  window: [
    { label: 'Minimize', action: 'minimize' },
    { label: windowState.value.maximized ? 'Restore' : 'Maximize', action: 'maximize' },
    { label: windowState.value.fullscreen ? 'Exit full screen' : 'Enter full screen', shortcut: 'F11', action: 'toggleFullscreen' },
    { separator: true },
    { label: 'Close window', shortcut: 'Alt+F4', action: 'close' },
  ],
  help: [
    { label: 'About Exedeck', action: 'about' },
  ],
}))

const menuLabels: Array<{ id: MenuId; label: string }> = [
  { id: 'file', label: 'File' },
  { id: 'edit', label: 'Edit' },
  { id: 'view', label: 'View' },
  { id: 'process', label: 'Process' },
  { id: 'window', label: 'Window' },
  { id: 'help', label: 'Help' },
]

function toggleMenu(id: MenuId): void {
  openMenu.value = openMenu.value === id ? null : id
}

async function runAction(action?: ActionId): Promise<void> {
  if (!action) return
  openMenu.value = null
  if (action === 'newProject') return emit('newProject')
  if (action === 'cloneProject') return emit('cloneProject')
  if (action === 'settings') return emit('settings')
  if (action === 'tasks' || action === 'agents' || action === 'git') return emit('selectWorkspace', action)
  if (action === 'start') return emit('start')
  if (action === 'stop') return emit('stop')
  if (action === 'restart') return emit('restart')
  if (action === 'focus') return emit('focus')
  if (action === 'clear') return emit('clear')
  if (action === 'openFiles') return emit('openProject', 'files')
  if (action === 'openEditor') return emit('openProject', 'editor')
  if (action === 'openTerminal') return emit('openProject', 'terminal')
  if (action === 'about') return void window.exedeck.window.showAbout()
  await window.exedeck.window.command(action)
}

function onDocumentPointerDown(event: PointerEvent): void {
  if (!rootRef.value?.contains(event.target as Node)) openMenu.value = null
}

function onKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape' && openMenu.value) {
    event.preventDefault()
    openMenu.value = null
    return
  }
  const modifier = event.ctrlKey || event.metaKey
  const key = event.key.toLowerCase()
  if (event.altKey && !modifier) {
    const menu = menuLabels.find((item) => item.label[0].toLowerCase() === key)
    if (menu) { event.preventDefault(); openMenu.value = menu.id; return }
  }
  if (modifier && key === 'n') { event.preventDefault(); event.shiftKey ? emit('cloneProject') : emit('newProject'); return }
  if (modifier && key === 'q') { event.preventDefault(); void runAction('quit'); return }
  if (modifier && key === 'r') { event.preventDefault(); void runAction('reload'); return }
  if (modifier && key === '0') { event.preventDefault(); void runAction('resetZoom'); return }
  if (modifier && (key === '+' || key === '=')) { event.preventDefault(); void runAction('zoomIn'); return }
  if (modifier && key === '-') { event.preventDefault(); void runAction('zoomOut'); return }
  if (modifier && ['1', '2', '3'].includes(key) && props.hasProject) {
    event.preventDefault()
    emit('selectWorkspace', key === '1' ? 'tasks' : key === '2' ? 'agents' : 'git')
    return
  }
  if (event.key === 'F11') { event.preventDefault(); void runAction('toggleFullscreen'); return }
  if (event.key === 'F5' && props.hasTask) {
    event.preventDefault()
    if (event.ctrlKey && event.shiftKey) emit('restart')
    else if (event.shiftKey && props.taskRunning) emit('stop')
    else if (!props.taskRunning) emit('start')
  }
}

onMounted(async () => {
  windowState.value = await window.exedeck.window.getState()
  disposeState = window.exedeck.window.onState((state) => { windowState.value = state })
  document.addEventListener('pointerdown', onDocumentPointerDown)
  window.addEventListener('keydown', onKeydown)
})

onBeforeUnmount(() => {
  disposeState?.()
  document.removeEventListener('pointerdown', onDocumentPointerDown)
  window.removeEventListener('keydown', onKeydown)
})
</script>

<template>
  <div ref="rootRef" class="app-menu-bar" role="region" aria-label="Application title bar" @dblclick.self="runAction('maximize')">
    <div class="titlebar-brand" aria-label="Exedeck" @dblclick="runAction('maximize')"><span class="titlebar-mark">E</span><strong>Exedeck</strong></div>
    <nav class="app-menubar" role="menubar" aria-label="Application menu">
      <div v-for="menu in menuLabels" :key="menu.id" class="app-menu-group">
        <button type="button" role="menuitem" :aria-expanded="openMenu === menu.id" :class="{ active: openMenu === menu.id }" @click="toggleMenu(menu.id)" @mouseenter="openMenu && (openMenu = menu.id)">{{ menu.label }}</button>
        <div v-if="openMenu === menu.id" class="app-menu-popover" role="menu" @keydown.esc.stop.prevent="openMenu = null">
          <template v-for="(entry, index) in menus[menu.id]" :key="`${menu.id}-${index}`">
            <div v-if="entry.separator" class="app-menu-separator" role="separator" />
            <button v-else type="button" role="menuitem" :disabled="entry.disabled" @click="runAction(entry.action)"><span>{{ entry.label }}</span><kbd v-if="entry.shortcut">{{ entry.shortcut }}</kbd></button>
          </template>
        </div>
      </div>
    </nav>
    <div class="titlebar-context" :title="projectName" @dblclick="runAction('maximize')">{{ projectName || 'No project' }}</div>
    <div class="window-controls" aria-label="Window controls">
      <button type="button" aria-label="Minimize" title="Minimize" @click="runAction('minimize')"><svg viewBox="0 0 14 14"><path d="M2.5 7h9" /></svg></button>
      <button type="button" :aria-label="windowState.maximized ? 'Restore' : 'Maximize'" :title="windowState.maximized ? 'Restore' : 'Maximize'" @click="runAction('maximize')"><svg viewBox="0 0 14 14"><path v-if="windowState.maximized" d="M4.5 5V2.5h7v7H9M2.5 4.5h7v7h-7z"/><rect v-else x="2.5" y="2.5" width="9" height="9" /></svg></button>
      <button type="button" class="window-close" aria-label="Close" title="Close" @click="runAction('close')"><svg viewBox="0 0 14 14"><path d="m2.75 2.75 8.5 8.5m0-8.5-8.5 8.5" /></svg></button>
    </div>
  </div>
</template>
