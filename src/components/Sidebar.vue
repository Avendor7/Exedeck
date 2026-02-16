<script setup lang="ts">
import { computed } from 'vue'
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
}>()

const formatCpu = (taskId: string): string => `${props.getStats(taskId).cpu.toFixed(1)}%`
const formatMem = (taskId: string): string => `${props.getStats(taskId).memoryMb.toFixed(0)} MB`

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
    const tasks = query ? project.tasks.filter((task) => task.name.toLowerCase().includes(query)) : project.tasks
    const runningCount = project.tasks.filter((task) => props.isRunning(task.id)).length

    return {
      project,
      tasks,
      runningCount,
      collapsed: isCollapsed(project.id),
    }
  })
})

const onToggleProject = (projectId: string): void => {
  emit('selectProject', projectId)
  emit('toggleProjectCollapsed', projectId, !isCollapsed(projectId))
}
</script>

<template>
  <aside class="sidebar">
    <div class="sidebar-search">
      <input
        :value="filterText"
        type="text"
        placeholder="Filter processes..."
        @input="emit('updateFilter', ($event.target as HTMLInputElement).value)"
      />
    </div>

    <div class="sidebar-projects">
      <section v-for="view in projectViews" :key="view.project.id" class="project-group">
        <div class="project-row" :class="{ active: view.project.id === selectedProjectId }">
          <button
            class="project-row-main"
            type="button"
            @click="onToggleProject(view.project.id)"
          >
            <span class="chevron">{{ view.collapsed ? '▸' : '▾' }}</span>
            <span class="project-name">{{ view.project.name }}</span>
            <span class="project-summary">{{ view.runningCount }}/{{ view.project.tasks.length }}</span>
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

        <div v-if="!view.collapsed" class="task-list">
          <button
            v-for="task in view.tasks"
            :key="task.id"
            class="task-row"
            :class="{ selected: task.id === selectedTaskId }"
            type="button"
            @click="emit('selectTask', view.project.id, task.id)"
            @dblclick="emit('start', task.id)"
          >
            <span class="task-left">
              <span class="status-dot" :class="{ running: isRunning(task.id) }" />
              <span class="task-name">{{ task.name }}</span>
            </span>
            <span class="task-right">
              <span class="metric">{{ formatCpu(task.id) }}</span>
              <span class="metric">{{ formatMem(task.id) }}</span>
            </span>
          </button>

          <p v-if="view.tasks.length === 0" class="empty-note">No matching tasks.</p>
        </div>
      </section>
    </div>
  </aside>
</template>
