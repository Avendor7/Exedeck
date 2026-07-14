<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { AgentRuntimeSnapshot, AgentSession, AgentToolStatus, AppConfig, Checkout, ProjectConfig } from '../../shared/types'
import TerminalView from './TerminalView.vue'
import { createId } from '../utils/commandArgs'

const props = defineProps<{ config: AppConfig; project: ProjectConfig }>()
const emit = defineEmits<{ saveConfig: [config: AppConfig] }>()

const checkouts = ref<Checkout[]>([])
const toolStatuses = ref<Record<string, AgentToolStatus>>({})
const selectedSessionId = ref('')
const buffers = ref<Record<string, string>>({})
const runtimes = ref<Record<string, AgentRuntimeSnapshot>>({})
const title = ref('')
const profileId = ref('')
const checkoutId = ref('')
const prompt = ref('')
const error = ref('')
const terminalRef = ref<InstanceType<typeof TerminalView> | null>(null)
const cleanup: Array<() => void> = []

const sessions = computed(() => props.config.agentSessions
  .filter((session) => session.projectId === props.project.id)
  .sort((a, b) => b.createdAt - a.createdAt))
const profiles = computed(() => props.config.agentProfiles.filter((profile) => profile.enabled))
const selectedSession = computed(() => sessions.value.find((session) => session.id === selectedSessionId.value) ?? sessions.value[0] ?? null)
const selectedRuntime = computed(() => selectedSession.value
  ? runtimes.value[selectedSession.value.id] ?? { state: 'stopped', unread: false }
  : { state: 'stopped', unread: false } as AgentRuntimeSnapshot)
const selectedBuffer = computed(() => selectedSession.value ? buffers.value[selectedSession.value.id] ?? '' : '')

function appendBuffer(sessionId: string, chunk: string): void {
  const next = `${buffers.value[sessionId] ?? ''}${chunk}`
  buffers.value[sessionId] = next.length > 250_000 ? next.slice(-250_000) : next
}

async function refresh(): Promise<void> {
  error.value = ''
  const [nextCheckouts, statuses] = await Promise.all([
    window.exedeck.git.listCheckouts(props.project.id),
    window.exedeck.agents.discoverTools(),
  ])
  checkouts.value = nextCheckouts
  toolStatuses.value = Object.fromEntries(statuses.map((status) => [status.profileId, status]))
  checkoutId.value = nextCheckouts.find((item) => item.isMain)?.id ?? nextCheckouts[0]?.id ?? ''
  profileId.value = profiles.value[0]?.id ?? ''
  await Promise.all(sessions.value.map(async (session) => {
    const [buffer, runtime] = await Promise.all([
      window.exedeck.agents.getBuffer(session.id),
      window.exedeck.agents.getStatus(session.id),
    ])
    buffers.value[session.id] = buffer
    runtimes.value[session.id] = runtime
  }))
  if (!selectedSessionId.value || !sessions.value.some((session) => session.id === selectedSessionId.value)) {
    selectedSessionId.value = sessions.value[0]?.id ?? ''
  }
}

function addSession(): void {
  if (!profileId.value || !checkoutId.value) return
  const profile = profiles.value.find((item) => item.id === profileId.value)
  const session: AgentSession = {
    id: createId('agent-session'),
    projectId: props.project.id,
    checkoutId: checkoutId.value,
    profileId: profileId.value,
    title: title.value.trim() || `${profile?.name ?? 'Agent'} session`,
    createdAt: Date.now(),
  }
  emit('saveConfig', { ...props.config, agentSessions: [...props.config.agentSessions, session] })
  selectedSessionId.value = session.id
  title.value = ''
}

function removeSession(): void {
  if (!selectedSession.value || selectedRuntime.value.state === 'running') return
  emit('saveConfig', {
    ...props.config,
    agentSessions: props.config.agentSessions.filter((item) => item.id !== selectedSession.value?.id),
  })
}

async function start(): Promise<void> {
  if (!selectedSession.value) return
  error.value = ''
  if (!(await window.exedeck.agents.start({ sessionId: selectedSession.value.id, prompt: prompt.value || undefined }))) {
    error.value = 'The agent could not start. Check that its CLI is installed and the checkout still exists.'
  } else {
    prompt.value = ''
  }
}

async function stop(): Promise<void> { if (selectedSession.value) await window.exedeck.agents.stop(selectedSession.value.id) }
async function restart(): Promise<void> { if (selectedSession.value) await window.exedeck.agents.restart(selectedSession.value.id) }
async function clear(): Promise<void> {
  if (!selectedSession.value) return
  if (await window.exedeck.agents.clearBuffer(selectedSession.value.id)) buffers.value[selectedSession.value.id] = ''
  terminalRef.value?.clearTerminal()
}

