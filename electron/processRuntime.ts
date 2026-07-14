import * as pty from 'node-pty'
import kill from 'tree-kill'

export interface ProcessDefinition {
  id: string
  name: string
  command: string
  args: string[]
  cwd: string
  env?: Record<string, string>
}

export interface ProcessExit {
  processId: string
  exitCode: number | null
  signal?: number
}

interface ProcessRuntime {
  definition: ProcessDefinition
  process?: pty.IPty
  running: boolean
  buffer: string
  cols: number
  rows: number
}

interface ProcessRuntimeOptions {
  onData: (processId: string, chunk: string) => void
  onStatus: (processId: string, running: boolean) => void
  onExit: (event: ProcessExit) => void
  maxBufferChars?: number
}

export class ProcessRuntimeManager {
  private readonly runtimes = new Map<string, ProcessRuntime>()
  private readonly defaultCols = 120
  private readonly defaultRows = 30
  private readonly maxBufferChars: number

  constructor(private readonly options: ProcessRuntimeOptions) {
    this.maxBufferChars = options.maxBufferChars ?? 250_000
  }

  start(definition: ProcessDefinition): boolean {
    if (!definition.command.trim()) {
      return false
    }

    const runtime = this.ensureRuntime(definition)
    if (runtime.running) {
      return true
    }

    let child: pty.IPty
    try {
      let spawnCommand = definition.command
      let spawnArgs = definition.args
      if (process.platform === 'win32') {
        spawnCommand = process.env.ComSpec || 'cmd.exe'
        spawnArgs = ['/d', '/s', '/c', definition.command, ...definition.args]
      }
      child = pty.spawn(spawnCommand, spawnArgs, {
        name: 'xterm-256color',
        cols: runtime.cols,
        rows: runtime.rows,
        cwd: definition.cwd,
        env: {
          ...process.env,
          ...definition.env,
          TERM: 'xterm-256color',
        },
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      const chunk = `\r\n[exedeck] Failed to start "${definition.name}": ${message}\r\n`
      runtime.buffer = this.pushToBuffer(runtime.buffer, chunk)
      this.options.onData(definition.id, chunk)
      this.options.onStatus(definition.id, false)
      return false
    }

    runtime.definition = definition
    runtime.process = child
    runtime.running = true
    this.options.onStatus(definition.id, true)

    child.onData((chunk) => {
      runtime.buffer = this.pushToBuffer(runtime.buffer, chunk)
      this.options.onData(definition.id, chunk)
    })

    child.onExit(({ exitCode, signal }) => {
      runtime.running = false
      runtime.process = undefined
      this.options.onStatus(definition.id, false)
      this.options.onExit({ processId: definition.id, exitCode, signal })
    })

    return true
  }

  async stop(processId: string): Promise<boolean> {
    const runtime = this.runtimes.get(processId)
    if (!runtime || !runtime.running || !runtime.process) {
      return true
    }

    const child = runtime.process
    try {
      child.write('\u0003')
    } catch {
      // The PTY may have exited between lookup and write.
    }

    if (await this.waitForExit(processId, 1500)) {
      return true
    }

    await new Promise<void>((resolve) => {
      kill(child.pid, 'SIGTERM', () => resolve())
    })
    await this.waitForExit(processId, 1000)
    return !runtime.running
  }

  async restart(definition: ProcessDefinition): Promise<boolean> {
    return (await this.stop(definition.id)) && this.start(definition)
  }

  input(processId: string, data: string): boolean {
    const process = this.runtimes.get(processId)?.process
    if (!process) {
      return false
    }
    try {
      process.write(data)
      return true
    } catch {
      return false
    }
  }

  resize(processId: string, cols: number, rows: number): boolean {
    const runtime = this.runtimes.get(processId)
    if (!runtime) {
      return false
    }
    runtime.cols = Number.isFinite(cols) ? Math.min(1000, Math.max(20, Math.floor(cols))) : this.defaultCols
    runtime.rows = Number.isFinite(rows) ? Math.min(500, Math.max(5, Math.floor(rows))) : this.defaultRows
    try {
      runtime.process?.resize(runtime.cols, runtime.rows)
      return true
    } catch {
      return false
    }
  }

  ensure(definition: ProcessDefinition): void {
    this.ensureRuntime(definition)
  }

  getBuffer(processId: string): string {
    return this.runtimes.get(processId)?.buffer ?? ''
  }

  clearBuffer(processId: string): boolean {
    const runtime = this.runtimes.get(processId)
    if (!runtime) {
      return false
    }
    runtime.buffer = ''
    return true
  }

  isRunning(processId: string): boolean {
    return this.runtimes.get(processId)?.running ?? false
  }

  getPid(processId: string): number | undefined {
    return this.runtimes.get(processId)?.process?.pid
  }

  getStatus(processId: string): { running: boolean; pid?: number } {
    const runtime = this.runtimes.get(processId)
    const pid = runtime?.process?.pid
    return { running: runtime?.running ?? false, ...(pid ? { pid } : {}) }
  }

  listRunningIds(): string[] {
    return Array.from(this.runtimes.entries())
      .filter(([, runtime]) => runtime.running)
      .map(([id]) => id)
  }

  forget(processId: string): void {
    if (!this.isRunning(processId)) {
      this.runtimes.delete(processId)
    }
  }

  async stopAll(): Promise<void> {
    await Promise.all(this.listRunningIds().map((id) => this.stop(id)))
  }

  killAllImmediately(): void {
    for (const runtime of this.runtimes.values()) {
      try {
        runtime.process?.kill()
      } catch {
        // The process may already be gone.
      }
      runtime.running = false
      runtime.process = undefined
    }
  }

  private ensureRuntime(definition: ProcessDefinition): ProcessRuntime {
    const existing = this.runtimes.get(definition.id)
    if (existing) {
      existing.definition = definition
      return existing
    }
    const runtime: ProcessRuntime = {
      definition,
      running: false,
      buffer: '',
      cols: this.defaultCols,
      rows: this.defaultRows,
    }
    this.runtimes.set(definition.id, runtime)
    return runtime
  }

  private pushToBuffer(existing: string, chunk: string): string {
    const combined = existing + chunk
    return combined.length <= this.maxBufferChars
      ? combined
      : combined.slice(combined.length - this.maxBufferChars)
  }

  private waitForExit(processId: string, timeoutMs: number): Promise<boolean> {
    return new Promise((resolve) => {
      const startedAt = Date.now()
      const timer = setInterval(() => {
        if (!this.isRunning(processId) || Date.now() - startedAt >= timeoutMs) {
          clearInterval(timer)
          resolve(!this.isRunning(processId))
        }
      }, 50)
    })
  }
}
