import path from 'node:path'
import { promises as fs } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { parseArgs } from '../shared/commandArgs'
import type {
  AgentProfile,
  AppConfig,
  AppPreferences,
  ProjectConfig,
  ProjectFramework,
  TaskConfig,
  WorkspaceAgent,
  WorkspaceConfig,
  WorkspaceTerminal,
} from '../shared/types'

const CONFIG_FILE = 'exedeck.config.json'
export const CONFIG_SCHEMA_VERSION = 6
const MAX_PROJECTS = 100
const MAX_TASKS_PER_PROJECT = 200
const MAX_ARGS_PER_TASK = 512
const MAX_AGENT_PROFILES = 50
const MAX_WORKSPACES = 500
const MAX_ITEMS_PER_WORKSPACE = 200

function cleanString(value: unknown, fallback: string, maxLength: number): string {
  if (typeof value !== 'string') {
    return fallback
  }

  const cleaned = value.replace(/\0/g, '').trim()
  return (cleaned || fallback).slice(0, maxLength)
}

function makeId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

function toStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value
      .filter((item): item is string => typeof item === 'string')
      .slice(0, MAX_ARGS_PER_TASK)
      .map((item) => item.replace(/\0/g, '').slice(0, 4096))
  }

  if (typeof value === 'string') {
    return parseArgs(value)
      .slice(0, MAX_ARGS_PER_TASK)
      .map((item) => item.replace(/\0/g, '').slice(0, 4096))
  }

  return []
}

export function createDefaultAgentProfiles(): AgentProfile[] {
  return [
    {
      id: 'agent-profile-codex',
      name: 'Codex',
      tool: 'codex',
      command: 'codex',
      args: [],
      enabled: true,
    },
    {
      id: 'agent-profile-claude',
      name: 'Claude',
      tool: 'claude',
      command: 'claude',
      args: [],
      enabled: true,
    },
  ]
}

function normalizeAgentProfile(raw: unknown, index: number): AgentProfile {
  const source = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
  const tool = source.tool === 'codex' || source.tool === 'claude' || source.tool === 'custom' ? source.tool : 'custom'

  return {
    id: cleanString(source.id, makeId('agent-profile'), 128),
    name: cleanString(source.name, `Agent ${index + 1}`, 120),
    tool,
    command: cleanString(source.command, tool === 'custom' ? '' : tool, 2048),
    args: toStringArray(source.args),
    enabled: source.enabled !== false,
  }
}

function normalizeWorkspaceAgent(raw: unknown, profileIds: Set<string>, index: number): WorkspaceAgent | null {
  const source = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
  const profileId = cleanString(source.profileId, '', 128)
  if (!profileIds.has(profileId)) return null
  const createdAt =
    typeof source.createdAt === 'number' && Number.isFinite(source.createdAt)
      ? Math.max(0, Math.floor(source.createdAt))
      : Date.now()
  const resumeId = cleanString(source.resumeId, '', 256)

  return {
    id: cleanString(source.id, makeId('agent'), 128),
    profileId,
    name: cleanString(source.name, `Agent ${index + 1}`, 160),
    createdAt,
    ...(resumeId ? { resumeId } : {}),
  }
}

function normalizeWorkspaceTerminal(raw: unknown, index: number): WorkspaceTerminal {
  const source = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
  return {
    id: cleanString(source.id, makeId('terminal'), 128),
    name: cleanString(source.name, `Terminal ${index + 1}`, 160),
    command: cleanString(source.command, '', 2048),
    args: toStringArray(source.args),
    createdAt:
      typeof source.createdAt === 'number' && Number.isFinite(source.createdAt)
        ? Math.max(0, Math.floor(source.createdAt))
        : Date.now(),
  }
}

function rootWorkspace(project: ProjectConfig): WorkspaceConfig {
  return {
    id: `workspace-root-${project.id.slice(0, 100)}`,
    projectId: project.id,
    checkoutId: `${project.id}:root`,
    name: 'Root',
    kind: 'root',
    createdAt: 0,
    agents: [],
    terminals: [],
  }
}

