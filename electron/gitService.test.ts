import { execFile } from 'node:child_process'
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { describe, expect, it } from 'vitest'
import { createDefaultConfig } from './config'
import { GitService } from './gitService'

const exec = promisify(execFile)

async function repository() {
  const root = await mkdtemp(path.join(tmpdir(), 'exedeck-git-'))
  await exec('git', ['init', '-b', 'main'], { cwd: root })
  await exec('git', ['config', 'user.name', 'Exedeck Test'], { cwd: root })
  await exec('git', ['config', 'user.email', 'test@example.com'], { cwd: root })
  await writeFile(path.join(root, 'tracked.txt'), 'one\n', 'utf8')
  await exec('git', ['add', 'tracked.txt'], { cwd: root })
  await exec('git', ['commit', '-m', 'Initial commit'], { cwd: root })
  const config = createDefaultConfig()
  config.onboardingCompleted = true
  config.projects = [{ id: 'project-test', name: 'Test', path: root, framework: 'custom', autoStart: false, tasks: [] }]
  const service = new GitService({ getConfig: () => config, isCheckoutBusy: () => false })
  return { root, service, config }
}

describe('GitService', () => {
  it('parses status, stages, commits, and reads history', async () => {
    const { root, service } = await repository()
    await writeFile(path.join(root, 'tracked.txt'), 'one\ntwo\n', 'utf8')
    await writeFile(path.join(root, 'new file.txt'), 'new\n', 'utf8')
    const [checkout] = await service.listCheckouts('project-test')

    const changed = await service.status(checkout.id)
    expect(changed.branch).toBe('main')
    expect(changed.files.map((file) => file.path).sort()).toEqual(['new file.txt', 'tracked.txt'])
    expect(changed.files.find((file) => file.path === 'tracked.txt')?.workingPatch).toContain('+two')

    expect(
      (
        await service.stage(
          checkout.id,
          changed.files.map((file) => file.path),
        )
      ).ok,
    ).toBe(true)
    expect((await service.commit(checkout.id, 'Add files', 'Exercise structured status')).ok).toBe(true)
    const history = await service.history(checkout.id)
    expect(history[0].subject).toBe('Add files')
    expect((await service.status(checkout.id)).clean).toBe(true)
  })

  it('creates isolated worktrees on their own branches', async () => {
    const { root, service, config } = await repository()
    const worktreePath = path.join(path.dirname(root), `${path.basename(root)}-worktree`)
    await mkdir(path.dirname(worktreePath), { recursive: true })
    const created = await service.createWorktree({
      projectId: 'project-test',
      path: worktreePath,
      branch: 'agent/test',
      createBranch: true,
    })
    expect(created.ok).toBe(true)
    const worktree = (await service.listCheckouts('project-test')).find((item) => !item.isMain)
    expect(worktree?.branch).toBe('agent/test')

    const guarded = new GitService({
      getConfig: () => config,
      isCheckoutBusy: (checkoutId) => checkoutId === worktree?.id,
    })
    const blocked = await guarded.removeWorktree(worktree?.id ?? '')
    expect(blocked.ok).toBe(false)
    expect(blocked.output).toContain('Stop processes')
  })
})
