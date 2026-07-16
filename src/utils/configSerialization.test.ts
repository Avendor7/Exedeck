import { isProxy, reactive } from 'vue'
import { describe, expect, it } from 'vitest'
import type { AppConfig } from '../../shared/types'
import { prepareConfigForIpc } from './configSerialization'

describe('config IPC serialization', () => {
  it('converts nested Vue proxies into structured-cloneable data', () => {
    const config = reactive<AppConfig>({
      schemaVersion: 1,
      onboardingCompleted: true,
      projects: [
        {
          id: 'project-1',
          name: 'Example',
          path: '/projects/example',
          framework: 'custom',
          autoStart: false,
          tasks: [
            {
              id: 'task-1',
              name: 'Dev server',
              command: 'npm',
              args: ['run', 'dev'],
              cwd: '/projects/example',
              autoStart: true,
            },
          ],
        },
      ],
      preferences: {
        appearance: 'system',
        editorCommand: 'code',
        cloneDirectory: '/projects',
        aiProfileId: '',
        lastWorkspaceId: '',
      },
      agentProfiles: [],
      workspaces: [],
    })

    expect(isProxy(config.preferences)).toBe(true)

    const prepared = prepareConfigForIpc(config)

    expect(isProxy(prepared)).toBe(false)
    expect(isProxy(prepared.preferences)).toBe(false)
    expect(() => structuredClone(prepared)).not.toThrow()
    expect(prepared).toEqual(config)
  })
})
