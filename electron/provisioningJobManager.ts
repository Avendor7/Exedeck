import { promises as fs } from 'node:fs'
import path from 'node:path'
import * as pty from 'node-pty'
import kill from 'tree-kill'
import { resolvePtySpawnCommand } from './processCommand'
import type {
  ProjectConfig,
  ProjectCreateDoneEvent,
  ProjectCreateRequest,
  ProjectCreateState,
  ProjectCreateStatus,
  TaskConfig,
} from '../shared/types'

interface ProvisioningJob {
  id: string
  request: ProjectCreateRequest
  status: ProjectCreateStatus
  buffer: string
  process?: pty.IPty
  cancelRequested: boolean
  createdProject?: ProjectConfig
}

interface ProvisionAttempt {
  command: string
  args: string[]
  cwd: string
  fallback?: boolean
}

interface ProvisioningJobManagerOptions {
  onData: (event: { jobId: string; chunk: string }) => void
  onStatus: (event: { jobId: string; status: ProjectCreateStatus }) => void
  onDone: (event: ProjectCreateDoneEvent) => void
  maxBufferChars?: number
}

function makeId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

function validateProjectName(name: string): string | null {
  const trimmed = name.trim()
  if (!trimmed) {
    return 'Project name is required.'
  }

  if (/[/\\]/.test(trimmed)) {
    return 'Project name cannot contain path separators.'
  }

  if (trimmed === '.' || trimmed === '..') {
    return 'Project name cannot be dot-path values.'
  }

  if (trimmed.length > 100) {
    return 'Project name must be 100 characters or fewer.'
  }

  // eslint-disable-next-line no-control-regex -- control characters are intentionally rejected.
  if (/[\u0000-\u001f<>:"|?*]/.test(trimmed)) {
    return 'Project name contains characters that are not valid in file names.'
  }

  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(trimmed)) {
    return 'Project name is reserved by Windows.'
  }

  return null
}

export class ProvisioningJobManager {
  private readonly onData: ProvisioningJobManagerOptions['onData']
  private readonly onStatus: ProvisioningJobManagerOptions['onStatus']
  private readonly onDone: ProvisioningJobManagerOptions['onDone']
  private readonly maxBufferChars: number
  private readonly jobs = new Map<string, ProvisioningJob>()

  constructor(options: ProvisioningJobManagerOptions) {
    this.onData = options.onData
    this.onStatus = options.onStatus
    this.onDone = options.onDone
    this.maxBufferChars = options.maxBufferChars ?? 500_000
  }