watch(selectedSessionId, async (id) => {
  if (id) {
    await window.exedeck.agents.markRead(id)
    const runtime = runtimes.value[id]
    if (runtime) runtimes.value[id] = { ...runtime, unread: false }
  }
})
watch(() => props.project.id, () => { void refresh() })
watch(() => props.config.agentSessions.length, () => { void refresh() })

onMounted(() => {
  cleanup.push(
    window.exedeck.agents.onData(({ sessionId, chunk }) => {
      appendBuffer(sessionId, chunk)
      if (sessionId === selectedSession.value?.id) void window.exedeck.agents.markRead(sessionId)
    }),
    window.exedeck.agents.onStatus((event) => { runtimes.value[event.sessionId] = { state: event.state, unread: event.unread } }),
    window.exedeck.agents.onExit(({ sessionId, exitCode }) => {
      const existing = runtimes.value[sessionId]
      runtimes.value[sessionId] = { state: exitCode === 0 ? 'stopped' : 'crashed', unread: existing?.unread ?? true }
    }),
  )
  void refresh()
})
onBeforeUnmount(() => cleanup.forEach((dispose) => dispose()))
</script>

<template>
  <section class="agent-workspace">
    <aside class="agent-sidebar">
      <div class="subpanel-heading">
        <div><span class="panel-eyebrow">Terminal agents</span><h2>Sessions</h2></div>
        <button class="small" type="button" @click="refresh">Refresh</button>
      </div>
      <div class="agent-create">
        <input v-model="title" type="text" placeholder="Session title" aria-label="Session title" />
        <select v-model="profileId" aria-label="Agent profile">
          <option v-for="profile in profiles" :key="profile.id" :value="profile.id">
            {{ profile.name }}{{ toolStatuses[profile.id]?.installed === false ? ' (missing)' : '' }}
          </option>
        </select>
        <select v-model="checkoutId" aria-label="Agent checkout">
          <option v-for="checkout in checkouts" :key="checkout.id" :value="checkout.id">{{ checkout.branch }} — {{ checkout.path }}</option>
        </select>
        <button type="button" class="primary" :disabled="!profileId || !checkoutId" @click="addSession">New session</button>
      </div>
      <div class="agent-session-list">
        <button v-for="session in sessions" :key="session.id" type="button" class="agent-session"
          :class="{ active: session.id === selectedSession?.id }" @click="selectedSessionId = session.id">
          <span><strong>{{ session.title }}</strong><small>{{ checkouts.find((item) => item.id === session.checkoutId)?.branch ?? 'Missing checkout' }}</small></span>
          <span class="session-state" :class="runtimes[session.id]?.state">{{ runtimes[session.id]?.state ?? 'stopped' }}</span>
          <i v-if="runtimes[session.id]?.unread" title="Unread output" />
        </button>
        <p v-if="sessions.length === 0" class="empty-note">Create a session for Codex, Claude, or a custom CLI.</p>
      </div>
    </aside>

    <div v-if="selectedSession" class="agent-terminal-panel">
      <header class="agent-toolbar">
        <div><strong>{{ selectedSession.title }}</strong><span>{{ checkouts.find((item) => item.id === selectedSession.checkoutId)?.path }}</span></div>
        <div class="button-row">
          <button type="button" class="small primary" :disabled="selectedRuntime.state === 'running'" @click="start">Start</button>
          <button type="button" class="small" :disabled="selectedRuntime.state !== 'running'" @click="stop">Stop</button>
          <button type="button" class="small" @click="restart">Restart</button>
          <button type="button" class="small" @click="clear">Clear</button>
          <button type="button" class="small danger" :disabled="selectedRuntime.state === 'running'" @click="removeSession">Remove</button>
        </div>
      </header>
      <div class="agent-prompt-row">
        <input v-model="prompt" type="text" placeholder="Optional initial prompt for the next start" @keydown.enter="start" />
      </div>
      <p v-if="error" class="inline-error" role="alert">{{ error }}</p>
      <TerminalView ref="terminalRef" :task-id="selectedSession.id" :buffer="selectedBuffer"
        @input="window.exedeck.agents.input(selectedSession.id, $event)"
        @resize="window.exedeck.agents.resize(selectedSession.id, $event.cols, $event.rows)" />
    </div>
    <div v-else class="workspace-empty"><div class="empty-illustration">›_</div><h2>No agent session</h2><p>Create one to start a CLI in this project or one of its worktrees.</p></div>
  </section>
</template>
