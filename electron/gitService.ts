import { createHash } from 'node:crypto'
import { spawn } from 'node:child_process'
import path from 'node:path'
import type {
  AppConfig,
  Checkout,
  GitBranch,
  GitBranchCreateRequest,
  GitCloneRequest,
  GitCommit,
  GitFileChange,
  GitOperationResult,
  GitStatus,
  GitWorktreeCreateRequest,
  ProjectConfig,
} from '../shared/types'

interface CommandResult {
  code: number
  stdout: string
  stderr: string
}

interface GitServiceOptions {
  getConfig: () => AppConfig
  isCheckoutBusy: (checkoutId: string) => boolean
}

const MAX_OUTPUT = 2_000_000
const SAFE_REF = /^(?!-)(?!.*(?:\.\.|@\{|\\|\s|~|\^|:|\?|\*|\[|\/\.|\.lock(?:\/|$)))[\w./-]{1,240}$/

export class GitService {
  private readonly mutationLocks = new Set<string>()

  constructor(private readonly options: GitServiceOptions) {}

  async listCheckouts(projectId: string): Promise<Checkout[]> {
    const project = this.options.getConfig().projects.find((item) => item.id === projectId)
    if (!project) return []
    const result = await run('git', ['worktree', 'list', '--porcelain'], project.path)
    if (result.code !== 0) return []
    const checkouts: Checkout[] = []
    let current: Record<string, string | boolean> = {}
    const flush = (): void => {
      if (typeof current.worktree !== 'string') return
      const checkoutPath = path.resolve(current.worktree)
      const isMain = checkoutPath === path.resolve(project.path)
      const id = isMain ? `${project.id}:root` : checkoutId(project.id, checkoutPath)
      checkouts.push({
        id,
        projectId,
        path: checkoutPath,
        branch: typeof current.branch === 'string' ? current.branch.replace(/^refs\/heads\//, '') : '(detached)',
        head: typeof current.HEAD === 'string' ? current.HEAD : '',
        isMain,
        locked: Boolean(current.locked),
        busy: this.options.isCheckoutBusy(id),
      })
      current = {}
    }
    for (const line of result.stdout.split('\n')) {
      if (!line) {
        flush()
        continue
      }
      const space = line.indexOf(' ')
      const key = space === -1 ? line : line.slice(0, space)
      current[key] = space === -1 ? true : line.slice(space + 1)
    }
    flush()
    return checkouts
  }

  async resolveCheckout(id: string): Promise<Checkout | null> {
    const projectId = id.split(':')[0]
    return (await this.listCheckouts(projectId)).find((item) => item.id === id) ?? null
  }

  async status(id: string): Promise<GitStatus> {
    const checkout = await this.resolveCheckout(id)
    if (!checkout) return emptyStatus()
    const branchResult = await run('git', ['status', '--porcelain=v1', '-z', '--branch'], checkout.path)
    if (branchResult.code !== 0) return emptyStatus()
    const records = branchResult.stdout.split('\0').filter(Boolean)
    const header = records.shift() ?? ''
    const parsedHeader = parseStatusHeader(header)
    const files: GitFileChange[] = []
    for (let index = 0; index < records.length; index += 1) {
      const record = records[index]
      if (record.length < 4) continue
      const indexStatus = record[0]
      const worktreeStatus = record[1]
      let filePath = record.slice(3)
      let originalPath: string | undefined
      if (indexStatus === 'R' || indexStatus === 'C') {
        originalPath = records[index + 1]
        index += 1
      }
      filePath = filePath.replace(/\\/g, '/')
      const [stagedDiff, workingDiff] = await Promise.all([
        run('git', ['diff', '--cached', '--no-ext-diff', '--', filePath], checkout.path),
        run('git', ['diff', '--no-ext-diff', '--', filePath], checkout.path),
      ])
      const conflicted =
        indexStatus === 'U' ||
        worktreeStatus === 'U' ||
        (indexStatus === 'A' && worktreeStatus === 'A') ||
        (indexStatus === 'D' && worktreeStatus === 'D')
      files.push({
        path: filePath,
        ...(originalPath ? { originalPath } : {}),
        indexStatus,
        worktreeStatus,
        staged: indexStatus !== ' ' && indexStatus !== '?',
        unstaged: worktreeStatus !== ' ' || indexStatus === '?',
        conflicted,
        stagedPatch: stagedDiff.stdout.slice(0, 300_000),
        workingPatch: workingDiff.stdout.slice(0, 300_000),
      })
    }
    return {
      isRepository: true,
      branch: parsedHeader.branch,
      upstream: parsedHeader.upstream,
      ahead: parsedHeader.ahead,
      behind: parsedHeader.behind,
      clean: files.length === 0,
      detached: parsedHeader.detached,
      files,
    }
  }

  async history(id: string, limit = 100): Promise<GitCommit[]> {
    const checkout = await this.resolveCheckout(id)
    if (!checkout) return []
    const safeLimit = Math.min(500, Math.max(1, Math.floor(limit)))
    const format = ['%H', '%h', '%P', '%an', '%ae', '%aI', '%s', '%b', '%D'].join('%x1f') + '%x1e'
    const result = await run('git', ['log', `--max-count=${safeLimit}`, `--format=${format}`], checkout.path)
    if (result.code !== 0) return []
    return result.stdout
      .split('\x1e')
      .filter((item) => item.trim())
      .map((record) => {
        const [hash, shortHash, parents, author, authorEmail, date, subject, body, refs] = record.trim().split('\x1f')
        return {
          hash: hash ?? '',
          shortHash: shortHash ?? '',
          parents: parents?.split(' ').filter(Boolean) ?? [],
          author: author ?? '',
          authorEmail: authorEmail ?? '',
          date: date ?? '',
          subject: subject ?? '',
          body: body?.trim() ?? '',
          refs:
            refs
              ?.split(',')
              .map((ref) => ref.trim())
              .filter(Boolean) ?? [],
        }
      })
  }

  async branches(id: string): Promise<GitBranch[]> {
    const checkout = await this.resolveCheckout(id)
    if (!checkout) return []
    const format = [
      '%(refname)',
      '%(refname:short)',
      '%(HEAD)',
      '%(upstream:short)',
      '%(upstream:track,nobracket)',
      '%(objectname:short)',
      '%(subject)',
    ].join('%x1f')
    const result = await run('git', ['for-each-ref', `--format=${format}`, 'refs/heads', 'refs/remotes'], checkout.path)
    if (result.code !== 0) return []
    return result.stdout
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        const [fullName = '', name = '', current, upstream, track = '', hash, subject] = line.split('\x1f')
        const ahead = Number(track.match(/ahead (\d+)/)?.[1] ?? 0)
        const behind = Number(track.match(/behind (\d+)/)?.[1] ?? 0)
        return {
          name,
          current: current === '*',
          remote: fullName.startsWith('refs/remotes/'),
          ...(upstream ? { upstream } : {}),
          ahead,
          behind,
          lastCommit: `${hash ?? ''} ${subject ?? ''}`.trim(),
        }
      })
  }

  stage(id: string, paths: string[]) {
    return this.mutate(id, ['add', '--', ...safePaths(paths)])
  }
  unstage(id: string, paths: string[]) {
    return this.mutate(id, ['restore', '--staged', '--', ...safePaths(paths)])
  }
  discard(id: string, paths: string[]) {
    return this.mutate(id, ['restore', '--worktree', '--', ...safePaths(paths)])
  }
  stash(id: string, message?: string) {
    return this.mutate(id, ['stash', 'push', ...(message?.trim() ? ['-m', message.trim().slice(0, 200)] : [])])
  }
  stashPop(id: string) {
    return this.mutate(id, ['stash', 'pop'])
  }

  commit(id: string, summary: string, description?: string) {
    const cleanSummary = summary.replace(/\0/g, '').trim().slice(0, 200)
    if (!cleanSummary) return Promise.resolve(failure('A commit summary is required.'))
    const args = ['commit', '-m', cleanSummary]
    if (description?.trim()) args.push('-m', description.replace(/\0/g, '').trim().slice(0, 10_000))
    return this.mutate(id, args)
  }

  createBranch(request: GitBranchCreateRequest) {
    if (!validRef(request.name) || (request.startPoint && !validRef(request.startPoint)))
      return Promise.resolve(failure('Invalid branch name.'))
    return this.mutate(
      request.checkoutId,
      [
        request.switchTo ? 'switch' : 'branch',
        ...(request.switchTo ? ['-c'] : []),
        request.name,
        ...(request.startPoint ? [request.startPoint] : []),
      ],
      true,
    )
  }
  switchBranch(id: string, branch: string) {
    return validRef(branch)
      ? this.mutate(id, ['switch', branch], true)
      : Promise.resolve(failure('Invalid branch name.'))
  }
  deleteBranch(id: string, branch: string) {
    return validRef(branch)
      ? this.mutate(id, ['branch', '-d', branch], true)
      : Promise.resolve(failure('Invalid branch name.'))
  }
  renameBranch(id: string, oldName: string, newName: string) {
    return validRef(oldName) && validRef(newName)
      ? this.mutate(id, ['branch', '-m', oldName, newName], true)
      : Promise.resolve(failure('Invalid branch name.'))
  }
  mergeBranch(id: string, branch: string) {
    return validRef(branch)
      ? this.mutate(id, ['merge', '--no-edit', branch], true)
      : Promise.resolve(failure('Invalid branch name.'))
  }
  fetch(id: string) {
    return this.mutate(id, ['fetch', '--prune'])
  }
  pull(id: string) {
    return this.mutate(id, ['pull', '--ff-only'], true)
  }
  push(id: string) {
    return this.mutate(id, ['push'])
  }

  async createWorktree(request: GitWorktreeCreateRequest): Promise<GitOperationResult> {
    const checkouts = await this.listCheckouts(request.projectId)
    const main = checkouts.find((item) => item.isMain)
    if (!main || !validRef(request.branch) || (request.startPoint && !validRef(request.startPoint)))
      return failure('Invalid worktree request.')
    const target = path.resolve(request.path)
    const args = [
      'worktree',
      'add',
      ...(request.createBranch ? ['-b', request.branch] : []),
      target,
      request.createBranch ? (request.startPoint ?? 'HEAD') : request.branch,
    ]
    return this.mutate(main.id, args)
  }

  async removeWorktree(id: string): Promise<GitOperationResult> {
    const checkout = await this.resolveCheckout(id)
    if (!checkout || checkout.isMain) return failure('The project root worktree cannot be removed.')
    if (checkout.busy) return failure('Stop processes using this checkout before removing it.')
    const main = (await this.listCheckouts(checkout.projectId)).find((item) => item.isMain)
    return main ? this.mutate(main.id, ['worktree', 'remove', checkout.path]) : failure('Project checkout not found.')
  }

  async clone(request: GitCloneRequest): Promise<ProjectConfig | null> {
    const url = request.url.replace(/\0/g, '').trim()
    const directory = path.resolve(request.directory)
    if (!url || url.length > 4096) return null
    const result = await run('git', ['clone', '--', url, directory], process.cwd(), 10 * 60_000)
    if (result.code !== 0) return null
    return {
      id: `project-${Date.now().toString(36)}`,
      name: request.name?.trim().slice(0, 120) || path.basename(directory),
      path: directory,
      framework: 'custom',
      autoStart: false,
      tasks: [],
    }
  }

  async stagedDiff(id: string): Promise<string> {
    const checkout = await this.resolveCheckout(id)
    if (!checkout) return ''
    return (await run('git', ['diff', '--cached', '--no-ext-diff'], checkout.path)).stdout.slice(0, 500_000)
  }

  private async mutate(id: string, args: string[], blockWhenBusy = false): Promise<GitOperationResult> {
    const checkout = await this.resolveCheckout(id)
    if (!checkout) return failure('Checkout not found.')
    if (blockWhenBusy && checkout.busy)
      return failure('Stop tasks and agents using this checkout before changing its branch.')
    if (this.mutationLocks.has(checkout.projectId))
      return failure('Another Git operation is already running for this project.')
    this.mutationLocks.add(checkout.projectId)
    try {
      const result = await run('git', args, checkout.path)
      const output = [result.stdout, result.stderr].filter(Boolean).join('\n').trim().slice(0, MAX_OUTPUT)
      return { ok: result.code === 0, output, conflict: result.code !== 0 && (await hasConflicts(checkout.path)) }
    } finally {
      this.mutationLocks.delete(checkout.projectId)
    }
  }
}

function checkoutId(projectId: string, checkoutPath: string): string {
  return `${projectId}:wt:${createHash('sha256').update(checkoutPath).digest('hex').slice(0, 16)}`
}
function validRef(value: string): boolean {
  return SAFE_REF.test(value) && !value.endsWith('.') && !value.endsWith('/')
}
function safePaths(paths: string[]): string[] {
  return paths
    .filter((item) => typeof item === 'string' && item.length > 0 && item.length <= 4096 && !item.includes('\0'))
    .slice(0, 500)
}
function failure(output: string): GitOperationResult {
  return { ok: false, output, conflict: false }
}
function emptyStatus(): GitStatus {
  return { isRepository: false, branch: '', ahead: 0, behind: 0, clean: true, detached: false, files: [] }
}
function parseStatusHeader(header: string) {
  const value = header.replace(/^## /, '')
  const detached = value.startsWith('HEAD ')
  const [branchPart, tracking = ''] = value.split('...')
  const upstream = tracking.split(' ')[0] || undefined
  return {
    branch: branchPart.replace(/^No commits yet on /, ''),
    upstream,
    detached,
    ahead: Number(tracking.match(/ahead (\d+)/)?.[1] ?? 0),
    behind: Number(tracking.match(/behind (\d+)/)?.[1] ?? 0),
  }
}
async function hasConflicts(cwd: string): Promise<boolean> {
  return (await run('git', ['diff', '--name-only', '--diff-filter=U'], cwd)).stdout.trim().length > 0
}

function run(command: string, args: string[], cwd: string, timeoutMs = 120_000): Promise<CommandResult> {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd,
      windowsHide: true,
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let stdout = ''
    let stderr = ''
    const append = (current: string, chunk: Buffer): string => (current + chunk.toString('utf8')).slice(-MAX_OUTPUT)
    child.stdout.on('data', (chunk: Buffer) => {
      stdout = append(stdout, chunk)
    })
    child.stderr.on('data', (chunk: Buffer) => {
      stderr = append(stderr, chunk)
    })
    const timer = setTimeout(() => child.kill('SIGTERM'), timeoutMs)
    child.on('error', (error) => {
      clearTimeout(timer)
      resolve({ code: -1, stdout, stderr: `${stderr}\n${error.message}` })
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      resolve({ code: code ?? -1, stdout, stderr })
    })
  })
}
