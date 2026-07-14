<script setup lang="ts">
import { computed, ref } from 'vue'
import type { ProjectConfig, TaskConfig } from '../../shared/types'

const props = defineProps<{
  projects: ProjectConfig[]
  selectedProjectId: string
  selectedTaskId: string
  collapsedByProject: Record<string, boolean>
  filterText: string
  isRunning: (taskId: string) => boolean
  getStats: (taskId: string) => { cpu: number; memoryMb: number }
}>()

const emit = defineEmits<{
  selectProject: [projectId: string]
  selectTask: [projectId: string, taskId: string]
  start: [taskId: string]
  toggleProjectCollapsed: [projectId: string, collapsed: boolean]
  updateFilter: [value: string]
  openProjectSettings: [projectId: string]
  createProject: []
}>()

const formatCpu = (taskId: string): string => `${props.getStats(taskId).cpu.toFixed(1)}%`
const formatMem = (taskId: string): string => `${props.getStats(taskId).memoryMb.toFixed(0)} MB`
const searchRef = ref<HTMLInputElement | null>(null)

const isCollapsed = (projectId: string): boolean => props.collapsedByProject[projectId] === true

interface ProjectView {
  project: ProjectConfig
  tasks: TaskConfig[]
  runningCount: number
  collapsed: boolean
}

const projectViews = computed<ProjectView[]>(() => {
  const query = props.filterText.trim().toLowerCase()

  return props.projects.map((project) => {
    const projectMatches = project.name.toLowerCase().includes(query)
    const tasks = query && !projectMatches
      ? project.tasks.filter((task) => task.name.toLowerCase().includes(query))
      : project.tasks
    const runningCount = project.tasks.filter((task) => props.isRunning(task.id)).length

    return {
      project,
      tasks,
      runningCount,
      collapsed: isCollapsed(project.id),
    }
  }).filter((view) => !query || view.project.name.toLowerCase().includes(query) || view.tasks.length > 0)
})

const onToggleProject = (projectId: string): void => {
  emit('selectProject', projectId)
  emit('toggleProjectCollapsed', projectId, !isCollapsed(projectId))
}

function focusSearch(): void {
  searchRef.value?.focus()
  searchRef.value?.select()
}

defineExpose({ focusSearch })
</script>

