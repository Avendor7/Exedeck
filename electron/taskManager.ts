import * as pty from 'node-pty'
import kill from 'tree-kill'
import type {
  AppConfig,
  TaskConfig,
  TaskDataEvent,
  TaskExitEvent,
  TaskStatusEvent,
} from '../shared/types'

interface TaskRuntime {
  task: TaskConfig
  process?: pty.IPty
  running: boolean
  buffer: string
}

interface TaskManagerOptions {
  getConfig: () => AppConfig
  onData: (event: TaskDataEvent) => void
  onStatus: (event: TaskStatusEvent) => void
  onExit: (event: TaskExitEvent) => void
  maxBufferChars?: number
}

interface ResolvedTask {
  task: TaskConfig
  cwd: string
}

export class TaskManager {
  private readonly getConfig: () => AppConfig
  private readonly onData: (event: TaskDataEvent) => void
  private readonly onStatus: (event: TaskStatusEvent) => void
  private readonly onExit: (event: TaskExitEvent) => void
  private readonly maxBufferChars: number
  private readonly runtimes = new Map<string, TaskRuntime>()

  constructor(options: TaskManagerOptions) {
    this.getConfig = options.getConfig
    this.onData = options.onData
    this.onStatus = options.onStatus
    this.onExit = options.onExit
    this.maxBufferChars = options.maxBufferChars ?? 250_000
  }

  startTask(taskId: string): boolean {
    const resolved = this.findTask(taskId)
    if (!resolved) {
      return false
    }

    const { task, cwd } = resolved
    if (!task.command.trim()) {
      return false
    }

    const runtime = this.ensureRuntime(task)
    if (runtime.running) {
      return true
    }

    let child: pty.IPty
    try {
      child = pty.spawn(task.command, task.args, {
        name: 'xterm-256color',
        cols: 120,
        rows: 30,
        cwd,
        env: {
          ...process.env,
          TERM: 'xterm-256color',
        },
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      const chunk = `\r\n[exedeck] Failed to start task "${task.name}": ${message}\r\n`
      runtime.buffer = this.pushToBuffer(runtime.buffer, chunk)
      this.onData({ taskId, chunk })
      this.onStatus({ taskId, running: false })
      return false
    }

    runtime.process = child
    runtime.running = true
    runtime.task = task
    this.onStatus({ taskId, running: true })

    child.onData((chunk) => {
      runtime.buffer = this.pushToBuffer(runtime.buffer, chunk)
      this.onData({ taskId, chunk })
    })

    child.onExit(({ exitCode, signal }) => {
      runtime.running = false
      runtime.process = undefined
      this.onStatus({ taskId, running: false })
      this.onExit({ taskId, exitCode, signal })
    })

    return true
  }

  async stopTask(taskId: string): Promise<boolean> {
    const runtime = this.runtimes.get(taskId)
    if (!runtime || !runtime.running || !runtime.process) {
      return true
    }

    const child = runtime.process
    child.write('\u0003')

    const stoppedByCtrlC = await this.waitForExit(taskId, 1500)
    if (stoppedByCtrlC) {
      return true
    }

    await this.killTree(child.pid)
    await this.waitForExit(taskId, 1000)
    return !runtime.running
  }

  async restartTask(taskId: string): Promise<boolean> {
    await this.stopTask(taskId)
    return this.startTask(taskId)
  }

  inputTask(taskId: string, data: string): boolean {
    const runtime = this.runtimes.get(taskId)
    if (!runtime || !runtime.running || !runtime.process) {
      return false
    }

    runtime.process.write(data)
    return true
  }

  getTaskBuffer(taskId: string): string {
    return this.runtimes.get(taskId)?.buffer ?? ''
  }

  clearTaskBuffer(taskId: string): boolean {
    const runtime = this.runtimes.get(taskId)
    if (!runtime) {
      const resolved = this.findTask(taskId)
      if (!resolved) {
        return false
      }
      this.runtimes.set(taskId, {
        task: resolved.task,
        running: false,
        buffer: '',
      })
      return true
    }

    runtime.buffer = ''
    return true
  }

  isTaskRunning(taskId: string): boolean {
    return this.runtimes.get(taskId)?.running ?? false
  }

  getTaskPid(taskId: string): number | undefined {
    return this.runtimes.get(taskId)?.process?.pid
  }

  listRunningTaskIds(): string[] {
    return Array.from(this.runtimes.entries())
      .filter(([, runtime]) => runtime.running)
      .map(([taskId]) => taskId)
  }

  private ensureRuntime(task: TaskConfig): TaskRuntime {
    const existing = this.runtimes.get(task.id)
    if (existing) {
      existing.task = task
      return existing
    }

    const runtime: TaskRuntime = {
      task,
      running: false,
      buffer: '',
    }
    this.runtimes.set(task.id, runtime)
    return runtime
  }

  private findTask(taskId: string): ResolvedTask | undefined {
    for (const project of this.getConfig().projects) {
      const task = project.tasks.find((item) => item.id === taskId)
      if (task) {
        return {
          task,
          cwd: project.path,
        }
      }
    }

    return undefined
  }

  private pushToBuffer(existing: string, chunk: string): string {
    const combined = existing + chunk
    if (combined.length <= this.maxBufferChars) {
      return combined
    }

    return combined.slice(combined.length - this.maxBufferChars)
  }

  private waitForExit(taskId: string, timeoutMs: number): Promise<boolean> {
    return new Promise((resolve) => {
      const start = Date.now()
      const timer = setInterval(() => {
        if (!this.isTaskRunning(taskId)) {
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

  private killTree(pid: number): Promise<void> {
    return new Promise((resolve) => {
      kill(pid, 'SIGTERM', () => resolve())
    })
  }
}
