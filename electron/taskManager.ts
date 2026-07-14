import type { AppConfig, TaskConfig, TaskDataEvent, TaskExitEvent, TaskStatusEvent } from '../shared/types'
import { ProcessRuntimeManager } from './processRuntime'

interface TaskManagerOptions {
  getConfig: () => AppConfig
  onData: (event: TaskDataEvent) => void
  onStatus: (event: TaskStatusEvent) => void
  onExit: (event: TaskExitEvent) => void
  maxBufferChars?: number
}

export class TaskManager {
  private readonly runtime: ProcessRuntimeManager

  constructor(private readonly options: TaskManagerOptions) {
    this.runtime = new ProcessRuntimeManager({
      maxBufferChars: options.maxBufferChars,
      onData: (taskId, chunk) => options.onData({ taskId, chunk }),
      onStatus: (taskId, running) => options.onStatus({ taskId, running }),
      onExit: ({ processId, exitCode, signal }) => options.onExit({ taskId: processId, exitCode, signal }),
    })
  }

  startTask(taskId: string): boolean {
    const resolved = this.findTask(taskId)
    return resolved ? this.runtime.start(this.toDefinition(resolved.task, resolved.projectPath)) : false
  }

  stopTask(taskId: string): Promise<boolean> { return this.runtime.stop(taskId) }

  restartTask(taskId: string): Promise<boolean> {
    const resolved = this.findTask(taskId)
    return resolved
      ? this.runtime.restart(this.toDefinition(resolved.task, resolved.projectPath))
      : Promise.resolve(false)
  }

  inputTask(taskId: string, data: string): boolean { return this.runtime.input(taskId, data) }

  resizeTask(taskId: string, cols: number, rows: number): boolean {
    const resolved = this.findTask(taskId)
    if (!resolved) return false
    this.runtime.ensure(this.toDefinition(resolved.task, resolved.projectPath))
    return this.runtime.resize(taskId, cols, rows)
  }

  getTaskBuffer(taskId: string): string { return this.runtime.getBuffer(taskId) }

  clearTaskBuffer(taskId: string): boolean {
    const resolved = this.findTask(taskId)
    if (!resolved) return false
    this.runtime.ensure(this.toDefinition(resolved.task, resolved.projectPath))
    return this.runtime.clearBuffer(taskId)
  }

  isTaskRunning(taskId: string): boolean { return this.runtime.isRunning(taskId) }
  getTaskPid(taskId: string): number | undefined { return this.runtime.getPid(taskId) }
  getTaskStatus(taskId: string): { running: boolean; pid?: number } { return this.runtime.getStatus(taskId) }
  listRunningTaskIds(): string[] { return this.runtime.listRunningIds() }

  getRunningProjectIds(): Set<string> {
    const result = new Set<string>()
    for (const project of this.options.getConfig().projects) {
      if (project.tasks.some((task) => this.runtime.isRunning(task.id))) result.add(project.id)
    }
    return result
  }

  async reconcileConfig(nextConfig: AppConfig): Promise<void> {
    const nextTasks = new Map<string, { task: TaskConfig; projectPath: string }>()
    for (const project of nextConfig.projects) {
      for (const task of project.tasks) nextTasks.set(task.id, { task, projectPath: project.path })
    }
    const toStop = this.runtime.listRunningIds().filter((id) => {
      const current = this.findTask(id)
      const next = nextTasks.get(id)
      return !current || !next || current.projectPath !== next.projectPath ||
        current.task.command !== next.task.command || current.task.args.join('\0') !== next.task.args.join('\0')
    })
    await Promise.all(toStop.map((id) => this.runtime.stop(id)))
    for (const id of this.runtime.listRunningIds()) {
      const next = nextTasks.get(id)
      if (next) this.runtime.ensure(this.toDefinition(next.task, next.projectPath))
    }
  }

  stopAll(): Promise<void> { return this.runtime.stopAll() }
  killAllImmediately(): void { this.runtime.killAllImmediately() }

  private findTask(taskId: string): { task: TaskConfig; projectPath: string } | undefined {
    for (const project of this.options.getConfig().projects) {
      const task = project.tasks.find((item) => item.id === taskId)
      if (task) return { task, projectPath: project.path }
    }
    return undefined
  }

  private toDefinition(task: TaskConfig, projectPath: string) {
    return { id: task.id, name: task.name, command: task.command, args: task.args, cwd: projectPath }
  }
}
