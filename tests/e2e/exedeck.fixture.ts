import { expect, test as base, _electron as electron } from '@playwright/test'
import type { ElectronApplication, Page } from '@playwright/test'
import { execFile } from 'node:child_process'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

const require = createRequire(import.meta.url)
const electronExecutable = require('electron') as string
const execFileAsync = promisify(execFile)
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const fixtureProjectDir = path.join(tmpdir(), 'exedeck-playwright-project')

export type AppScenario = 'onboarding' | 'populated'

export interface RunningApp {
  electronApp: ElectronApplication
  page: Page
  resize: (width: number, height: number) => Promise<void>
}

interface Fixtures {
  launchApp: (scenario: AppScenario) => Promise<RunningApp>
}

async function prepareFixtureProject(): Promise<void> {
  await rm(fixtureProjectDir, { recursive: true, force: true })
  await mkdir(fixtureProjectDir, { recursive: true })
  await writeFile(
    path.join(fixtureProjectDir, 'README.md'),
    '# Visual fixture\n\nA deterministic Git project for Exedeck UI tests.\n',
    'utf8',
  )
  await execFileAsync('git', ['init', '--initial-branch=main'], { cwd: fixtureProjectDir })
  await execFileAsync('git', ['add', 'README.md'], { cwd: fixtureProjectDir })
  await execFileAsync(
    'git',
    ['-c', 'user.name=Exedeck UI Test', '-c', 'user.email=ui-test@example.invalid', 'commit', '-m', 'Initial fixture'],
    { cwd: fixtureProjectDir },
  )
}

function populatedConfig() {
  return {
    schemaVersion: 5,
    onboardingCompleted: true,
    projects: [
      {
        id: 'visual-project',
        name: 'Exedeck Visual Fixture',
        path: fixtureProjectDir,
        framework: 'custom',
        autoStart: false,
        tasks: [
          {
            id: 'visual-dev-task',
            name: 'Development server',
            command: 'node',
            args: ['--version'],
            cwd: fixtureProjectDir,
            autoStart: false,
          },
          {
            id: 'visual-check-task',
            name: 'Type checking',
            command: 'node',
            args: ['--version'],
            cwd: fixtureProjectDir,
            autoStart: false,
          },
        ],
        branchParents: {},
      },
    ],
    preferences: {
      appearance: 'dark',
      editorCommand: 'code',
      cloneDirectory: path.dirname(fixtureProjectDir),
      aiProfileId: 'agent-profile-codex',
      lastWorkspaceId: 'visual-workspace',
    },
    agentProfiles: [
      {
        id: 'agent-profile-codex',
        name: 'Codex',
        tool: 'codex',
        command: 'codex',
        args: [],
        enabled: true,
      },
      {
        id: 'agent-profile-claude',
        name: 'Claude',
        tool: 'claude',
        command: 'claude',
        args: [],
        enabled: true,
      },
    ],
    agentWorkspaces: [
      {
        id: 'visual-workspace',
        projectId: 'visual-project',
        checkoutId: 'visual-project:root',
        profileId: 'agent-profile-codex',
        title: 'Polish the desktop experience',
        createdAt: 1_700_000_000_000,
      },
      {
        id: 'archived-workspace',
        projectId: 'visual-project',
        checkoutId: 'visual-project:root',
        profileId: 'agent-profile-claude',
        title: 'Completed visual review',
        createdAt: 1_699_000_000_000,
        archivedAt: 1_699_500_000_000,
      },
    ],
  }
}

export const test = base.extend<Fixtures>({
  launchApp: async ({ playwright }, use) => {
    void playwright
    const resources: Array<{ electronApp: ElectronApplication; userDataDir: string }> = []

    await use(async (scenario) => {
      await prepareFixtureProject()
      const userDataDir = await mkdtemp(path.join(tmpdir(), 'exedeck-playwright-user-'))
      if (scenario === 'populated') {
        await writeFile(
          path.join(userDataDir, 'exedeck.config.json'),
          JSON.stringify(populatedConfig(), null, 2),
          'utf8',
        )
      }

      const electronApp = await electron.launch({
        executablePath: electronExecutable,
        args: ['.'],
        cwd: repoRoot,
        env: {
          ...process.env,
          ACCESSIBILITY_TEST: '1',
          EXEDECK_DISABLE_UPDATES: '1',
          EXEDECK_USER_DATA_DIR: userDataDir,
        },
      })
      resources.push({ electronApp, userDataDir })
      const page = await electronApp.firstWindow()
      await page.locator('.loading').waitFor({ state: 'detached' })
      await expect(page.locator('.app-shell')).toBeVisible()
      await expect
        .poll(() => electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isVisible()))
        .toBe(true)

      return {
        electronApp,
        page,
        resize: async (width, height) => {
          const target = { width, height }
          for (let attempt = 0; attempt < 5; attempt += 1) {
            await electronApp.evaluate(({ BrowserWindow, screen }, size) => {
              const window = BrowserWindow.getAllWindows()[0]
              window.setMaximizable(false)
              if (window.isMaximized()) window.unmaximize()
              if (window.isFullScreen()) window.setFullScreen(false)
              const primaryWorkArea = screen.getPrimaryDisplay().workArea
              window.setPosition(primaryWorkArea.x + 12, primaryWorkArea.y + 12)
              window.setContentSize(size.width, size.height)
            }, target)
            await page.waitForTimeout(200)
            const first = await page.evaluate(() => ({ width: window.innerWidth, height: window.innerHeight }))
            if (first.width !== width || first.height !== height) continue
            await page.waitForTimeout(300)
            const stable = await page.evaluate(() => ({ width: window.innerWidth, height: window.innerHeight }))
            if (stable.width === width && stable.height === height) return
          }
          expect(await page.evaluate(() => ({ width: window.innerWidth, height: window.innerHeight }))).toEqual(target)
        },
      }
    })

    for (const resource of resources.reverse()) {
      await resource.electronApp.close()
      await rm(resource.userDataDir, { recursive: true, force: true })
    }
    await rm(fixtureProjectDir, { recursive: true, force: true })
  },
})

export { expect }
