import type {
  AppConfig,
  Checkout,
  TaskConfig,
  TaskDataEvent,
  TaskExitEvent,
  TaskRuntimeSnapshot,
  TaskStartRequest,
  TaskStartResult,
  TaskStatusEvent,
  WorkspaceTerminal,
} from '../shared/types'
import type { ProcessDefinition } from './processRuntime'
import { ProcessRuntimeManager } from './processRuntime'

interface TaskManagerOptions {
  getConfig: () => AppConfig
  resolveCheckout: (checkoutId: string) => Promise<Checkout | null>
  onData: (event: TaskDataEvent) => void
  onStatus: (event: TaskStatusEvent) => void
  onExit: (event: TaskExitEvent) => void
  maxBufferChars?: number
}

export class TaskManager {
  private readonly runtime: ProcessRuntimeManager
  private readonly bindings = new Map<string, { checkoutId: string; definition: ProcessDefinition }>()

  constructor(private readonly options: TaskManagerOptions) {
    this.runtime = new ProcessRuntimeManager({
      maxBufferChars: options.maxBufferChars,
      onData: (taskId, chunk) => options.onData({ taskId, chunk }),
      onStatus: (taskId, running) =>
        options.onStatus({ taskId, running, checkoutId: this.bindings.get(taskId)?.checkoutId }),
      onExit: ({ processId, exitCode, signal }) => options.onExit({ taskId: processId, exitCode, signal }),
    })
  }

  async startTask(request: TaskStartRequest): Promise<TaskStartResult> {
    const resolved = this.findTask(request.taskId)
    if (!resolved) return this.startFailure('Task not found.')
    const existing = this.getTaskStatus(request.taskId)
    if (existing.running) {
      return {
        ok: existing.checkoutId === (request.checkoutId ?? `${resolved.projectId}:root`),
        running: true,
        alreadyRunning: true,
        ...(existing.checkoutId ? { checkoutId: existing.checkoutId } : {}),
        message: 'This task already has a running instance.',
      }
    }

    const rootCheckoutId = `${resolved.projectId}:root`
    const checkoutId = request.checkoutId ?? resolved.defaultCheckoutId
    const checkout = checkoutId === rootCheckoutId ? null : await this.options.resolveCheckout(checkoutId)
    if (checkoutId !== rootCheckoutId && (!checkout || checkout.projectId !== resolved.projectId)) {
      return this.startFailure('The selected checkout is unavailable.')
    }
    const definition = this.toDefinition(resolved.task, checkout?.path ?? resolved.projectPath)
    this.bindings.set(request.taskId, { checkoutId, definition })
    const ok = this.runtime.start(definition)
    return { ok, running: ok, alreadyRunning: false, checkoutId }
  }

  stopTask(taskId: string): Promise<boolean> {
    return this.runtime.stop(taskId)
  }

  async restartTask(request: TaskStartRequest): Promise<TaskStartResult> {
    if (!(await this.stopTask(request.taskId))) return this.startFailure('The task did not stop cleanly.')
    return this.startTask(request)
  }

  inputTask(taskId: string, data: string): boolean {
    return this.runtime.input(taskId, data)
  }

  resizeTask(taskId: string, cols: number, rows: number): boolean {
    let binding = this.bindings.get(taskId)
    if (!binding) {
      const resolved = this.findTask(taskId)
      if (!resolved) return false
      binding = {
        checkoutId: resolved.defaultCheckoutId,
        definition: this.toDefinition(resolved.task, resolved.projectPath),
      }
      this.bindings.set(taskId, binding)
    }
    this.runtime.ensure(binding.definition)
    return this.runtime.resize(taskId, cols, rows)
  }

  getTaskBuffer(taskId: string): string {
    return this.runtime.getBuffer(taskId)
  }

  clearTaskBuffer(taskId: string): boolean {
    return this.runtime.clearBuffer(taskId)
  }

