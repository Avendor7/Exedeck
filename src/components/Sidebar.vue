<script setup lang="ts">
import { computed, ref } from 'vue'
import type { AgentRuntimeSnapshot, AgentWorkspace, ProjectConfig } from '../../shared/types'

const props = defineProps<{
  projects: ProjectConfig[]
  workspaces: AgentWorkspace[]
  selectedProjectId: string
  selectedWorkspaceId: string
  filterText: string
  getAgentRuntime: (workspaceId: string) => AgentRuntimeSnapshot
}>()

const emit = defineEmits<{
  selectProject: [projectId: string]
  selectWorkspace: [workspaceId: string]
  updateFilter: [value: string]
  openProjectSettings: [projectId: string]
  createWorkspace: []
  createProject: []
  cloneProject: []
}>()

const searchRef = ref<HTMLInputElement | null>(null)
const archivedOpen = ref(false)
const query = computed(() => props.filterText.trim().toLowerCase())
const visibleProjects = computed(() =>
  props.projects.filter((project) => {
    if (!query.value) return true
    return (
      project.name.toLowerCase().includes(query.value) ||
      props.workspaces.some(
        (workspace) => workspace.projectId === project.id && workspace.title.toLowerCase().includes(query.value),
      )
    )
  }),
)
const activeFor = (projectId: string) =>
  props.workspaces.filter((workspace) => workspace.projectId === projectId && !workspace.archivedAt)
const archived = computed(() => props.workspaces.filter((workspace) => workspace.archivedAt))
const projectName = (projectId: string) => props.projects.find((project) => project.id === projectId)?.name ?? 'Project'

defineExpose({ focusSearch: () => searchRef.value?.focus() })
</script>

<template>
  <aside class="sidebar workspace-sidebar" aria-label="Projects and agent workspaces">
    <header class="sidebar-header">
      <div>
        <span class="panel-eyebrow">Navigator</span>
        <h2>Workspaces</h2>
      </div>
      <button
        type="button"
        class="small primary"
        aria-label="New agent workspace"
        title="New agent workspace"
        :disabled="!selectedProjectId"
        @click="selectedProjectId && emit('createWorkspace')"
      >
        +
      </button>
    </header>
    <div class="sidebar-search">
      <input
        ref="searchRef"
        :value="filterText"
        type="search"
        placeholder="Filter projects…"
        aria-label="Filter projects and workspaces"
        @input="emit('updateFilter', ($event.target as HTMLInputElement).value)"
      />
    </div>

    <nav class="workspace-tree" aria-label="Agent workspaces">
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
          <button
            type="button"
            class="icon-button"
            aria-label="Project settings"
            @click="emit('openProjectSettings', project.id)"
          >
            •••
          </button>
        </div>
        <button
          v-for="workspace in activeFor(project.id)"
          :key="workspace.id"
          type="button"
          class="workspace-tree-item"
          :class="{ active: selectedWorkspaceId === workspace.id }"
          @click="emit('selectWorkspace', workspace.id)"
        >
          <span class="status-dot" :class="{ running: getAgentRuntime(workspace.id).state === 'running' }" />
          <span
            ><strong>{{ workspace.title }}</strong
            ><small>{{ getAgentRuntime(workspace.id).state }}</small></span
          >
          <span v-if="getAgentRuntime(workspace.id).unread" class="unread-dot" aria-label="Unread output" />
        </button>
        <button
          v-if="activeFor(project.id).length === 0"
          type="button"
          class="task-only-project"
          @click="emit('selectProject', project.id)"
        >
          {{ project.tasks.length ? `${project.tasks.length} project tasks` : 'Project landing page' }}
        </button>
      </section>
    </nav>

    <section v-if="archived.length" class="archived-workspaces">
      <button type="button" class="archived-toggle" :aria-expanded="archivedOpen" @click="archivedOpen = !archivedOpen">
        <span>{{ archivedOpen ? '▾' : '▸' }} Archived</span><span>{{ archived.length }}</span>
      </button>
      <div v-if="archivedOpen">
        <div v-for="workspace in archived" :key="workspace.id" class="archived-item">
          <span>{{ workspace.title }}</span
          ><small>{{ projectName(workspace.projectId) }}</small>
        </div>
      </div>
    </section>

    <footer class="sidebar-actions">
      <button type="button" @click="emit('createProject')">New application</button>
      <button type="button" @click="emit('cloneProject')">Clone repository</button>
    </footer>
  </aside>
</template>
