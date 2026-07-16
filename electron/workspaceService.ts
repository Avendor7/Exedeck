import path from 'node:path'
import { randomUUID } from 'node:crypto'
import type {
  AppConfig,
  WorkspaceCreateRequest,
  WorkspaceCreateResult,
  WorkspaceFinishPreview,
  WorkspaceFinishRequest,
  WorkspaceFinishResult,
  WorkspaceRebindRequest,
  WorkspaceConfig,
} from '../shared/types'
import type { AgentManager } from './agentManager'
import type { GitService } from './gitService'
import type { TaskManager } from './taskManager'

interface WorkspaceServiceOptions {
  getConfig: () => AppConfig
  applyConfig: (config: AppConfig) => Promise<AppConfig>
  git: GitService
  agents: AgentManager
  tasks: TaskManager
}

export class WorkspaceService {
  constructor(private readonly options: WorkspaceServiceOptions) {}

  async create(request: WorkspaceCreateRequest): Promise<WorkspaceCreateResult> {
    const config = this.options.getConfig()
    const project = config.projects.find((item) => item.id === request.projectId)
    if (!project) return this.createFailure('Project not found.')

    const branch = request.branch.trim()
    const worktreePath = request.worktreePath.trim()
    if (!branch || !worktreePath) return this.createFailure('A branch and worktree path are required.')
    const result = await this.options.git.createWorktree({
      projectId: project.id,
      path: worktreePath,
      branch,
      createBranch: true,
      ...(request.parentBranch?.trim() ? { startPoint: request.parentBranch.trim() } : {}),
    })
    if (!result.ok) return this.createFailure(result.output || 'The worktree could not be created.')
    const checkout =
      (await this.options.git.listCheckouts(project.id)).find(
        (item) => path.resolve(item.path) === path.resolve(worktreePath),
      ) ?? null

    if (!checkout || checkout.projectId !== project.id) {
      return this.createFailure('The requested Git checkout is unavailable.')
    }

    const workspace: WorkspaceConfig = {
      id: `workspace-${randomUUID()}`,
      projectId: project.id,
      checkoutId: checkout.id,
      name: request.name.trim().slice(0, 160) || checkout.branch,
      kind: 'worktree',
      createdAt: Date.now(),
      agents: [],
      terminals: [],
    }
    const branchParents = { ...project.branchParents }
    if (request.parentBranch?.trim()) {
      branchParents[checkout.branch] = request.parentBranch.trim()
    }

    try {
      await this.options.applyConfig({
        ...config,
        projects: config.projects.map((item) => (item.id === project.id ? { ...item, branchParents } : item)),
        preferences: { ...config.preferences, lastWorkspaceId: workspace.id },
        workspaces: [...config.workspaces, workspace],
      })
    } catch (error) {
      await this.options.git.removeWorktree(checkout.id)
      return this.createFailure(error instanceof Error ? error.message : 'The workspace could not be saved.')
    }

    return { ok: true, workspace, checkout }
  }

  async rebind(request: WorkspaceRebindRequest): Promise<WorkspaceConfig | null> {
    const config = this.options.getConfig()
    const workspace = config.workspaces.find((item) => item.id === request.workspaceId && item.kind === 'worktree')
    if (!workspace || this.runningItems(workspace) > 0) return null
    const checkout = await this.options.git.resolveCheckout(request.checkoutId)
    if (!checkout || checkout.projectId !== workspace.projectId || checkout.isMain) return null
    const rebound = { ...workspace, checkoutId: checkout.id }
    await this.options.applyConfig({
      ...config,
      preferences: { ...config.preferences, lastWorkspaceId: rebound.id },
      workspaces: config.workspaces.map((item) => (item.id === rebound.id ? rebound : item)),
    })
    return rebound
  }

