import type { Page } from '@playwright/test'
import { expect, test } from './exedeck.fixture'

const windowSizes = [
  { name: 'standard', width: 1280, height: 800 },
  { name: 'minimum', width: 760, height: 560 },
] as const

async function expectScreenshot(page: Page, name: string): Promise<void> {
  await expect(page).toHaveScreenshot(name)
}

async function expectKeySurfacesInsideViewport(page: Page): Promise<void> {
  const violations = await page
    .locator('.app-shell, .layout, .main-panel, .workbench-row, .git-workspace, .task-panel')
    .evaluateAll((elements) =>
      elements.flatMap((element) => {
        const rect = element.getBoundingClientRect()
        if (rect.width === 0 || rect.height === 0) return []
        return rect.left < -1 || rect.right > window.innerWidth + 1
          ? [`${element.className}: left=${rect.left}, right=${rect.right}, viewport=${window.innerWidth}`]
          : []
      }),
    )
  expect(violations).toEqual([])
}

for (const size of windowSizes) {
  test(`onboarding at ${size.name} window size`, async ({ launchApp }) => {
    const { page, resize } = await launchApp('onboarding')
    await resize(size.width, size.height)

    await expect(page.getByRole('heading', { name: 'Open your first project' })).toBeVisible()
    await expectScreenshot(page, `onboarding-${size.name}.png`)

    await page
      .locator('.first-run-actions')
      .getByRole('button', { name: /Clone Repository/ })
      .click()
    const cloneDialog = page.getByRole('dialog', { name: 'Clone repository' })
    await expect(cloneDialog).toBeVisible()
    expect((await cloneDialog.boundingBox())?.height).toBeLessThan(420)
    await expectScreenshot(page, `clone-repository-${size.name}.png`)
  })

  test(`primary application surfaces at ${size.name} window size`, async ({ launchApp }) => {
    const { page, resize } = await launchApp('populated')
    await resize(size.width, size.height)

    await page.locator('.workspace-item').getByText('Polish the desktop experience', { exact: true }).click()
    await expect(page.getByRole('heading', { name: 'Polish the desktop experience' })).toBeVisible()
    await expectKeySurfacesInsideViewport(page)
    await expectScreenshot(page, `workspace-${size.name}.png`)

    await page
      .getByRole('button', { name: /Git changes, commits, and branches/ })
      .first()
      .click()
    await expect(page.locator('.branch-pill')).toContainText('main')
    await expectKeySurfacesInsideViewport(page)

    await page.locator('.sidebar-header').getByRole('button', { name: 'New worktree workspace' }).click()
    await expect(page.getByRole('heading', { name: 'New worktree workspace' })).toBeVisible()
    await page.getByRole('button', { name: 'Cancel' }).click()

    await page.getByRole('button', { name: /Type checking/ }).click()
    await expect(page.getByRole('heading', { name: 'Type checking' })).toBeVisible()
    await expectKeySurfacesInsideViewport(page)
    await expectScreenshot(page, `workspace-tasks-${size.name}.png`)

    await page
      .getByRole('button', { name: /Exedeck Visual Fixture/ })
      .first()
      .click()
    await expect(page.getByRole('heading', { name: 'Exedeck Visual Fixture' })).toBeVisible()
    await expectScreenshot(page, `project-landing-${size.name}.png`)

    await page.locator('.landing-primary').getByRole('button', { name: 'New worktree workspace' }).click()
    await expect(page.getByRole('heading', { name: 'New worktree workspace' })).toBeVisible()
    await expectScreenshot(page, `new-workspace-${size.name}.png`)
    await page.getByRole('button', { name: 'Cancel' }).click()

    await page.getByRole('button', { name: 'Project settings' }).click()
    await expect(page.getByRole('heading', { name: 'Project settings' })).toBeVisible()
    await expectScreenshot(page, `project-settings-${size.name}.png`)
    await page.getByRole('button', { name: 'Delete Project' }).click()
    await expect(page.getByRole('heading', { name: 'Delete project?' })).toBeVisible()
    await expectScreenshot(page, `delete-project-${size.name}.png`)
  })
}
