import { randomUUID } from 'node:crypto'
import { createRequire } from 'node:module'
import { expect, test } from '@playwright/test'
import { createTestAccount } from './signup'

// Load the published CommonJS entry points outside Playwright's ESM transform.
const require = createRequire(import.meta.url)
const { deriveAddress, deriveKeypair, generateSeed, sign } = require('ripple-keypairs') as typeof import('ripple-keypairs')
const { encode, encodeForSigning, XrplDefinitions } = require('ripple-binary-codec') as typeof import('ripple-binary-codec')

const destination = 'rHb9CJAWyB4rj91VRWn96DkukG4bwdtyTh'

test('an integration sponsors a payment and the console shows its validated outcome', async ({ page, playwright, baseURL }) => {
  const browserErrors: string[] = []
  const sensitiveRequests: string[] = []
  let authorization: { grant: string, signedTransaction: string } | undefined
  page.on('pageerror', error => browserErrors.push(error.message))
  page.on('request', (request) => {
    if (request.url().endsWith('/authorize')) authorization = request.postDataJSON()
    const body = request.postData()
    if (body && /"(?:seed|privateKey|private_key)"\s*:/.test(body)) sensitiveRequests.push(request.url())
  })
  await page.goto('/sign-up')
  await page.getByLabel('Your name', { exact: true }).fill('MVP browser tester')
  await page.getByLabel('Organization', { exact: true }).fill('Browser test organization')
  await page.getByLabel('Work email', { exact: true }).fill(`browser-${randomUUID()}@example.invalid`)
  await page.getByLabel('Password', { exact: true }).fill(`Browser-${randomUUID()}!`)
  // Browser cases share a loopback IP. Retry only rate-limit rejections,
  // which cannot have created an account, while keeping the real signup UI.
  await expect(async () => {
    const response = page.waitForResponse(response => response.url().endsWith('/api/auth/sign-up/email'))
    await page.getByRole('button', { name: 'Create account', exact: true }).click()
    expect((await response).status()).not.toBe(429)
  }).toPass({ intervals: [1000], timeout: 20_000 })
  await expect(page).toHaveURL(/\/app(?:\/setup)?$/)
  const context = await (await page.request.get('/api/console/context')).json()
  const projectId = context.projects[0].project.publicId
  const keyResponse = await page.request.post(`/api/console/projects/${projectId}/api-keys`, {
    headers: { origin: baseURL! }, data: { name: 'Integration test', scopes: ['intents:create', 'intents:read', 'usage:read'] }
  })
  expect(keyResponse.status()).toBe(201)
  const { secret } = await keyResponse.json()
  const headers = { authorization: `Bearer ${secret}` }
  const protocolResponse = await page.request.get(`/api/v1/projects/${projectId}/protocol`, { headers })
  expect(protocolResponse.ok()).toBe(true)
  const protocol = await protocolResponse.json()
  const wallet = deriveKeypair(generateSeed({ algorithm: 'ed25519' }))
  const account = deriveAddress(wallet.publicKey)
  const creation = await page.request.post(`/api/v1/projects/${projectId}/intents`, {
    headers: { ...headers, 'idempotency-key': randomUUID() },
    data: { account, transaction: { TransactionType: 'Payment', Destination: destination, Amount: '1000000' }, sponsorship: { fee: true, reserve: false } }
  })
  expect(creation.status(), await creation.text()).toBe(201)
  const prepared = await creation.json()
  const codec = new XrplDefinitions(protocol.definitions)
  const transaction = { ...prepared.transaction, SigningPubKey: wallet.publicKey }
  authorization = { grant: prepared.grant, signedTransaction: encode({ ...transaction, TxnSignature: sign(encodeForSigning(transaction, codec), wallet.privateKey) }, codec) }
  const authorized = await page.request.post(`/api/v1/intents/${prepared.id}/authorize`, { data: authorization })
  expect(authorized.status()).toBe(202)
  const intentId = prepared.id
  await expect.poll(async () => (await (await page.request.get(`/api/console/projects/${projectId}/intents/${intentId}`)).json()).state, { timeout: 30_000 }).toBe('validated')
  await page.goto(`/app/intents/${intentId}`)
  await page.reload()
  await expect(page.getByRole('heading', { name: 'State history', exact: true })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Open Explorer', exact: true })).toHaveAttribute('href', /devnet/)
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
  const usageResponse = await page.request.get(`/api/console/projects/${projectId}/usage`, { params: { range: '24h' } })
  expect(usageResponse.ok()).toBe(true)
  const usage = await usageResponse.json()
  expect(usage.totals).toMatchObject({ validated: 1, successRate: 100, feeSpentDrops: '10' })
  await page.setViewportSize({ width: 1280, height: 800 })
  await page.goto('/app')
  await expect(page.getByRole('heading', { name: 'Activity', exact: true })).toBeVisible()
  await expect(page.getByRole('link', { name: `View transaction ${intentId}`, exact: true })).toBeVisible()
  await page.screenshot({ path: 'test-results/overview-active-desktop.png', fullPage: true, animations: 'disabled' })
  await page.goto('/app/sponsorship/usage')
  await expect(page.getByRole('heading', { name: 'Sponsorship', exact: true })).toBeVisible()
  await page.screenshot({ path: 'test-results/sponsorship-usage-desktop.png', fullPage: true, animations: 'disabled' })
  await page.setViewportSize({ width: 390, height: 844 })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.screenshot({ path: 'test-results/sponsorship-usage-mobile.png', fullPage: true, animations: 'disabled' })
  const foreign = await playwright.request.newContext({ baseURL })
  try {
    const signup = await createTestAccount(foreign, baseURL!, {
      name: 'Another tenant', email: `foreign-${randomUUID()}@example.invalid`, password: `Foreign-${randomUUID()}!`
    })
    expect(signup.ok()).toBe(true)
    const response = await foreign.get(`/api/console/projects/${projectId}/intents/${intentId}`)
    expect(response.status()).toBe(404)
    expect((await foreign.get(`/api/console/projects/${projectId}/usage`)).status()).toBe(404)
  } finally {
    await foreign.dispose()
  }
  expect(sensitiveRequests).toEqual([])
  expect(browserErrors).toEqual([])
})

test('protected routes redirect guests and password recovery explains missing email configuration', async ({ page }) => {
  await page.goto('/app/sponsorship')
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
  await page.getByRole('button', { name: 'Create project', exact: true }).click()
  await page.getByRole('dialog').getByLabel('Name', { exact: true }).fill('Recovered project')
  await page.route('**/api/onboarding', route => route.fulfill({ status: 503, json: { statusMessage: 'Temporary Devnet outage' } }), { times: 1 })
  await page.getByRole('dialog').getByRole('button', { name: 'Create', exact: true }).click()
  await expect(page.getByText('Project creation needs attention', { exact: true })).toBeVisible()
  await page.getByRole('dialog').getByRole('button', { name: 'Retry creation', exact: true }).click()
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
