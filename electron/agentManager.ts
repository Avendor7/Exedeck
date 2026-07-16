import { access } from 'node:fs/promises'
import { constants } from 'node:fs'
import path from 'node:path'
import type {
  AgentDataEvent,
  AgentExitEvent,
  AgentRuntimeSnapshot,
  AgentStatusEvent,
  AgentToolStatus,
  AppConfig,
  Checkout,
} from '../shared/types'
import { ProcessRuntimeManager } from './processRuntime'

interface AgentManagerOptions {
  getConfig: () => AppConfig
  resolveCheckout: (checkoutId: string) => Promise<Checkout | null>
  onData: (event: AgentDataEvent) => void
  onStatus: (event: AgentStatusEvent) => void
  onExit: (event: AgentExitEvent) => void
}

export class AgentManager {
  private readonly runtime: ProcessRuntimeManager
  private readonly unread = new Set<string>()
  private readonly crashed = new Set<string>()

  constructor(private readonly options: AgentManagerOptions) {
    this.runtime = new ProcessRuntimeManager({
      onData: (workspaceId, chunk) => {
        const wasUnread = this.unread.has(workspaceId)
        this.unread.add(workspaceId)
        options.onData({ workspaceId, chunk })
        if (!wasUnread) {
          options.onStatus({ workspaceId, state: 'running', unread: true })
        }
      },
      onStatus: (workspaceId, running) => {
        if (running) this.crashed.delete(workspaceId)
        options.onStatus({
          workspaceId,
          state: running ? 'running' : this.crashed.has(workspaceId) ? 'crashed' : 'stopped',
          unread: this.unread.has(workspaceId),
        })
      },
      onExit: ({ processId, exitCode, signal }) => {
        if (exitCode !== 0) this.crashed.add(processId)
        options.onExit({ workspaceId: processId, exitCode, signal })
        options.onStatus({
          workspaceId: processId,
          state: exitCode === 0 ? 'stopped' : 'crashed',
          unread: this.unread.has(processId),
        })
      },
    })
  }

  async start(workspaceId: string, prompt?: string): Promise<boolean> {
    const resolved = await this.resolveWorkspace(workspaceId)
    if (!resolved) return false
    const args = [...resolved.profile.args]
    if (resolved.workspace.resumeId) {
      if (resolved.profile.tool === 'codex') args.push('resume', resolved.workspace.resumeId)
      if (resolved.profile.tool === 'claude') args.push('--resume', resolved.workspace.resumeId)
    }
    if (prompt?.trim()) args.push(prompt.trim().slice(0, 32_000))
    this.options.onStatus({ workspaceId, state: 'starting', unread: false })
    this.unread.delete(workspaceId)
    return this.runtime.start({
      id: workspaceId,
      name: resolved.workspace.title,
      command: resolved.profile.command,
      args,
      cwd: resolved.checkout.path,
    })
  }

  stop(workspaceId: string): Promise<boolean> {
    return this.runtime.stop(workspaceId)
  }

  async restart(workspaceId: string): Promise<boolean> {
    if (!(await this.stop(workspaceId))) return false
    return this.start(workspaceId)
  }

  input(workspaceId: string, data: string): boolean {
    return this.runtime.input(workspaceId, data)
  }

  async resize(workspaceId: string, cols: number, rows: number): Promise<boolean> {
    const resolved = await this.resolveWorkspace(workspaceId)
    if (!resolved) return false
    this.runtime.ensure({
      id: workspaceId,
      name: resolved.workspace.title,
      command: resolved.profile.command,
      args: resolved.profile.args,
      cwd: resolved.checkout.path,
    })
    return this.runtime.resize(workspaceId, cols, rows)
  }

  getBuffer(workspaceId: string): string {
    return this.runtime.getBuffer(workspaceId)
  }
  clearBuffer(workspaceId: string): boolean {
    return this.runtime.clearBuffer(workspaceId)
  }

  markRead(workspaceId: string): boolean {
    this.unread.delete(workspaceId)
    const snapshot = this.getStatus(workspaceId)
    this.options.onStatus({ workspaceId, state: snapshot.state, unread: false })
    return true
  }

  getStatus(workspaceId: string): AgentRuntimeSnapshot {
    const status = this.runtime.getStatus(workspaceId)
    return {
      state: status.running ? 'running' : this.crashed.has(workspaceId) ? 'crashed' : 'stopped',
      unread: this.unread.has(workspaceId),
      ...(status.pid ? { pid: status.pid } : {}),
    }
  }

