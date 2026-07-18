<script setup lang="ts">
import { computed, ref } from 'vue'
import type { AgentRuntimeSnapshot, ProjectConfig, TaskRuntimeSnapshot, WorkspaceConfig } from '../../shared/types'
import type { WorkspaceItemKind } from '../state/store'
import AppIcon from './AppIcon.vue'
import UiIconButton from './ui/UiIconButton.vue'

const props = defineProps<{
  projects: ProjectConfig[]
  workspaces: WorkspaceConfig[]
  selectedProjectId: string
  selectedWorkspaceId: string
  selectedItemKind: WorkspaceItemKind
  selectedItemId: string
  filterText: string
  getAgentRuntime: (agentId: string) => AgentRuntimeSnapshot
  getTaskRuntime: (itemId: string) => TaskRuntimeSnapshot
}>()

const emit = defineEmits<{
  selectProject: [projectId: string]
  selectWorkspace: [workspaceId: string]
  selectItem: [kind: 'git' | 'agent' | 'terminal' | 'task', id: string]
  updateFilter: [value: string]
  openProjectSettings: [projectId: string]
  createWorkspace: [projectId: string]
  createAgent: [workspaceId: string]
  createTerminal: [workspaceId: string]
  removeWorkspace: [workspaceId: string]
  removeItem: [kind: 'agent' | 'terminal', id: string]
  createProject: []
  cloneProject: []
}>()

const searchRef = ref<HTMLInputElement | null>(null)
const query = computed(() => props.filterText.trim().toLowerCase())
const visibleProjects = computed(() =>
  props.projects.filter((project) => {
    if (!query.value) return true
    const workspaces = props.workspaces.filter((workspace) => workspace.projectId === project.id)
    return (
      project.name.toLowerCase().includes(query.value) ||
      project.tasks.some((task) => task.name.toLowerCase().includes(query.value)) ||
      workspaces.some(
        (workspace) =>
          workspace.name.toLowerCase().includes(query.value) ||
          workspace.agents.some((agent) => agent.name.toLowerCase().includes(query.value)) ||
          workspace.terminals.some((terminal) => terminal.name.toLowerCase().includes(query.value)),
      )
    )
  }),
)
const workspacesFor = (projectId: string) => props.workspaces.filter((item) => item.projectId === projectId)

function selectTask(workspaceId: string, taskId: string): void {
  emit('selectWorkspace', workspaceId)
  emit('selectItem', 'task', taskId)
}

function selectNestedItem(workspaceId: string, kind: 'git' | 'agent' | 'terminal', itemId: string): void {
  emit('selectWorkspace', workspaceId)
  emit('selectItem', kind, itemId)
}

defineExpose({ focusSearch: () => searchRef.value?.focus() })
</script>

