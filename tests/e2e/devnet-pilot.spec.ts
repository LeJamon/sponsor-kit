import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
import { createTestAccount } from './signup'

const destination = 'rHb9CJAWyB4rj91VRWn96DkukG4bwdtyTh'

test('a developer signs a payment in the browser and can revisit its validated outcome', async ({ page, playwright, baseURL }) => {
  const browserErrors: string[] = []
  const sensitiveRequests: string[] = []
  let authorization: { grant: string, signedTransaction: string } | undefined
  page.on('pageerror', error => browserErrors.push(error.message))
  page.on('request', (request) => {
    if (request.url().endsWith('/authorize')) authorization = request.postDataJSON()
    const body = request.postData()
    if (body && /"(?:seed|privateKey|private_key)"\s*:/.test(body)) sensitiveRequests.push(request.url())
  })
  await page.route('**/api/console/devnet/fund', async (route) => {
    const { account } = route.request().postDataJSON()
    await route.fulfill({ json: { account, funded: true, pending: false, balanceDrops: '10000000000', ledgerIndex: 900000 } })
  })
  await page.goto('/sign-up')
  await page.getByLabel('Your name', { exact: true }).fill('MVP browser tester')
  await page.getByLabel('Organization', { exact: true }).fill('Browser test organization')
  await page.getByLabel('Work email', { exact: true }).fill(`browser-${randomUUID()}@example.invalid`)
  await page.getByLabel('Password', { exact: true }).fill(`Browser-${randomUUID()}!`)
  await page.getByRole('checkbox').check()
  await page.getByRole('button', { name: 'Create account', exact: true }).click()
  await expect(page).toHaveURL(/\/app(?:\/setup)?$/)
  await page.goto('/app/first-payment')
  await expect(page.getByRole('button', { name: 'Generate disposable wallet', exact: true })).toBeEnabled()
  await page.getByRole('button', { name: 'Generate disposable wallet', exact: true }).click()
  await page.getByRole('button', { name: 'Fund disposable wallet', exact: true }).click()
  await page.getByLabel('Destination address', { exact: true }).fill(destination)
  await page.getByLabel('Amount', { exact: true }).fill('1')
  await expect(page.getByRole('button', { name: 'Review sponsored payment', exact: true })).toBeEnabled()
  await page.getByRole('button', { name: 'Review sponsored payment', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Sign exact transaction', exact: true })).toBeVisible()
  await page.evaluate(() => window.scrollTo(0, 0))
  await page.screenshot({ path: 'test-results/payment-review-desktop.png', fullPage: true })
  await page.setViewportSize({ width: 390, height: 844 })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.evaluate(() => window.scrollTo(0, 0))
  await page.screenshot({ path: 'test-results/payment-review-mobile.png', fullPage: true })
  await page.setViewportSize({ width: 1280, height: 720 })
  await page.getByRole('button', { name: 'Sign exact transaction', exact: true }).click()
  await expect(page.getByText('Signature created in this tab', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Submit signed transaction', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Your first sponsored payment completed', exact: true })).toBeVisible({ timeout: 30_000 })
  await page.getByRole('link', { name: 'View transaction detail', exact: true }).click()
  await expect(page).toHaveURL(/\/app\/intents\/[a-f0-9-]+$/)
  const intentId = page.url().split('/').at(-1)!
  await page.reload()
  await expect(page.getByRole('heading', { name: 'State history', exact: true })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Open Explorer', exact: true })).toHaveAttribute('href', /devnet/)
  const context = await (await page.request.get('/api/console/context')).json()
  const projectId = context.projects[0].project.publicId
  const detailResponse = await page.request.get(`/api/console/projects/${projectId}/intents/${intentId}`)
  expect(detailResponse.status()).toBe(200)
  const detail = await detailResponse.json()
  expect(detail.state).toBe('validated')
  expect(detail.submissions.at(-1).actualFeeDrops).toBe('10')
  expect(detail.userSignedBlob).toBeUndefined()
  expect(detail.grant).toBeUndefined()
  expect(detail.submissions).toHaveLength(1)
  const replay = await page.request.post(`/api/v1/intents/${intentId}/authorize`, { data: authorization })
  expect(replay.status()).toBe(202)
  expect((await replay.json()).transactionHash).toBe(detail.submissions[0].transactionHash)
  const altered = await page.request.post(`/api/v1/intents/${intentId}/authorize`, { data: { ...authorization, signedTransaction: `${authorization!.signedTransaction}00` } })
  expect(altered.status()).toBe(409)
  const search = await page.request.get(`/api/console/projects/${projectId}/intents`, { params: { search: intentId.slice(0, 8) } })
  expect(search.status()).toBe(200)
  expect((await search.json()).items.map((item: { id: string }) => item.id)).toContain(intentId)
  await page.screenshot({ path: 'test-results/transaction-detail-desktop.png', fullPage: true })
  await page.setViewportSize({ width: 390, height: 844 })
  await page.screenshot({ path: 'test-results/transaction-detail-mobile.png', fullPage: true })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  const foreign = await playwright.request.newContext({ baseURL })
  try {
    const signup = await createTestAccount(foreign, baseURL!, {
      name: 'Another tenant', email: `foreign-${randomUUID()}@example.invalid`, password: `Foreign-${randomUUID()}!`
    })
    expect(signup.ok()).toBe(true)
    const response = await foreign.get(`/api/console/projects/${projectId}/intents/${intentId}`)
    expect(response.status()).toBe(404)
  } finally {
    await foreign.dispose()
  }
  expect(sensitiveRequests).toEqual([])
  expect(browserErrors).toEqual([])
})

test('protected routes redirect guests and password recovery explains missing email configuration', async ({ page }) => {
  await page.goto('/app/first-payment')
  await expect(page).toHaveURL(/\/sign-in\?redirect=/)
  await page.goto('/forgot-password')
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
  const config = await (await page.request.get('/api/auth/config')).json()
  expect(config.passwordResetEnabled).toBe(false)
  await expect(page.getByText(/not configured|unavailable|not available|not enabled/i).first()).toBeVisible()
})

test('an existing login can recover incomplete onboarding without duplicate projects', async ({ page, baseURL }) => {
  const signup = await createTestAccount(page.request, baseURL!, {
    name: 'Recovery tester', email: `recovery-${randomUUID()}@example.invalid`, password: `Recovery-${randomUUID()}!`
  })
  expect(signup.ok()).toBe(true)
  await page.goto('/app/setup')
  await page.getByLabel('Organization name', { exact: true }).fill('Recovered workspace')
  await page.route('**/api/onboarding', route => route.fulfill({ status: 503, json: { statusMessage: 'Temporary Devnet outage' } }), { times: 1 })
  await page.getByRole('button', { name: 'Create Devnet project', exact: true }).click()
  await expect(page.getByText('Setup needs another try', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Create Devnet project', exact: true }).click()
  await expect(page).toHaveURL(/\/app$/)
  const repeats = await Promise.all([1, 2].map(() => page.request.post('/api/onboarding', {
    headers: { origin: baseURL! }, data: { organizationName: 'Recovered workspace' }
  })))
  expect(repeats.map(response => response.status())).toEqual([200, 200])
  const projects = await Promise.all(repeats.map(response => response.json()))
  expect(projects[0].project.id).toBe(projects[1].project.id)
  const context = await (await page.request.get('/api/console/context')).json()
  expect(context.projects).toHaveLength(1)
})