function normalizeWorkspace(raw: unknown, projectIds: Set<string>, profileIds: Set<string>): WorkspaceConfig | null {
  const source = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
  const projectId = cleanString(source.projectId, '', 128)
  if (!projectIds.has(projectId)) return null
  const kind = source.kind === 'root' ? 'root' : 'worktree'
  const rawAgents = Array.isArray(source.agents) ? source.agents : []
  const rawTerminals = Array.isArray(source.terminals) ? source.terminals : []
  return {
    id: cleanString(source.id, makeId('workspace'), 128),
    projectId,
    checkoutId: cleanString(source.checkoutId, `${projectId}:root`, 256),
    name: cleanString(source.name, kind === 'root' ? 'Root' : 'Workspace', 160),
    kind,
    createdAt:
      typeof source.createdAt === 'number' && Number.isFinite(source.createdAt)
        ? Math.max(0, Math.floor(source.createdAt))
        : Date.now(),
    agents: rawAgents
      .slice(0, MAX_ITEMS_PER_WORKSPACE)
      .map((agent, index) => normalizeWorkspaceAgent(agent, profileIds, index))
      .filter((agent): agent is WorkspaceAgent => agent !== null),
    terminals: rawTerminals
      .slice(0, MAX_ITEMS_PER_WORKSPACE)
      .map((terminal, index) => normalizeWorkspaceTerminal(terminal, index)),
  }
}

function normalizePreferences(raw: unknown): AppPreferences {
  const source = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
  const appearance =
    source.appearance === 'light' || source.appearance === 'dark' || source.appearance === 'system'
      ? source.appearance
      : 'system'

  return {
    appearance,
    editorCommand: cleanString(source.editorCommand, '', 2048),
    cloneDirectory: cleanString(source.cloneDirectory, '', 4096),
    aiProfileId: cleanString(source.aiProfileId, 'agent-profile-codex', 128),
    lastWorkspaceId: cleanString(source.lastWorkspaceId, '', 128),
  }
}

function normalizeTask(raw: unknown, fallbackCwd: string, index: number): TaskConfig {
  const source = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}

  return {
    id: cleanString(source.id, makeId('task'), 128),
    name: cleanString(source.name, `Task ${index + 1}`, 120),
    command: cleanString(source.command, '', 2048),
    args: toStringArray(source.args),
    cwd: fallbackCwd,
    autoStart: source.autoStart === true,
  }
}

function normalizeProject(raw: unknown, repoRoot: string, index: number): ProjectConfig {
  const source = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
  const rawProjectPath = cleanString(source.path, repoRoot, 4096)
  const projectPath = path.resolve(repoRoot, rawProjectPath)
  const rawTasks = Array.isArray(source.tasks) ? source.tasks : []
  const framework: ProjectFramework =
    source.framework === 'laravel' || source.framework === 'adonisjs' || source.framework === 'custom'
      ? source.framework
      : 'custom'
  const rawBranchParents =
    source.branchParents && typeof source.branchParents === 'object'
      ? (source.branchParents as Record<string, unknown>)
      : {}
  const branchParents = Object.fromEntries(
    Object.entries(rawBranchParents)
      .filter(([branch, parent]) => branch.length <= 240 && typeof parent === 'string' && parent.length <= 240)
      .slice(0, 500)
      .map(([branch, parent]) => [branch.replace(/\0/g, ''), (parent as string).replace(/\0/g, '')]),
  )

  return {
    id: cleanString(source.id, makeId('project'), 128),
    name: cleanString(source.name, `Project ${index + 1}`, 120),
    path: projectPath,
    framework,
    autoStart: source.autoStart === true,
    tasks: rawTasks
      .slice(0, MAX_TASKS_PER_PROJECT)
      .map((task, taskIndex) => normalizeTask(task, projectPath, taskIndex)),
    branchParents,
  }
}

function ensureUniqueIds(config: AppConfig): AppConfig {
  const projectIds = new Set<string>()
  const taskIds = new Set<string>()
  const profileIds = new Set<string>()
  const workspaceIds = new Set<string>()
  const itemIds = new Set<string>()

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

  for (const profile of config.agentProfiles) {
    if (profileIds.has(profile.id)) {
      profile.id = makeId('agent-profile')
    }
    profileIds.add(profile.id)
  }

  for (const workspace of config.workspaces) {
    if (workspaceIds.has(workspace.id)) {
      workspace.id = makeId('workspace')
    }
    workspaceIds.add(workspace.id)
    for (const item of [...workspace.agents, ...workspace.terminals]) {
      if (itemIds.has(item.id)) item.id = makeId('workspace-item')
      itemIds.add(item.id)
    }
  }

  return config
}

