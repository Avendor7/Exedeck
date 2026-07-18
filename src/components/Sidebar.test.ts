// @vitest-environment happy-dom

import { mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import type { ProjectConfig } from '../../shared/types'
import Sidebar from './Sidebar.vue'

const project: ProjectConfig = {
  id: 'project-one',
  name: 'Example project',
  path: '/example',
  framework: 'custom',
  autoStart: false,
  tasks: [
    {
      id: 'task-dev',
      name: 'Development server',
      command: 'npm',
      args: ['run', 'dev'],
      cwd: '/example',
      autoStart: false,
    },
  ],
}

function mountSidebar(filterText = '') {
  return mount(Sidebar, {
    attachTo: document.body,
    props: {
      projects: [project],
      workspaces: [],
      selectedProjectId: project.id,
      selectedWorkspaceId: '',
      selectedItemKind: 'workspace',
      selectedItemId: '',
      filterText,
      getAgentRuntime: vi.fn(() => ({ state: 'stopped' as const, unread: false })),
      getTaskRuntime: vi.fn(() => ({ running: false })),
    },
  })
}

function mountSidebarWithWorkspace() {
  return mount(Sidebar, {
    attachTo: document.body,
    props: {
      projects: [project],
      workspaces: [
        {
          id: 'workspace-root',
          projectId: project.id,
          checkoutId: `${project.id}:root`,
          kind: 'root' as const,
          name: 'Root',
          agents: [],
          terminals: [],
          createdAt: 1,
        },
      ],
      selectedProjectId: project.id,
      selectedWorkspaceId: 'workspace-root',
      selectedItemKind: 'workspace',
      selectedItemId: '',
      filterText: '',
      getAgentRuntime: vi.fn(() => ({ state: 'stopped' as const, unread: false })),
      getTaskRuntime: vi.fn(() => ({ running: false })),
    },
  })
}

describe('Sidebar', () => {
  it('emits the project identifier when its landing page is selected', async () => {
    const wrapper = mountSidebar()
    await wrapper.get('.workspace-project-row > button').trigger('click')

    expect(wrapper.emitted('selectProject')).toEqual([['project-one']])
  })

  it('filters projects without mutating their task definitions', () => {
    const wrapper = mountSidebar('not present')

    expect(wrapper.find('.workspace-project-group').exists()).toBe(false)
    expect(project.tasks).toHaveLength(1)
  })

  it('exposes keyboard search focus to the application shell', () => {
    const wrapper = mountSidebar()
    wrapper.vm.focusSearch()

    expect(document.activeElement).toBe(wrapper.get('input[type="search"]').element)
  })

  it('offers Git as a workspace item in the main navigation', async () => {
    const wrapper = mountSidebarWithWorkspace()
    await wrapper.get('.workspace-item').trigger('click')

    expect(wrapper.emitted('selectWorkspace')).toEqual([['workspace-root']])
    expect(wrapper.emitted('selectItem')).toEqual([['git', 'workspace-root']])
  })
})
