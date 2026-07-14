import { access } from 'node:fs/promises'
import path from 'node:path'
import type {
  AgentDataEvent,
  AgentExitEvent,
  AgentRuntimeSnapshot,
  AgentSession,
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
      onData: (sessionId, chunk) => {
        this.unread.add(sessionId)
        options.onData({ sessionId, chunk })
        options.onStatus({ sessionId, state: 'running', unread: true })
      },
      onStatus: (sessionId, running) => {
        if (running) this.crashed.delete(sessionId)
        options.onStatus({
          sessionId,
          state: running ? 'running' : this.crashed.has(sessionId) ? 'crashed' : 'stopped',
          unread: this.unread.has(sessionId),
        })
      },
      onExit: ({ processId, exitCode, signal }) => {
        if (exitCode !== 0) this.crashed.add(processId)
        options.onExit({ sessionId: processId, exitCode, signal })
        options.onStatus({
          sessionId: processId,
          state: exitCode === 0 ? 'stopped' : 'crashed',
          unread: this.unread.has(processId),
        })
      },
    })
  }

  async start(sessionId: string, prompt?: string): Promise<boolean> {
    const resolved = await this.resolveSession(sessionId)
    if (!resolved) return false
    const args = [...resolved.profile.args]
    if (resolved.session.resumeId) {
      if (resolved.profile.tool === 'codex') args.push('resume', resolved.session.resumeId)
      if (resolved.profile.tool === 'claude') args.push('--resume', resolved.session.resumeId)
    }
    if (prompt?.trim()) args.push(prompt.trim().slice(0, 32_000))
    this.options.onStatus({ sessionId, state: 'starting', unread: false })
    this.unread.delete(sessionId)
    return this.runtime.start({
      id: sessionId,
      name: resolved.session.title,
      command: resolved.profile.command,
      args,
      cwd: resolved.checkout.path,
    })
  }

  stop(sessionId: string): Promise<boolean> { return this.runtime.stop(sessionId) }

  async restart(sessionId: string): Promise<boolean> {
    if (!(await this.stop(sessionId))) return false
    return this.start(sessionId)
  }

  input(sessionId: string, data: string): boolean { return this.runtime.input(sessionId, data) }

  async resize(sessionId: string, cols: number, rows: number): Promise<boolean> {
    const resolved = await this.resolveSession(sessionId)
    if (!resolved) return false
    this.runtime.ensure({
      id: sessionId,
      name: resolved.session.title,
      command: resolved.profile.command,
      args: resolved.profile.args,
      cwd: resolved.checkout.path,
    })
    return this.runtime.resize(sessionId, cols, rows)
  }

  getBuffer(sessionId: string): string { return this.runtime.getBuffer(sessionId) }
  clearBuffer(sessionId: string): boolean { return this.runtime.clearBuffer(sessionId) }

  markRead(sessionId: string): boolean {
    this.unread.delete(sessionId)
    const snapshot = this.getStatus(sessionId)
    this.options.onStatus({ sessionId, state: snapshot.state, unread: false })
    return true
  }

  getStatus(sessionId: string): AgentRuntimeSnapshot {
    const status = this.runtime.getStatus(sessionId)
    return {
      state: status.running ? 'running' : this.crashed.has(sessionId) ? 'crashed' : 'stopped',
      unread: this.unread.has(sessionId),
      ...(status.pid ? { pid: status.pid } : {}),
    }
  }

  isCheckoutBusy(checkoutId: string): boolean {
    return this.options.getConfig().agentSessions.some(
      (session) => session.checkoutId === checkoutId && this.runtime.isRunning(session.id),
    )
  }

  async discoverTools(): Promise<AgentToolStatus[]> {
    return Promise.all(this.options.getConfig().agentProfiles.map(async (profile) => {
      const resolvedPath = await findExecutable(profile.command)
      return {
        profileId: profile.id,
        command: profile.command,
        installed: resolvedPath !== null,
        ...(resolvedPath ? { resolvedPath } : {}),
      }
    }))
  }

  async reconcileConfig(nextConfig: AppConfig): Promise<void> {
    const sessions = new Set(nextConfig.agentSessions.map((session) => session.id))
    await Promise.all(this.runtime.listRunningIds().filter((id) => !sessions.has(id)).map((id) => this.stop(id)))
  }

  stopAll(): Promise<void> { return this.runtime.stopAll() }
  killAllImmediately(): void { this.runtime.killAllImmediately() }

  private async resolveSession(sessionId: string) {
    const session = this.options.getConfig().agentSessions.find((item) => item.id === sessionId)
    if (!session) return null
    const profile = this.options.getConfig().agentProfiles.find((item) => item.id === session.profileId)
    if (!profile?.enabled || !profile.command) return null
    const checkout = await this.options.resolveCheckout(session.checkoutId)
    if (!checkout || checkout.projectId !== session.projectId) return null
    return { session, profile, checkout }
  }
}

async function findExecutable(command: string): Promise<string | null> {
  if (!command.trim() || command.includes('\0')) return null
  if (path.isAbsolute(command) || command.includes(path.sep)) {
    try {
      await access(command)
      return path.resolve(command)
    } catch {
      return null
    }
  }
  const extensions = process.platform === 'win32'
    ? (process.env.PATHEXT ?? '.EXE;.CMD;.BAT').split(';')
    : ['']
  for (const directory of (process.env.PATH ?? '').split(path.delimiter)) {
    for (const extension of extensions) {
      const candidate = path.join(directory, `${command}${extension}`)
      try {
        await access(candidate)
        return candidate
      } catch {
        // Keep searching PATH.
      }
    }
  }
  return null
}
