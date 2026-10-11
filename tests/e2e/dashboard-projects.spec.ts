import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
import { createTestAccount } from './signup'

test('project creation, selection, and collapsed navigation persist without mixing project data', async ({ page, baseURL }) => {
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  const signup = await createTestAccount(page.request, baseURL!, {
    name: 'Project tester', email: `projects-${randomUUID()}@example.invalid`, password: `Projects-${randomUUID()}!`
  })
  expect(signup.ok()).toBe(true)
  const onboarding = await page.request.post('/api/onboarding', {
    headers: { origin: baseURL! }, data: { organizationName: 'Project test workspace' }
  })
  expect(onboarding.status()).toBe(201)
  const first = await onboarding.json()

  await page.goto('/app')
  await expect(page.getByRole('heading', { name: 'My first project overview', exact: true })).toBeVisible()
  await expect(page.getByText(/pilot|systems operational|system status unavailable/i)).toHaveCount(0)
  await page.getByRole('button', { name: 'Collapse sidebar', exact: true }).click()
  await expect(page.getByRole('navigation', { name: 'Console navigation', exact: true })).toHaveCount(0)
  await page.reload()
  await expect(page.getByRole('button', { name: 'Expand sidebar', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Choose project', exact: true }).click()
  await page.getByRole('menuitem', { name: 'Create project', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Create project', exact: true })).toBeVisible()
  await page.getByLabel('Project name', { exact: true }).fill('Demo application')

  // Simulate losing the response after the server committed the project.
  await page.route('**/api/console/projects', async (route) => {
    const response = await route.fetch()
    expect(response.status()).toBe(201)
    await route.fulfill({ status: 503, json: { statusMessage: 'Response interrupted. Retry creation.' } })
  }, { times: 1 })
  await page.getByRole('button', { name: 'Create project', exact: true }).click()
  await expect(page.getByText('Project creation needs attention', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Retry creation', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Demo application overview', exact: true })).toBeVisible()
  const context = await (await page.request.get('/api/console/context')).json()
  expect(context.projects).toHaveLength(2)
  const second = context.projects.find((item: { project: { name: string } }) => item.project.name === 'Demo application')
  expect(second.organization.id).toBe(first.organization.id)
  await page.reload()
  await expect(page.getByRole('heading', { name: 'Demo application overview', exact: true })).toBeVisible()

  const key = await page.request.post(`/api/console/projects/${second.project.publicId}/api-keys`, {
    headers: { origin: baseURL! }, data: { name: 'Demo-only key', scopes: ['intents:read'] }
  })
  expect(key.ok()).toBe(true)
  await page.getByRole('button', { name: 'Expand sidebar', exact: true }).click()
  for (const [label, endpoint] of [
    ['Policies', 'policies'],
    ['Funding', 'funding'],
    ['Intents', 'intents'],
    ['Reserve migration', 'reserve-migration-plans'],
    ['First sponsored payment', 'protocol']
  ]) {
    const response = page.waitForResponse(item => item.url().includes(`/api/console/projects/${second.project.publicId}/${endpoint}`))
    await page.getByRole('link', { name: label, exact: true }).click()
    expect((await response).ok()).toBe(true)
  }
  await page.getByRole('link', { name: 'API keys', exact: true }).click()
  await expect(page.getByText('Demo-only key', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Choose project', exact: true }).click()
  await page.getByRole('menuitem', { name: /My first project/ }).click()
  await expect(page.getByRole('heading', { name: 'My first project overview', exact: true })).toBeVisible()
  await page.getByRole('link', { name: 'API keys', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'API keys', exact: true })).toBeVisible()
  await expect(page.getByText('Demo-only key', { exact: true })).toHaveCount(0)
  await page.screenshot({ path: 'test-results/dashboard-projects-desktop.png', fullPage: true })

  await page.setViewportSize({ width: 390, height: 844 })
  await page.getByRole('button', { name: 'Open navigation', exact: true }).click()
  await page.getByRole('dialog').getByRole('link', { name: 'Overview', exact: true }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await page.getByRole('button', { name: 'Choose project', exact: true }).click()
  await page.getByRole('menuitem', { name: /Demo application/ }).click()
  await expect(page.getByRole('heading', { name: 'Demo application overview', exact: true })).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.screenshot({ path: 'test-results/dashboard-projects-mobile.png', fullPage: true })
  expect(errors).toEqual([])
})
