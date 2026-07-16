import path from 'node:path'
import { randomUUID } from 'node:crypto'
import type {
  AgentWorkspace,
  AppConfig,
  Checkout,
  WorkspaceCreateRequest,
  WorkspaceCreateResult,
  WorkspaceFinishPreview,
  WorkspaceFinishRequest,
  WorkspaceFinishResult,
  WorkspaceRebindRequest,
} from '../shared/types'
import type { AgentManager } from './agentManager'
import type { GitService } from './gitService'

interface WorkspaceServiceOptions {
  getConfig: () => AppConfig
  applyConfig: (config: AppConfig) => Promise<AppConfig>
  git: GitService
  agents: AgentManager
}

export class WorkspaceService {
  constructor(private readonly options: WorkspaceServiceOptions) {}

  async create(request: WorkspaceCreateRequest): Promise<WorkspaceCreateResult> {
    const config = this.options.getConfig()
    const project = config.projects.find((item) => item.id === request.projectId)
    const profile = config.agentProfiles.find((item) => item.id === request.profileId && item.enabled)
    if (!project || !profile) return this.createFailure('Project or agent profile not found.')

    let checkout: Checkout | null
    let createdWorktree = false
    if (request.mode === 'worktree') {
      const branch = request.branch?.trim() ?? ''
      const worktreePath = request.worktreePath?.trim() ?? ''
      if (!branch || !worktreePath) return this.createFailure('A branch and worktree path are required.')
      const result = await this.options.git.createWorktree({
        projectId: project.id,
        path: worktreePath,
        branch,
        createBranch: true,
        ...(request.parentBranch?.trim() ? { startPoint: request.parentBranch.trim() } : {}),
      })
      if (!result.ok) return this.createFailure(result.output || 'The worktree could not be created.')
      createdWorktree = true
      checkout =
        (await this.options.git.listCheckouts(project.id)).find(
          (item) => path.resolve(item.path) === path.resolve(worktreePath),
        ) ?? null
    } else {
      const checkoutId = request.checkoutId?.trim() || `${project.id}:root`
      checkout = await this.options.git.resolveCheckout(checkoutId)
    }

    if (!checkout || checkout.projectId !== project.id) {
      return this.createFailure('The requested Git checkout is unavailable.')
    }

    const workspace: AgentWorkspace = {
      id: `workspace-${randomUUID()}`,
      projectId: project.id,
      checkoutId: checkout.id,
      profileId: profile.id,
      title: request.title.trim().slice(0, 160) || `${profile.name} workspace`,
      createdAt: Date.now(),
    }
    const branchParents = { ...project.branchParents }
    if (request.mode === 'worktree' && request.parentBranch?.trim()) {
      branchParents[checkout.branch] = request.parentBranch.trim()
    }

    try {
      await this.options.applyConfig({
        ...config,
        projects: config.projects.map((item) => (item.id === project.id ? { ...item, branchParents } : item)),
        preferences: { ...config.preferences, lastWorkspaceId: workspace.id },
        agentWorkspaces: [...config.agentWorkspaces, workspace],
      })
    } catch (error) {
      if (createdWorktree) await this.options.git.removeWorktree(checkout.id)
      return this.createFailure(error instanceof Error ? error.message : 'The workspace could not be saved.')
    }

    const started = request.start === true ? await this.options.agents.start(workspace.id) : false
    return { ok: true, workspace, checkout, started }
  }

  async rebind(request: WorkspaceRebindRequest): Promise<AgentWorkspace | null> {
    const config = this.options.getConfig()
    const workspace = config.agentWorkspaces.find((item) => item.id === request.workspaceId && !item.archivedAt)
    if (!workspace || this.options.agents.getStatus(workspace.id).state !== 'stopped') return null
    const checkout = await this.options.git.resolveCheckout(request.checkoutId)
    if (!checkout || checkout.projectId !== workspace.projectId) return null
    const rebound = { ...workspace, checkoutId: checkout.id }
    await this.options.applyConfig({
      ...config,
      preferences: { ...config.preferences, lastWorkspaceId: rebound.id },
      agentWorkspaces: config.agentWorkspaces.map((item) => (item.id === rebound.id ? rebound : item)),
    })
    return rebound
  }

  async finishPreview(workspaceId: string): Promise<WorkspaceFinishPreview | null> {
    const config = this.options.getConfig()
    const workspace = config.agentWorkspaces.find((item) => item.id === workspaceId && !item.archivedAt)
    if (!workspace) return null
    const agentState = this.options.agents.getStatus(workspace.id).state
    const checkout = await this.options.git.resolveCheckout(workspace.checkoutId)
    if (!checkout) {
      return {
        workspaceId,
        agentState,
        checkoutMissing: true,
        clean: true,
        conflicted: false,
        rootCheckout: false,
        canArchive: agentState === 'stopped',
        canMerge: false,
        canRemoveWorktree: false,
        blockers: agentState === 'stopped' ? [] : ['Stop the agent before archiving this workspace.'],
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
    if (agentState !== 'stopped') blockers.push('Stop the agent before finishing this workspace.')
    if (!status.clean)
      blockers.push(conflicted ? 'Resolve merge conflicts first.' : 'Commit or stash checkout changes first.')
    if (!checkout.isMain && !parentBranch) blockers.push('No parent branch is configured for this worktree.')
    if (!checkout.isMain && parentBranch && !parentCheckout) {
      blockers.push(`The parent branch ${parentBranch} is not checked out and available.`)
    }
    if (parentCheckout?.busy) blockers.push('Stop processes using the parent checkout first.')
    if (parentStatus && !parentStatus.clean) blockers.push('The parent checkout must be clean before merging.')

    const baseReady = agentState === 'stopped' && status.clean
    return {
      workspaceId,
      agentState,
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
    const archivedAt = Date.now()
    const nextActive = config.agentWorkspaces.find((item) => item.id !== request.workspaceId && !item.archivedAt)
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
        agentWorkspaces: config.agentWorkspaces.map((item) =>
          item.id === request.workspaceId ? { ...item, archivedAt } : item,
        ),
      })
    } catch (error) {
      return this.finishFailure(
        completed,
        ['archive'],
        error instanceof Error ? error.message : 'The workspace could not be archived.',
      )
    }
    completed.push('archive')
    return { ok: true, completed, pending: [] }
  }

  private createFailure(error: string): WorkspaceCreateResult {
    return { ok: false, started: false, error }
  }

  private finishFailure(completed: string[], pending: string[], error: string): WorkspaceFinishResult {
    return { ok: false, completed, pending, error }
  }
}
