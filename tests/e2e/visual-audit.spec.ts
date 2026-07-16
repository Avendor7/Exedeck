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
    .locator('.app-shell, .layout, .main-panel, .workbench-row, .git-inspector, .task-panel')
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

    await expect(page.getByRole('heading', { name: 'Polish the desktop experience' })).toBeVisible()
    await expect(page.locator('.branch-pill')).toContainText('main')
    await expectKeySurfacesInsideViewport(page)
    await expectScreenshot(page, `workspace-${size.name}.png`)

    await page.keyboard.press('Control+j')
    await expect(page.locator('.task-panel')).toHaveCount(0)
    await page.waitForTimeout(250)
    const promptTextareaWithTasksClosed = await page.locator('.agent-prompt-bar textarea').boundingBox()
    await page.keyboard.press('Control+j')
    await expect(page.locator('.task-panel')).toBeVisible()
    await page.waitForTimeout(250)
    const promptTextareaWithTasksOpen = await page.locator('.agent-prompt-bar textarea').boundingBox()
    expect(promptTextareaWithTasksOpen?.y).toBeCloseTo(promptTextareaWithTasksClosed?.y ?? 0, 0)

    await page.locator('.sidebar-header').getByRole('button', { name: 'New agent workspace' }).click()
    await expect(page.getByRole('heading', { name: 'New agent workspace' })).toBeVisible()
    await page.getByRole('button', { name: 'Cancel' }).click()

    await page.getByRole('button', { name: 'Expand task panel' }).click()
    await expect(page.locator('.task-panel')).toHaveClass(/expanded/)
    await page.waitForTimeout(250)
    const [expandedTaskPanel, promptBarAfterExpand] = await Promise.all([
      page.locator('.task-panel').boundingBox(),
      page.locator('.agent-prompt-bar').boundingBox(),
    ])
    expect((expandedTaskPanel?.y ?? 0) + (expandedTaskPanel?.height ?? 0)).toBeCloseTo(promptBarAfterExpand?.y ?? 0, 0)
    await expectKeySurfacesInsideViewport(page)
    await expectScreenshot(page, `workspace-tasks-${size.name}.png`)

    await page
      .getByRole('button', { name: /Exedeck Visual Fixture/ })
      .first()
      .click()
    await expect(page.getByRole('heading', { name: 'Exedeck Visual Fixture' })).toBeVisible()
    await expectScreenshot(page, `project-landing-${size.name}.png`)

    await page.locator('.landing-primary').getByRole('button', { name: 'New agent workspace' }).click()
    await expect(page.getByRole('heading', { name: 'New agent workspace' })).toBeVisible()
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