  async finishPreview(workspaceId: string): Promise<WorkspaceFinishPreview | null> {
    const config = this.options.getConfig()
    const workspace = config.workspaces.find((item) => item.id === workspaceId)
    if (!workspace) return null
    const runningItems = this.runningItems(workspace)
    const checkout = await this.options.git.resolveCheckout(workspace.checkoutId)
    if (!checkout) {
      return {
        workspaceId,
        runningItems,
        checkoutMissing: true,
        clean: true,
        conflicted: false,
        rootCheckout: false,
        canArchive: workspace.kind === 'worktree' && runningItems === 0,
        canMerge: false,
        canRemoveWorktree: false,
        blockers:
          workspace.kind === 'root'
            ? ['The root workspace cannot be removed.']
            : runningItems === 0
              ? []
              : ['Stop all workspace items before removing this workspace.'],
      }
    }

    const status = await this.options.git.status(checkout.id)
    const conflicted = status.files.some((file) => file.conflicted)
    const project = config.projects.find((item) => item.id === workspace.projectId)
    const parentBranch = project?.branchParents?.[checkout.branch]
    const checkouts = await this.options.git.listCheckouts(workspace.projectId)
    const parentCheckout = parentBranch
      ? checkouts.find((item) => item.id !== checkout.id && item.branch === parentBranch)
      : undefined
    const parentStatus = parentCheckout ? await this.options.git.status(parentCheckout.id) : null
    const blockers: string[] = []
    if (workspace.kind === 'root') blockers.push('The root workspace cannot be removed.')
    if (runningItems > 0) blockers.push('Stop all workspace items before finishing this workspace.')
    if (!status.clean)
      blockers.push(conflicted ? 'Resolve merge conflicts first.' : 'Commit or stash checkout changes first.')
    if (!checkout.isMain && !parentBranch) blockers.push('No parent branch is configured for this worktree.')
    if (!checkout.isMain && parentBranch && !parentCheckout) {
      blockers.push(`The parent branch ${parentBranch} is not checked out and available.`)
    }
    if (parentCheckout?.busy) blockers.push('Stop processes using the parent checkout first.')
    if (parentStatus && !parentStatus.clean) blockers.push('The parent checkout must be clean before merging.')

    const baseReady = workspace.kind === 'worktree' && runningItems === 0 && status.clean
    return {
      workspaceId,
      runningItems,
      checkout,
      checkoutMissing: false,
      clean: status.clean,
      conflicted,
      ...(parentBranch ? { parentBranch } : {}),
      ...(parentCheckout ? { parentCheckout } : {}),
      rootCheckout: checkout.isMain,
      canArchive: baseReady,
      canMerge:
        baseReady &&
        !checkout.isMain &&
        Boolean(parentBranch && parentCheckout && !parentCheckout.busy && parentStatus?.clean),
      canRemoveWorktree: baseReady && !checkout.isMain && !checkout.busy,
      blockers,
    }
  }

  async finish(request: WorkspaceFinishRequest): Promise<WorkspaceFinishResult> {
    const preview = await this.finishPreview(request.workspaceId)
    if (!preview) return this.finishFailure([], ['archive'], 'Workspace not found.')
    if (!preview.canArchive)
      return this.finishFailure([], ['archive'], preview.blockers[0] || 'Workspace is not ready.')
    if (preview.rootCheckout && (request.merge || request.removeWorktree || request.deleteBranch)) {
      return this.finishFailure([], ['archive'], 'Root-checkout workspaces can only be archived.')
    }
    if (request.merge && !preview.canMerge) {
      return this.finishFailure([], ['merge', 'archive'], preview.blockers[0] || 'Merge is not available.')
    }
    if (request.removeWorktree && !preview.canRemoveWorktree) {
      return this.finishFailure([], ['remove worktree', 'archive'], 'The worktree cannot be removed.')
    }
    if (request.deleteBranch && (!request.merge || !request.removeWorktree)) {
      return this.finishFailure(
        [],
        ['delete branch', 'archive'],
        'Branch deletion requires a successful merge and worktree removal.',
      )
    }

    const completed: string[] = []
    if (request.merge && preview.checkout && preview.parentCheckout) {
      const result = await this.options.git.mergeBranch(preview.parentCheckout.id, preview.checkout.branch)
      if (!result.ok) {
        return this.finishFailure(completed, ['merge', 'remove worktree', 'archive'], result.output || 'Merge failed.')
      }
      completed.push('merge')
    }

    if (request.removeWorktree && preview.checkout) {
      const result = await this.options.git.removeWorktree(preview.checkout.id)
      if (!result.ok) {
        return this.finishFailure(completed, ['remove worktree', 'archive'], result.output || 'Removal failed.')
      }
      completed.push('remove worktree')
    }

    if (request.deleteBranch && preview.checkout && preview.parentCheckout) {
      const result = await this.options.git.deleteBranch(preview.parentCheckout.id, preview.checkout.branch)
      if (!result.ok) {
        return this.finishFailure(
          completed,
          ['delete branch', 'archive'],
          result.output || 'Safe branch deletion failed.',
        )
      }
      completed.push('delete branch')
    }

    const config = this.options.getConfig()
    const nextActive = config.workspaces.find((item) => item.id !== request.workspaceId)
    try {
      await this.options.applyConfig({
        ...config,
        preferences: {
          ...config.preferences,
          lastWorkspaceId:
            config.preferences.lastWorkspaceId === request.workspaceId
              ? (nextActive?.id ?? '')
              : config.preferences.lastWorkspaceId,
        },
        workspaces: config.workspaces.filter((item) => item.id !== request.workspaceId),
      })
    } catch (error) {
      return this.finishFailure(
        completed,
        ['archive'],
        error instanceof Error ? error.message : 'The workspace could not be archived.',
      )
    }
    completed.push('remove workspace')
    return { ok: true, completed, pending: [] }
  }

  private createFailure(error: string): WorkspaceCreateResult {
    return { ok: false, error }
  }

  private finishFailure(completed: string[], pending: string[], error: string): WorkspaceFinishResult {
    return { ok: false, completed, pending, error }
  }

  private runningItems(workspace: WorkspaceConfig): number {
    const agents = workspace.agents.filter((agent) => this.options.agents.getStatus(agent.id).state !== 'stopped')
    const terminals = workspace.terminals.filter((terminal) => this.options.tasks.getTaskStatus(terminal.id).running)
    return agents.length + terminals.length
  }
}