  isTaskRunning(taskId: string): boolean {
    return this.runtime.isRunning(taskId)
  }
  getTaskPid(taskId: string): number | undefined {
    return this.runtime.getPid(taskId)
  }
  getTaskStatus(taskId: string): TaskRuntimeSnapshot {
    const status = this.runtime.getStatus(taskId)
    const checkoutId = this.bindings.get(taskId)?.checkoutId
    return { ...status, ...(checkoutId ? { checkoutId } : {}) }
  }
  getTaskStatuses(): Record<string, { running: boolean; pid?: number }> {
    return Object.fromEntries(
      this.options
        .getConfig()
        .projects.flatMap((project) => project.tasks.map((task) => [task.id, this.getTaskStatus(task.id)]))
        .concat(
          this.options
            .getConfig()
            .workspaces.flatMap((workspace) =>
              workspace.terminals.map((terminal) => [terminal.id, this.getTaskStatus(terminal.id)]),
            ),
        ),
    )
  }
  listRunningTaskIds(): string[] {
    return this.runtime.listRunningIds()
  }

  getRunningProjectIds(): Set<string> {
    const result = new Set<string>()
    for (const project of this.options.getConfig().projects) {
      if (project.tasks.some((task) => this.runtime.isRunning(task.id))) result.add(project.id)
    }
    return result
  }

  async reconcileConfig(nextConfig: AppConfig): Promise<void> {
    const nextTasks = new Map<string, { task: TaskConfig | WorkspaceTerminal; projectPath: string }>()
    for (const project of nextConfig.projects) {
      for (const task of project.tasks) nextTasks.set(task.id, { task, projectPath: project.path })
    }
    for (const workspace of nextConfig.workspaces) {
      const projectPath = nextConfig.projects.find((project) => project.id === workspace.projectId)?.path ?? ''
      for (const terminal of workspace.terminals) nextTasks.set(terminal.id, { task: terminal, projectPath })
    }
    const toStop = this.runtime.listRunningIds().filter((id) => {
      const current = this.findTask(id)
      const next = nextTasks.get(id)
      return (
        !current ||
        !next ||
        current.projectPath !== next.projectPath ||
        current.task.command !== next.task.command ||
        current.task.args.join('\0') !== next.task.args.join('\0')
      )
    })
    await Promise.all(toStop.map((id) => this.runtime.stop(id)))
    for (const id of this.runtime.listRunningIds()) {
      const next = nextTasks.get(id)
      const binding = this.bindings.get(id)
      if (next && binding) {
        binding.definition = this.toDefinition(next.task, binding.definition.cwd)
        this.runtime.ensure(binding.definition)
      }
    }
    for (const id of this.runtime.listIds()) {
      if (!nextTasks.has(id)) {
        this.runtime.forget(id)
        this.bindings.delete(id)
      }
    }
  }

  stopAll(): Promise<void> {
    return this.runtime.stopAll()
  }
  killAllImmediately(): void {
    this.runtime.killAllImmediately()
  }

  getRunningCheckoutId(taskId: string): string | undefined {
    return this.runtime.isRunning(taskId) ? this.bindings.get(taskId)?.checkoutId : undefined
  }

  isCheckoutBusy(checkoutId: string): boolean {
    return this.runtime.listRunningIds().some((taskId) => this.bindings.get(taskId)?.checkoutId === checkoutId)
  }

  private findTask(
    taskId: string,
  ):
    | { task: TaskConfig | WorkspaceTerminal; projectId: string; projectPath: string; defaultCheckoutId: string }
    | undefined {
    for (const project of this.options.getConfig().projects) {
      const task = project.tasks.find((item) => item.id === taskId)
      if (task) {
        return {
          task,
          projectId: project.id,
          projectPath: project.path,
          defaultCheckoutId: `${project.id}:root`,
        }
      }
      const workspace = this.options
        .getConfig()
        .workspaces.find(
          (item) => item.projectId === project.id && item.terminals.some((terminal) => terminal.id === taskId),
        )
      const terminal = workspace?.terminals.find((item) => item.id === taskId)
      if (workspace && terminal) {
        return {
          task: terminal,
          projectId: project.id,
          projectPath: project.path,
          defaultCheckoutId: workspace.checkoutId,
        }
      }
    }
    return undefined
  }

  private toDefinition(task: TaskConfig | WorkspaceTerminal, projectPath: string) {
    const command = task.command.trim() || defaultShell()
    return { id: task.id, name: task.name, command, args: task.args, cwd: projectPath }
  }

  private startFailure(message: string): TaskStartResult {
    return { ok: false, running: false, alreadyRunning: false, message }
  }
}

function defaultShell(): string {
  if (process.platform === 'win32') return process.env.ComSpec || 'cmd.exe'
  return process.env.SHELL || '/bin/sh'
}