<template>
  <aside class="sidebar workspace-sidebar" aria-label="Projects and workspaces">
    <header class="sidebar-header">
      <div>
        <span class="panel-eyebrow">Navigator</span>
        <h2>Projects</h2>
      </div>
      <UiIconButton
        label="New worktree workspace"
        variant="primary"
        title="New worktree workspace"
        :disabled="!selectedProjectId"
        @click="selectedProjectId && emit('createWorkspace', selectedProjectId)"
      >
        <AppIcon name="plus" />
      </UiIconButton>
    </header>
    <div class="sidebar-search">
      <AppIcon name="search" />
      <input
        ref="searchRef"
        :value="filterText"
        type="search"
        placeholder="Filter projects…"
        aria-label="Filter projects and workspace items"
        @input="emit('updateFilter', ($event.target as HTMLInputElement).value)"
      />
    </div>

    <nav class="workspace-tree" aria-label="Workspace tree">
      <section v-for="project in visibleProjects" :key="project.id" class="workspace-project-group">
        <div
          class="workspace-project-row"
          :class="{ active: selectedProjectId === project.id && !selectedWorkspaceId }"
        >
          <button type="button" @click="emit('selectProject', project.id)">
            <span class="project-glyph">{{ project.name.slice(0, 1).toUpperCase() }}</span>
            <span
              ><strong>{{ project.name }}</strong
              ><small>{{ project.path }}</small></span
            >
          </button>
          <UiIconButton label="Project settings" @click="emit('openProjectSettings', project.id)">
            <AppIcon name="more" />
          </UiIconButton>
        </div>

        <div v-for="workspace in workspacesFor(project.id)" :key="workspace.id" class="workspace-branch">
          <div
            class="workspace-node"
            :class="{ active: selectedWorkspaceId === workspace.id && selectedItemKind === 'workspace' }"
          >
            <button type="button" class="workspace-node-main" @click="emit('selectWorkspace', workspace.id)">
              <span class="workspace-glyph">
                <AppIcon :name="workspace.kind === 'root' ? 'home' : 'git-branch'" />
              </span>
              <span
                ><strong>{{ workspace.name }}</strong
                ><small>{{ workspace.kind === 'root' ? 'project checkout' : 'worktree' }}</small></span
              >
            </button>
            <div class="workspace-node-actions">
              <button
                type="button"
                title="Add agent"
                :aria-label="`Add agent to ${workspace.name}`"
                @click="emit('createAgent', workspace.id)"
              >
                <AppIcon name="bot" />
              </button>
              <button
                type="button"
                title="Add terminal"
                :aria-label="`Add terminal to ${workspace.name}`"
                @click="emit('createTerminal', workspace.id)"
              >
                <AppIcon name="terminal" />
              </button>
              <button
                v-if="workspace.kind === 'worktree'"
                type="button"
                class="danger-icon"
                title="Remove workspace"
                :aria-label="`Remove ${workspace.name}`"
                @click="emit('removeWorkspace', workspace.id)"
              >
                <AppIcon name="trash" />
              </button>
            </div>
          </div>

          <div class="workspace-children">
            <button
              type="button"
              class="workspace-item"
              :class="{
                active:
                  selectedWorkspaceId === workspace.id && selectedItemKind === 'git' && selectedItemId === workspace.id,
              }"
              @click="selectNestedItem(workspace.id, 'git', workspace.id)"
            >
              <span class="workspace-item-icon"><AppIcon name="git-branch" /></span>
              <span><strong>Git</strong><small>changes, commits, and branches</small></span>
            </button>
            <div v-for="agent in workspace.agents" :key="agent.id" class="workspace-item-wrap">
              <button
                type="button"
                class="workspace-item"
                :class="{ active: selectedItemKind === 'agent' && selectedItemId === agent.id }"
                @click="selectNestedItem(workspace.id, 'agent', agent.id)"
              >
                <span class="status-dot" :class="{ running: getAgentRuntime(agent.id).state === 'running' }" />
                <span
                  ><strong>{{ agent.name }}</strong
                  ><small>agent · {{ getAgentRuntime(agent.id).state }}</small></span
                >
              </button>
              <button
                class="tree-remove"
                type="button"
                :aria-label="`Remove ${agent.name}`"
                @click="emit('removeItem', 'agent', agent.id)"
              >
                <AppIcon name="trash" />
              </button>
            </div>
            <div v-for="terminal in workspace.terminals" :key="terminal.id" class="workspace-item-wrap">
              <button
                type="button"
                class="workspace-item"
                :class="{ active: selectedItemKind === 'terminal' && selectedItemId === terminal.id }"
                @click="selectNestedItem(workspace.id, 'terminal', terminal.id)"
              >
                <span class="status-dot" :class="{ running: getTaskRuntime(terminal.id).running }" />
                <span
                  ><strong>{{ terminal.name }}</strong
                  ><small>terminal · {{ getTaskRuntime(terminal.id).running ? 'running' : 'stopped' }}</small></span
                >
              </button>
              <button
                class="tree-remove"
                type="button"
                :aria-label="`Remove ${terminal.name}`"
                @click="emit('removeItem', 'terminal', terminal.id)"
              >
                <AppIcon name="trash" />
              </button>
            </div>
            <button
              v-for="task in project.tasks"
              :key="`${workspace.id}:${task.id}`"
              type="button"
              class="workspace-item"
              :class="{
                active:
                  selectedWorkspaceId === workspace.id && selectedItemKind === 'task' && selectedItemId === task.id,
              }"
              @click="selectTask(workspace.id, task.id)"
            >
              <span class="status-dot" :class="{ running: getTaskRuntime(task.id).running }" />
              <span
                ><strong>{{ task.name }}</strong
                ><small>task · {{ getTaskRuntime(task.id).running ? 'running' : 'stopped' }}</small></span
              >
            </button>
            <p
              v-if="!workspace.agents.length && !workspace.terminals.length && !project.tasks.length"
              class="workspace-empty"
            >
              Add an agent or terminal
            </p>
          </div>
        </div>
      </section>
    </nav>

    <footer class="sidebar-actions">
      <button type="button" @click="emit('createProject')"><AppIcon name="plus" />New application</button>
      <button type="button" @click="emit('cloneProject')"><AppIcon name="git-clone" />Clone repository</button>
    </footer>
  </aside>
</template>
