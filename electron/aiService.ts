import { spawn } from 'node:child_process'
import type { AiCommitMessage, AppConfig } from '../shared/types'
import type { GitService } from './gitService'

export class AiService {
  constructor(
    private readonly getConfig: () => AppConfig,
    private readonly git: GitService,
  ) {}

  async generateCommitMessage(checkoutId: string): Promise<AiCommitMessage> {
    const diff = await this.git.stagedDiff(checkoutId)
    if (!diff.trim()) throw new Error('Stage changes before generating a commit message.')
    const config = this.getConfig()
    const profile = config.agentProfiles.find((item) => item.id === config.preferences.aiProfileId)
    if (!profile || profile.tool !== 'codex' || !profile.command) {
      throw new Error('Select an enabled Codex profile in settings for AI Git suggestions.')
    }
    const prompt = [
      'Write a Git commit message for the staged diff below.',
      'Return exactly a one-line summary, then a blank line, then an optional concise description.',
      'Do not use Markdown fences or commentary.',
      '',
      diff,
    ].join('\n')
    const output = await runCodex(profile.command, [...profile.args, 'exec', '-'], prompt)
    const [summary = '', ...rest] = output.trim().split('\n')
    if (!summary.trim()) throw new Error('The AI provider returned an empty commit message.')
    return { summary: summary.trim().slice(0, 200), description: rest.join('\n').trim().slice(0, 10_000) }
  }
}

function runCodex(command: string, args: string[], input: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    const timer = setTimeout(() => child.kill('SIGTERM'), 120_000)
    child.stdout.on('data', (chunk: Buffer) => { stdout = (stdout + chunk.toString('utf8')).slice(-200_000) })
    child.stderr.on('data', (chunk: Buffer) => { stderr = (stderr + chunk.toString('utf8')).slice(-20_000) })
    child.on('error', (error) => { clearTimeout(timer); reject(error) })
    child.on('close', (code) => {
      clearTimeout(timer)
      if (code === 0) resolve(stdout)
      else reject(new Error(stderr.trim() || `Codex exited with code ${code ?? 'unknown'}.`))
    })
    child.stdin.end(input)
  })
}
