<script setup lang="ts">
import { computed, ref } from 'vue'
import type { AgentProfile, AgentRuntimeSnapshot, Checkout, WorkspaceAgent, WorkspaceConfig } from '../../shared/types'
import TerminalView from './TerminalView.vue'

const props = defineProps<{
  workspace: WorkspaceConfig
  agent: WorkspaceAgent
  profile?: AgentProfile
  checkout: Checkout | null
  runtime: AgentRuntimeSnapshot
  buffer: string
}>()

const emit = defineEmits<{
  start: [prompt?: string]
  stop: []
  restart: []
  input: [data: string]
  resize: [size: { cols: number; rows: number }]
  clear: []
  finish: []
  rebind: []
}>()

const prompt = ref('')
const terminalRef = ref<InstanceType<typeof TerminalView> | null>(null)
const running = computed(() => props.runtime.state === 'running' || props.runtime.state === 'starting')

function start(): void {
  emit('start', prompt.value.trim() || undefined)
  prompt.value = ''
}

function clear(): void {
  emit('clear')
  terminalRef.value?.clearTerminal()
}

defineExpose({ focusTerminal: () => terminalRef.value?.focusTerminal() })
</script>

<template>
  <section class="agent-surface">
    <header class="agent-surface-header">
      <div>
        <span class="panel-eyebrow">{{ profile?.name ?? 'Agent' }}</span>
        <h1>{{ agent.name }}</h1>
        <p v-if="checkout">{{ checkout.branch }} · {{ checkout.path }}</p>
      </div>
      <div class="button-row">
        <span class="running-pill" :class="{ active: running }">{{ runtime.state }}</span>
        <button type="button" class="small" @click="clear">Clear</button>
        <button v-if="running" type="button" class="small" @click="emit('restart')">Restart</button>
        <button v-if="running" type="button" class="small danger" @click="emit('stop')">Stop</button>
        <button type="button" class="small" @click="emit('finish')">Finish…</button>
      </div>
    </header>

    <div v-if="!checkout" class="missing-checkout" role="alert">
      <div>
        <strong>Checkout unavailable</strong>
        <p>This worktree may have been moved or deleted. Rebind it or archive the workspace.</p>
      </div>
      <button type="button" class="small primary" @click="emit('rebind')">Rebind checkout</button>
      <button type="button" class="small" @click="emit('finish')">Archive</button>
    </div>

    <div class="agent-terminal" :class="{ disabled: !checkout }">
      <TerminalView
        ref="terminalRef"
        :task-id="agent.id"
        :buffer="buffer"
        @input="emit('input', $event)"
        @resize="emit('resize', $event)"
      />
    </div>

    <slot name="task-panel" />

    <form class="agent-prompt-bar" @submit.prevent="start">
      <textarea
        v-model="prompt"
        :disabled="running || !checkout"
        rows="2"
        placeholder="Give the agent an initial task, or start without a prompt…"
        @keydown.ctrl.enter.prevent="start"
        @keydown.meta.enter.prevent="start"
      />
      <button type="submit" class="primary" :disabled="running || !checkout">
        {{ running ? 'Agent running' : 'Start agent' }}
      </button>
    </form>
  </section>
</template>