  async startJob(request: ProjectCreateRequest): Promise<string> {
    const name = request.name.trim()
    const directory = path.resolve(request.directory.trim() || '.')
    const targetPath = path.join(directory, name)
    const jobId = makeId('create')

    const status: ProjectCreateStatus = {
      jobId,
      framework: request.framework,
      name,
      directory,
      targetPath,
      state: 'queued',
      startedAt: Date.now(),
      fallbackUsed: false,
    }

    const job: ProvisioningJob = {
      id: jobId,
      request,
      status,
      buffer: '',
      cancelRequested: false,
    }

    this.jobs.set(jobId, job)
    this.pruneFinishedJobs()
    this.emitStatus(job)

    const validationError = validateProjectName(name)
    if (validationError) {
      this.finish(job, 'failed', validationError)
      return jobId
    }

    const duplicateJob = Array.from(this.jobs.values()).find(
      (candidate) =>
        candidate.id !== job.id &&
        candidate.status.targetPath === targetPath &&
        (candidate.status.state === 'queued' || candidate.status.state === 'running'),
    )
    if (duplicateJob) {
      this.finish(job, 'failed', 'Another scaffold job is already using this target directory.')
      return jobId
    }

    try {
      await fs.mkdir(directory, { recursive: true })
      const dirStat = await fs.stat(directory)
      if (!dirStat.isDirectory()) {
        throw new Error('Selected directory is not a folder.')
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      this.finish(job, 'failed', `Cannot use the selected directory: ${message}`)
      return jobId
    }

    try {
      const existing = await fs.readdir(targetPath)
      if (existing.length > 0) {
        this.finish(job, 'failed', `Target already exists and is not empty: ${targetPath}`)
        return jobId
      }
    } catch (error) {
      const code = error && typeof error === 'object' && 'code' in error ? error.code : undefined
      if (code !== 'ENOENT') {
        const message = error instanceof Error ? error.message : String(error)
        this.finish(job, 'failed', `Cannot inspect the target directory: ${message}`)
        return jobId
      }
    }

    setImmediate(() => {
      void this.runProvisioning(job).catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error)
        this.finish(job, 'failed', `Unexpected scaffold error: ${message}`)
      })
    })
    return jobId
  }

  getStatus(jobId: string): ProjectCreateStatus | null {
    const job = this.jobs.get(jobId)
    if (!job) {
      return null
    }
    return { ...job.status }
  }

  getBuffer(jobId: string): string {
    return this.jobs.get(jobId)?.buffer ?? ''
  }

  input(jobId: string, data: string): boolean {
    const job = this.jobs.get(jobId)
    if (!job || !job.process || job.status.state !== 'running') {
      return false
    }

    try {
      job.process.write(data)
      return true
    } catch {
      return false
    }
  }

  async cancel(jobId: string): Promise<boolean> {
    const job = this.jobs.get(jobId)
    if (!job) {
      return false
    }

    if (job.status.state !== 'running' || !job.process) {
      return true
    }

    job.cancelRequested = true
    try {
      job.process.write('\u0003')
    } catch {
      // The process may have exited before the cancellation write.
    }
    const stoppedByCtrlC = await this.waitForState(jobId, ['canceled', 'failed', 'success'], 1500)
    if (stoppedByCtrlC) {
      return true
    }

    const pid = job.process?.pid
    if (!pid) {
      return true
    }
    await this.killTree(pid, 'SIGTERM')
    if (await this.waitForState(jobId, ['canceled', 'failed', 'success'], 1200)) {
      return true
    }

    await this.killTree(pid, 'SIGKILL')
    return this.waitForState(jobId, ['canceled', 'failed', 'success'], 500)
  }

  private async runProvisioning(job: ProvisioningJob): Promise<void> {
    const attempts = this.buildAttempts(job)
    this.updateState(job, 'running')
    let previousError = ''

    for (let index = 0; index < attempts.length; index += 1) {
      const attempt = attempts[index]
      if (index > 0) {
        const targetIsEmpty = await this.isDirectoryEmpty(job.status.targetPath)
        if (!targetIsEmpty) {
          this.finish(
            job,
            'failed',
            `${previousError} The primary command left files in the target directory, so Exedeck did not run a fallback that could overwrite them.`.trim(),
          )
          return
        }

        job.status.fallbackUsed = true
        this.appendChunk(job, `\r\n[exedeck] Primary scaffold failed. Trying fallback command...\r\n`)
      }

      const result = await this.runAttempt(job, attempt)
      if (result.state === 'success') {
        const postCreateResult = await this.runPostCreateSteps(job)
        if (postCreateResult.state !== 'success') {
          if (postCreateResult.state === 'canceled') {
            this.finish(job, 'canceled')
            return
          }

          this.finish(job, 'failed', postCreateResult.error ?? 'Post-create setup failed.')
          return
        }

        const project = await this.buildProjectConfig(job.status)
        job.createdProject = project
        this.finish(job, 'success', undefined, project.id)
        return
      }

      if (result.state === 'canceled') {
        this.finish(job, 'canceled')
        return
      }

      if (index === attempts.length - 1) {
        const message =
          result.error ||
          `Scaffold command failed for ${attempt.command} ${attempt.args.join(' ')} with exit code ${String(result.exitCode)}.`
        this.finish(job, 'failed', message)
        return
      }
      previousError = result.error ?? 'The primary scaffold command failed.'
    }
  }

  private buildAttempts(job: ProvisioningJob): ProvisionAttempt[] {
    const { status, request } = job

    if (status.framework === 'laravel') {
      return [
        {
          command: 'laravel',
          args: this.buildLaravelNewArgs(status.name, request),
          cwd: status.directory,
        },
        {
          command: 'composer',
          args: ['create-project', 'laravel/laravel', status.name, '--no-interaction'],
          cwd: status.directory,
          fallback: true,
        },
      ]
    }

    return [
      {
        command: 'npm',
        args: ['init', 'adonisjs@latest', status.name],
        cwd: status.directory,
      },
    ]
  }

  private buildLaravelNewArgs(name: string, request: ProjectCreateRequest): string[] {
    const options = request.laravel ?? {
      starterKit: 'none' as const,
      authMode: 'default' as const,
      boost: false,
    }

    const args = ['new', name, '--no-interaction', '--database=sqlite', '--npm']

    if (options.starterKit !== 'none') {
      args.push(`--${options.starterKit}`)
    }

    if (options.authMode === 'no-authentication') {
      args.push('--no-authentication')
    } else if (options.authMode === 'workos') {
      args.push('--workos')
    }

    if (options.boost) {
      args.push('--boost')
    }

    return args
  }

  private async runAttempt(
    job: ProvisioningJob,
    attempt: ProvisionAttempt,
  ): Promise<{ state: 'success' | 'failed' | 'canceled'; error?: string; exitCode?: number | null }> {
    let child: pty.IPty

    try {
      const spawn = resolvePtySpawnCommand(attempt.command, attempt.args)
      child = pty.spawn(spawn.command, spawn.args, {
        name: 'xterm-256color',
        cols: 120,
        rows: 30,
        cwd: attempt.cwd,
        env: {
          ...process.env,
          TERM: 'xterm-256color',
        },
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return {
        state: 'failed',
        error: `Failed to start: ${attempt.command} ${attempt.args.join(' ')} (${message})`,
      }
    }

    job.process = child

    child.onData((chunk) => {
      this.appendChunk(job, chunk)
    })

    const result = await new Promise<{ exitCode: number | null; signal?: number }>((resolve) => {
      child.onExit(resolve)
    })

    job.process = undefined

    if (job.cancelRequested) {
      return { state: 'canceled' }
    }

    if (result.exitCode === 0) {
      return { state: 'success' }
    }

    // If the command gets interrupted, treat it as canceled.
    if (result.signal === 2 || result.exitCode === 130) {
      return { state: 'canceled' }
    }

    if (attempt.fallback) {
      return {
        state: 'failed',
        error: `Fallback failed: ${attempt.command} ${attempt.args.join(' ')} (exit ${String(result.exitCode)})`,
        exitCode: result.exitCode,
      }
    }

    return {
      state: 'failed',
      error: `${attempt.command} ${attempt.args.join(' ')} failed (exit ${String(result.exitCode)}).`,
      exitCode: result.exitCode,
    }
  }

  private async runPostCreateSteps(
    job: ProvisioningJob,
  ): Promise<{ state: 'success' | 'failed' | 'canceled'; error?: string }> {
    if (job.status.framework === 'laravel') {
      await this.enforceSqliteDefaults(job.status.targetPath)
    }

    const packageManager = await this.detectPackageManager(job.status.targetPath)
    if (!(await this.pathExists(path.join(job.status.targetPath, 'node_modules')))) {
      const installResult = await this.runAttempt(job, {
        command: packageManager,
        args: packageManager === 'yarn' ? [] : ['install'],
        cwd: job.status.targetPath,
      })
      if (installResult.state !== 'success') {
        return {
          state: installResult.state,
          error: installResult.error ?? `${packageManager} install failed.`,
        }
      }
    }

    if (await this.hasPackageScript(job.status.targetPath, 'build')) {
      const buildResult = await this.runAttempt(job, {
        command: packageManager,
        args: packageManager === 'yarn' ? ['build'] : ['run', 'build'],
        cwd: job.status.targetPath,
      })
      if (buildResult.state !== 'success') {
        return {
          state: buildResult.state,
          error: buildResult.error ?? `${packageManager} build failed.`,
        }
      }
    }

    return { state: 'success' }
  }

  private async enforceSqliteDefaults(projectPath: string): Promise<void> {
    const envFiles = ['.env', '.env.example']
    for (const fileName of envFiles) {
      const fullPath = path.join(projectPath, fileName)

      try {
        const existing = await fs.readFile(fullPath, 'utf8')
        const next = this.upsertEnvKey(
          this.upsertEnvKey(existing, 'DB_CONNECTION', 'sqlite'),
          'DB_DATABASE',
          'database/database.sqlite',
        )
        if (next !== existing) {
          await fs.writeFile(fullPath, next, 'utf8')
        }
      } catch (error) {
        const code = error && typeof error === 'object' && 'code' in error ? error.code : undefined
        if (code !== 'ENOENT') {
          throw error
        }
      }
    }
  }

  private upsertEnvKey(content: string, key: string, value: string): string {
    const line = `${key}=${value}`
    const pattern = new RegExp(`^${key}=.*$`, 'm')
    if (pattern.test(content)) {
      return content.replace(pattern, line)
    }

    if (!content.endsWith('\n')) {
      return `${content}\n${line}\n`
    }

    return `${content}${line}\n`
  }

  private async buildProjectConfig(status: ProjectCreateStatus): Promise<ProjectConfig> {
    const framework = status.framework
    const projectPath = status.targetPath
    const tasks = await this.buildDefaultTasks(framework, projectPath)

    return {
      id: makeId('project'),
      name: status.name,
      path: projectPath,
      framework,
      autoStart: false,
      tasks,
    }
  }

  async consumeCreatedProject(jobId: string): Promise<ProjectConfig | null> {
    const job = this.jobs.get(jobId)
    if (!job || job.status.state !== 'success' || !job.createdProject) {
      return null
    }

    this.jobs.delete(jobId)
    return job.createdProject
  }

  async stopAll(): Promise<void> {
    const activeJobs = Array.from(this.jobs.values()).filter((job) => job.status.state === 'running' && job.process)
    await Promise.all(activeJobs.map((job) => this.cancel(job.id)))
  }

  killAllImmediately(): void {
    for (const job of this.jobs.values()) {
      if (!job.process) {
        continue
      }

      job.cancelRequested = true
      try {
        kill(job.process.pid, 'SIGKILL', () => undefined)
        job.process.kill()
      } catch {
        // The operating system may already have reaped the child process.
      }
      job.process = undefined
    }
  }

  private async buildDefaultTasks(
    framework: ProjectCreateRequest['framework'],
    projectPath: string,
  ): Promise<TaskConfig[]> {
    if (framework === 'laravel') {
      return [
        {
          id: makeId('task'),
          name: 'Dev server',
          command: 'composer',
          args: ['run', 'dev'],
          cwd: projectPath,
          autoStart: false,
        },
        {
          id: makeId('task'),
          name: 'Queue worker',
          command: 'php',
          args: ['artisan', 'queue:work'],
          cwd: projectPath,
          autoStart: false,
        },
      ]
    }

    const manager = await this.detectPackageManager(projectPath)
    if (manager === 'pnpm') {
      return [
        {
          id: makeId('task'),
          name: 'Dev server',
          command: 'pnpm',
          args: ['run', 'dev'],
          cwd: projectPath,
          autoStart: false,
        },
      ]
    }

    if (manager === 'yarn') {
      return [
        {
          id: makeId('task'),
          name: 'Dev server',
          command: 'yarn',
          args: ['dev'],
          cwd: projectPath,
          autoStart: false,
        },
      ]
    }

    return [
      {
        id: makeId('task'),
        name: 'Dev server',
        command: 'npm',
        args: ['run', 'dev'],
        cwd: projectPath,
        autoStart: false,
      },
    ]
  }

  private async detectPackageManager(projectPath: string): Promise<'npm' | 'pnpm' | 'yarn'> {
    try {
      await fs.access(path.join(projectPath, 'pnpm-lock.yaml'))
      return 'pnpm'
    } catch {
      // Continue to next lockfile check.
    }

    try {
      await fs.access(path.join(projectPath, 'yarn.lock'))
      return 'yarn'
    } catch {
      return 'npm'
    }
  }

  private async pathExists(targetPath: string): Promise<boolean> {
    try {
      await fs.access(targetPath)
      return true
    } catch {
      return false
    }
  }

  private async hasPackageScript(projectPath: string, scriptName: string): Promise<boolean> {
    try {
      const packageJson = JSON.parse(await fs.readFile(path.join(projectPath, 'package.json'), 'utf8')) as unknown
      if (!packageJson || typeof packageJson !== 'object') return false
      const scripts = (packageJson as Record<string, unknown>).scripts
      return Boolean(
        scripts && typeof scripts === 'object' && typeof (scripts as Record<string, unknown>)[scriptName] === 'string',
      )
    } catch {
      return false
    }
  }

  private async isDirectoryEmpty(directory: string): Promise<boolean> {
    try {
      return (await fs.readdir(directory)).length === 0
    } catch (error) {
      const code = error && typeof error === 'object' && 'code' in error ? error.code : undefined
      return code === 'ENOENT'
    }
  }

  private pruneFinishedJobs(): void {
    if (this.jobs.size <= 25) {
      return
    }

    const finished = Array.from(this.jobs.values())
      .filter((job) => job.status.endedAt)
      .sort((a, b) => (a.status.endedAt ?? 0) - (b.status.endedAt ?? 0))

    for (const job of finished.slice(0, Math.max(0, this.jobs.size - 25))) {
      this.jobs.delete(job.id)
    }
  }

  private updateState(job: ProvisioningJob, state: ProjectCreateState): void {
    job.status.state = state
    if (state === 'success' || state === 'failed' || state === 'canceled') {
      job.status.endedAt = Date.now()
    }
    this.emitStatus(job)
  }

  private emitStatus(job: ProvisioningJob): void {
    this.onStatus({
      jobId: job.id,
      status: { ...job.status },
    })
  }

  private appendChunk(job: ProvisioningJob, chunk: string): void {
    const next = `${job.buffer}${chunk}`
    job.buffer = next.length > this.maxBufferChars ? next.slice(next.length - this.maxBufferChars) : next
    this.onData({ jobId: job.id, chunk })
  }

  private finish(
    job: ProvisioningJob,
    state: Extract<ProjectCreateState, 'success' | 'failed' | 'canceled'>,
    error?: string,
    projectId?: string,
  ): void {
    if (job.status.state === 'success' || job.status.state === 'failed' || job.status.state === 'canceled') {
      return
    }

    job.process = undefined
    if (error) {
      job.status.error = error
      this.appendChunk(job, `\r\n[exedeck] ${error}\r\n`)
    }
    this.updateState(job, state)

    this.onDone({
      jobId: job.id,
      state,
      projectId,
      error,
    })
  }

  private waitForState(
    jobId: string,
    states: Array<Extract<ProjectCreateState, 'success' | 'failed' | 'canceled'>>,
    timeoutMs: number,
  ): Promise<boolean> {
    return new Promise((resolve) => {
      const start = Date.now()
      const timer = setInterval(() => {
        const job = this.jobs.get(jobId)
        if (!job) {
          clearInterval(timer)
          resolve(true)
          return
        }

        if (states.includes(job.status.state as Extract<ProjectCreateState, 'success' | 'failed' | 'canceled'>)) {
          clearInterval(timer)
          resolve(true)
          return
        }

        if (Date.now() - start >= timeoutMs) {
          clearInterval(timer)
          resolve(false)
        }
      }, 50)
    })
  }

  private killTree(pid: number, signal: string): Promise<void> {
    return new Promise((resolve) => {
      kill(pid, signal, () => resolve())
    })
  }
}
