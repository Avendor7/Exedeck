import path from 'node:path'
import { promises as fs } from 'node:fs'
import type { AppConfig, ProjectConfig, TaskConfig } from '../shared/types'

const CONFIG_FILE = 'exedeck.config.json'
export const CONFIG_SCHEMA_VERSION = 2

function makeId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

function toStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === 'string')
  }

  if (typeof value === 'string') {
    const trimmed = value.trim()
    return trimmed ? trimmed.split(/\s+/) : []
  }

  return []
}

function normalizeTask(raw: unknown, fallbackCwd: string, index: number): TaskConfig {
  const source = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}

  return {
    id: typeof source.id === 'string' ? source.id : makeId('task'),
    name: typeof source.name === 'string' ? source.name : `Task ${index + 1}`,
    command: typeof source.command === 'string' ? source.command : '',
    args: toStringArray(source.args),
    cwd: fallbackCwd,
    autoStart: source.autoStart === true,
  }
}

function normalizeProject(raw: unknown, repoRoot: string, index: number): ProjectConfig {
  const source = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
  const projectPath = typeof source.path === 'string' ? source.path : repoRoot
  const rawTasks = Array.isArray(source.tasks) ? source.tasks : []

  return {
    id: typeof source.id === 'string' ? source.id : makeId('project'),
    name: typeof source.name === 'string' ? source.name : `Project ${index + 1}`,
    path: projectPath,
    autoStart: source.autoStart === true,
    tasks: rawTasks.map((task, taskIndex) => normalizeTask(task, projectPath, taskIndex)),
  }
}

function ensureUniqueIds(config: AppConfig): AppConfig {
  const projectIds = new Set<string>()
  const taskIds = new Set<string>()

  for (const project of config.projects) {
    if (projectIds.has(project.id)) {
      project.id = makeId('project')
    }
    projectIds.add(project.id)

    for (const task of project.tasks) {
      if (taskIds.has(task.id)) {
        task.id = makeId('task')
      }
      taskIds.add(task.id)
    }
  }

  return config
}

export function createDefaultConfig(_repoRoot: string): AppConfig {
  return {
    schemaVersion: CONFIG_SCHEMA_VERSION,
    onboardingCompleted: false,
    projects: [],
  }
}

export function normalizeConfig(candidate: unknown, repoRoot: string): AppConfig {
  if (!candidate || typeof candidate !== 'object') {
    return createDefaultConfig(repoRoot)
  }

  const source = candidate as Record<string, unknown>
  const rawProjects = Array.isArray(source.projects) ? source.projects : []
  const projects = rawProjects.map((project, index) => normalizeProject(project, repoRoot, index))

  const onboardingCompleted =
    typeof source.onboardingCompleted === 'boolean' ? source.onboardingCompleted : projects.length > 0

  return ensureUniqueIds({
    schemaVersion: CONFIG_SCHEMA_VERSION,
    onboardingCompleted,
    projects,
  })
}

export function resolveRepoRoot(defaultCwd: string): string {
  return path.resolve(defaultCwd)
}

function getConfigPath(userDataDir: string): string {
  return path.join(userDataDir, CONFIG_FILE)
}

export async function loadOrCreateConfig(userDataDir: string, repoRoot: string): Promise<AppConfig> {
  const configPath = getConfigPath(userDataDir)

  try {
    const raw = await fs.readFile(configPath, 'utf8')
    const parsed = JSON.parse(raw) as unknown
    const normalized = normalizeConfig(parsed, repoRoot)
    await saveConfig(userDataDir, normalized)
    return normalized
  } catch {
    const defaults = createDefaultConfig(repoRoot)
    await saveConfig(userDataDir, defaults)
    return defaults
  }
}

export async function saveConfig(userDataDir: string, config: AppConfig): Promise<void> {
  const configPath = getConfigPath(userDataDir)
  await fs.mkdir(userDataDir, { recursive: true })
  await fs.writeFile(configPath, JSON.stringify(config, null, 2), 'utf8')
}
