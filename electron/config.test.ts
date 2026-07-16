import { mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { CONFIG_SCHEMA_VERSION, createDefaultConfig, loadOrCreateConfig, normalizeConfig, saveConfig } from './config'

describe('configuration persistence', () => {
  it('normalizes paths, duplicate IDs, and task working directories', () => {
    const root = path.resolve('/tmp/exedeck-root')
    const normalized = normalizeConfig(
      {
        projects: [
          {
            id: 'same',
            name: ' First ',
            path: '.',
            tasks: [{ id: 'task', name: 'Dev', command: 'npm', args: ['run', 'dev'] }],
          },
          {
            id: 'same',
            name: 'Second',
            path: root,
            tasks: [{ id: 'task', name: 'Worker', command: 'node' }],
          },
        ],
      },
      root,
    )

    expect(normalized.schemaVersion).toBe(CONFIG_SCHEMA_VERSION)
    expect(normalized.projects[0].path).toBe(root)
    expect(normalized.projects[0].tasks[0].cwd).toBe(normalized.projects[0].path)
    expect(normalized.projects[1].id).not.toBe(normalized.projects[0].id)
    expect(normalized.projects[1].tasks[0].id).not.toBe(normalized.projects[0].tasks[0].id)
  })

  it('backs up malformed JSON instead of silently destroying it', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'exedeck-config-'))
    await writeFile(path.join(directory, 'exedeck.config.json'), '{not-json', 'utf8')

    const loaded = await loadOrCreateConfig(directory, directory)
    const files = await readdir(directory)

    expect(loaded).toEqual(createDefaultConfig())
    expect(files.some((file) => file.startsWith('exedeck.config.json.invalid-'))).toBe(true)
  })

  it('writes complete JSON that can be read back', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'exedeck-config-'))
    const config = createDefaultConfig()
    await saveConfig(directory, config)

    const stored = JSON.parse(await readFile(path.join(directory, 'exedeck.config.json'), 'utf8'))
    expect(stored).toEqual(config)
    expect((await readdir(directory)).some((file) => file.endsWith('.tmp'))).toBe(false)
  })

  it('normalizes development configuration to the current schema', () => {
    const root = path.resolve('/tmp/exedeck-migration')
    const migrated = normalizeConfig(
      {
        schemaVersion: 3,
        onboardingCompleted: true,
        projects: [
          {
            id: 'project-existing',
            name: 'Existing project',
            path: root,
            tasks: [{ id: 'task-existing', name: 'Dev', command: 'npm', args: ['run', 'dev'] }],
          },
        ],
      },
      root,
    )

    expect(migrated.schemaVersion).toBe(5)
    expect(migrated.projects[0].id).toBe('project-existing')
    expect(migrated.projects[0].tasks[0].id).toBe('task-existing')
    expect(migrated.agentProfiles.map((profile) => profile.tool)).toEqual(['codex', 'claude'])
    expect(migrated.preferences.appearance).toBe('system')
    expect(migrated.agentWorkspaces).toEqual([])
  })

  it('preserves quoted arguments from legacy string configuration', () => {
    const root = path.resolve('/tmp/exedeck-args-migration')
    const migrated = normalizeConfig(
      {
        projects: [
          {
            id: 'project-existing',
            path: root,
            tasks: [
              {
                id: 'task-existing',
                command: 'node',
                args: '--title "hello world" ""',
              },
            ],
          },
        ],
      },
      root,
    )

    expect(migrated.projects[0].tasks[0].args).toEqual(['--title', 'hello world', ''])
  })
})