<template>
  <aside class="sidebar" aria-label="Projects and tasks">
    <header class="sidebar-brand">
      <div class="app-mark" aria-hidden="true">E</div>
      <div>
        <strong>Exedeck</strong>
        <span>Process workspace</span>
      </div>
    </header>
    <div class="sidebar-controls">
      <div class="sidebar-search">
        <label class="sr-only" for="task-filter">Filter projects and tasks</label>
        <svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="8.5" cy="8.5" r="5" /><path d="m12.5 12.5 4 4" /></svg>
        <input
          id="task-filter"
          ref="searchRef"
          :value="filterText"
          type="search"
          placeholder="Filter projects and tasks"
          autocomplete="off"
          @input="emit('updateFilter', ($event.target as HTMLInputElement).value)"
        />
      </div>
      <div class="sidebar-actions">
        <button type="button" class="new-project-button" @click="emit('createProject')">
          <span class="new-project-icon" aria-hidden="true">
            <svg viewBox="0 0 20 20"><path d="M10 4v12M4 10h12" /></svg>
          </span>
          <span>New project</span>
          <span class="new-project-hint" aria-hidden="true">Create</span>
        </button>
      </div>
    </div>

    <nav class="sidebar-projects" aria-label="Project tasks">
      <section v-for="view in projectViews" :key="view.project.id" class="project-group">
        <div class="project-row" :class="{ active: view.project.id === selectedProjectId }">
          <button
            class="project-row-main"
            type="button"
            :aria-expanded="!view.collapsed"
            :aria-controls="`tasks-${view.project.id}`"
            @click="onToggleProject(view.project.id)"
          >
            <span class="chevron" aria-hidden="true">{{ view.collapsed ? '›' : '⌄' }}</span>
            <span class="project-identity">
              <span class="project-glyph" aria-hidden="true">
                <svg viewBox="0 0 20 20"><path d="M3.5 6.5h5l1.5 2h6.5v7h-13z" /><path d="M3.5 6.5V4.8h5.2l1.4 1.7" /></svg>
              </span>
              <span class="project-name">{{ view.project.name }}</span>
            </span>
            <span class="project-summary" :title="`${view.runningCount} of ${view.project.tasks.length} tasks running`">
              <span>{{ view.runningCount }}</span>/{{ view.project.tasks.length }}
            </span>
          </button>

          <button
            type="button"
            class="project-settings"
            :aria-label="`Open settings for ${view.project.name}`"
            :title="`Open settings for ${view.project.name}`"
            @click="emit('openProjectSettings', view.project.id)"
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path
                d="M9.6 3.2a1 1 0 0 1 1-.8h2.8a1 1 0 0 1 1 .8l.3 1.8a6.8 6.8 0 0 1 1.6.9l1.7-.7a1 1 0 0 1 1.2.4l1.4 2.4a1 1 0 0 1-.2 1.2l-1.3 1.1c.1.3.1.7.1 1s0 .7-.1 1l1.3 1.1a1 1 0 0 1 .2 1.2l-1.4 2.4a1 1 0 0 1-1.2.4l-1.7-.7a6.8 6.8 0 0 1-1.6.9l-.3 1.8a1 1 0 0 1-1 .8h-2.8a1 1 0 0 1-1-.8l-.3-1.8a6.8 6.8 0 0 1-1.6-.9l-1.7.7a1 1 0 0 1-1.2-.4L2.7 16a1 1 0 0 1 .2-1.2l1.3-1.1a8.5 8.5 0 0 1 0-2L2.9 10.6a1 1 0 0 1-.2-1.2l1.4-2.4a1 1 0 0 1 1.2-.4l1.7.7a6.8 6.8 0 0 1 1.6-.9z"
              />
              <circle cx="12" cy="12" r="2.6" />
            </svg>
          </button>
        </div>

        <div v-if="!view.collapsed" :id="`tasks-${view.project.id}`" class="task-list">
          <button
            v-for="task in view.tasks"
            :key="task.id"
            class="task-row"
            :class="{ selected: task.id === selectedTaskId }"
            type="button"
            :aria-current="task.id === selectedTaskId ? 'page' : undefined"
            @click="emit('selectTask', view.project.id, task.id)"
            @dblclick="emit('start', task.id)"
          >
            <span class="task-left">
              <span class="task-glyph" :class="{ running: isRunning(task.id) }" aria-hidden="true">
                <span>&gt;_</span>
                <i />
              </span>
              <span class="sr-only">{{ isRunning(task.id) ? 'Running' : 'Stopped' }}:</span>
              <span class="task-copy">
                <span class="task-name">{{ task.name }}</span>
                <span v-if="isRunning(task.id)" class="task-state">Running</span>
              </span>
            </span>
            <span v-if="isRunning(task.id)" class="task-right">
              <span class="metric" :aria-label="`CPU ${formatCpu(task.id)}`">{{ isRunning(task.id) ? formatCpu(task.id) : '—' }}</span>
              <span class="metric" :aria-label="`Memory ${formatMem(task.id)}`">{{ isRunning(task.id) ? formatMem(task.id) : '—' }}</span>
            </span>
            <span v-else class="task-disclosure" aria-hidden="true">›</span>
          </button>

          <p v-if="view.tasks.length === 0" class="empty-note">No matching tasks.</p>
        </div>
      </section>
      <p v-if="projectViews.length === 0" class="sidebar-empty">No projects or tasks match your filter.</p>
    </nav>
  </aside>
</template>