export function createDefaultConfig(): AppConfig {
  return {
    schemaVersion: CONFIG_SCHEMA_VERSION,
    onboardingCompleted: false,
    projects: [],
    preferences: normalizePreferences(undefined),
    agentProfiles: createDefaultAgentProfiles(),
    workspaces: [],
  }
}

export function normalizeConfig(candidate: unknown, repoRoot: string): AppConfig {
  if (!candidate || typeof candidate !== 'object') {
    return createDefaultConfig()
  }

  const source = candidate as Record<string, unknown>
  const rawProjects = Array.isArray(source.projects) ? source.projects : []
  const projects = rawProjects
    .slice(0, MAX_PROJECTS)
    .map((project, index) => normalizeProject(project, repoRoot, index))

  const onboardingCompleted =
    typeof source.onboardingCompleted === 'boolean' ? source.onboardingCompleted : projects.length > 0

  const rawProfiles =
    Array.isArray(source.agentProfiles) && source.agentProfiles.length > 0
      ? source.agentProfiles
      : createDefaultAgentProfiles()
  const agentProfiles = rawProfiles.slice(0, MAX_AGENT_PROFILES).map(normalizeAgentProfile)
  const projectIds = new Set(projects.map((project) => project.id))
  const profileIds = new Set(agentProfiles.map((profile) => profile.id))
  const rawWorkspaces = Array.isArray(source.workspaces) ? source.workspaces : []
  const normalizedWorkspaces = rawWorkspaces
    .slice(0, MAX_WORKSPACES)
    .map((workspace) => normalizeWorkspace(workspace, projectIds, profileIds))
    .filter((workspace): workspace is WorkspaceConfig => workspace !== null)
  const workspaces = projects.flatMap((project) => {
    const projectWorkspaces = normalizedWorkspaces.filter((workspace) => workspace.projectId === project.id)
    const savedRoot = projectWorkspaces.find((workspace) => workspace.kind === 'root')
    const root = savedRoot
      ? { ...savedRoot, checkoutId: `${project.id}:root`, name: 'Root', kind: 'root' as const }
      : rootWorkspace(project)
    return [root, ...projectWorkspaces.filter((workspace) => workspace.kind === 'worktree')]
  })

  const config = ensureUniqueIds({
    schemaVersion: CONFIG_SCHEMA_VERSION,
    onboardingCompleted,
    projects,
    preferences: normalizePreferences(source.preferences),
    agentProfiles,
    workspaces,
  })

  if (!config.agentProfiles.some((profile) => profile.id === config.preferences.aiProfileId)) {
    config.preferences.aiProfileId = config.agentProfiles[0]?.id ?? ''
  }

  const lastWorkspace = config.workspaces.find((workspace) => workspace.id === config.preferences.lastWorkspaceId)
  if (!lastWorkspace) {
    config.preferences.lastWorkspaceId = config.workspaces[0]?.id ?? ''
  }

  return config
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
    try {
      const parsed = JSON.parse(raw) as unknown
      const normalized = normalizeConfig(parsed, repoRoot)
      await saveConfig(userDataDir, normalized)
      return normalized
    } catch (error) {
      if (!(error instanceof SyntaxError)) {
        throw error
      }

      const backupPath = `${configPath}.invalid-${Date.now()}`
      await fs.rename(configPath, backupPath)
    }
  } catch (error) {
    const code = error && typeof error === 'object' && 'code' in error ? error.code : undefined
    if (code !== 'ENOENT') {
      throw error
    }
  }

  const defaults = createDefaultConfig()
  await saveConfig(userDataDir, defaults)
  return defaults
}

export async function saveConfig(userDataDir: string, config: AppConfig): Promise<void> {
  const configPath = getConfigPath(userDataDir)
  const temporaryPath = `${configPath}.${process.pid}.${randomUUID()}.tmp`
  await fs.mkdir(userDataDir, { recursive: true })
  try {
    await fs.writeFile(temporaryPath, `${JSON.stringify(config, null, 2)}\n`, {
      encoding: 'utf8',
      mode: 0o600,
    })
    await fs.rename(temporaryPath, configPath)
  } finally {
    await fs.rm(temporaryPath, { force: true })
  }
}