  getStatuses(): Record<string, AgentRuntimeSnapshot> {
    return Object.fromEntries(
      this.options.getConfig().agentWorkspaces.map((workspace) => [workspace.id, this.getStatus(workspace.id)]),
    )
  }

  isCheckoutBusy(checkoutId: string): boolean {
    return this.options
      .getConfig()
      .agentWorkspaces.some((workspace) => workspace.checkoutId === checkoutId && this.runtime.isRunning(workspace.id))
  }

  async discoverTools(): Promise<AgentToolStatus[]> {
    return Promise.all(
      this.options.getConfig().agentProfiles.map(async (profile) => {
        const resolvedPath = await findExecutable(profile.command)
        return {
          profileId: profile.id,
          command: profile.command,
          installed: resolvedPath !== null,
          ...(resolvedPath ? { resolvedPath } : {}),
        }
      }),
    )
  }

  async reconcileConfig(nextConfig: AppConfig): Promise<void> {
    const currentConfig = this.options.getConfig()
    const nextWorkspaces = new Map(nextConfig.agentWorkspaces.map((workspace) => [workspace.id, workspace]))
    const currentWorkspaces = new Map(currentConfig.agentWorkspaces.map((workspace) => [workspace.id, workspace]))
    const currentProfiles = new Map(currentConfig.agentProfiles.map((profile) => [profile.id, profile]))
    const nextProfiles = new Map(nextConfig.agentProfiles.map((profile) => [profile.id, profile]))
    const currentProjects = new Map(currentConfig.projects.map((project) => [project.id, project]))
    const nextProjects = new Map(nextConfig.projects.map((project) => [project.id, project]))

    const toStop = this.runtime.listRunningIds().filter((id) => {
      const currentWorkspace = currentWorkspaces.get(id)
      const nextWorkspace = nextWorkspaces.get(id)
      if (!currentWorkspace || !nextWorkspace || nextWorkspace.archivedAt) return true

      const currentProfile = currentProfiles.get(currentWorkspace.profileId)
      const nextProfile = nextProfiles.get(nextWorkspace.profileId)
      const projectPathChanged =
        currentProjects.get(currentWorkspace.projectId)?.path !== nextProjects.get(nextWorkspace.projectId)?.path

      return (
        !currentProfile ||
        !nextProfile ||
        !nextProfile.enabled ||
        projectPathChanged ||
        currentWorkspace.projectId !== nextWorkspace.projectId ||
        currentWorkspace.checkoutId !== nextWorkspace.checkoutId ||
        currentWorkspace.profileId !== nextWorkspace.profileId ||
        currentProfile.command !== nextProfile.command ||
        currentProfile.args.join('\0') !== nextProfile.args.join('\0')
      )
    })

    await Promise.all(toStop.map((id) => this.stop(id)))
    for (const id of this.runtime.listIds()) {
      if (!nextWorkspaces.has(id)) {
        this.runtime.forget(id)
        this.unread.delete(id)
        this.crashed.delete(id)
      }
    }
  }

  stopAll(): Promise<void> {
    return this.runtime.stopAll()
  }
  killAllImmediately(): void {
    this.runtime.killAllImmediately()
  }

  private async resolveWorkspace(workspaceId: string) {
    const workspace = this.options.getConfig().agentWorkspaces.find((item) => item.id === workspaceId)
    if (!workspace || workspace.archivedAt) return null
    const profile = this.options.getConfig().agentProfiles.find((item) => item.id === workspace.profileId)
    if (!profile?.enabled || !profile.command) return null
    const checkout = await this.options.resolveCheckout(workspace.checkoutId)
    if (!checkout || checkout.projectId !== workspace.projectId) return null
    return { workspace, profile, checkout }
  }
}

async function findExecutable(command: string): Promise<string | null> {
  if (!command.trim() || command.includes('\0')) return null
  const accessMode = process.platform === 'win32' ? constants.F_OK : constants.X_OK
  if (path.isAbsolute(command) || /[/\\]/.test(command)) {
    try {
      await access(command, accessMode)
      return path.resolve(command)
    } catch {
      return null
    }
  }
  const extensions = process.platform === 'win32' ? (process.env.PATHEXT ?? '.EXE;.CMD;.BAT').split(';') : ['']
  for (const directory of (process.env.PATH ?? '').split(path.delimiter)) {
    for (const extension of extensions) {
      const candidate = path.join(directory, `${command}${extension}`)
      try {
        await access(candidate, accessMode)
        return candidate
      } catch {
        // Keep searching PATH.
      }
    }
  }
  return null
}
