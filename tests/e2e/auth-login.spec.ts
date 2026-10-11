import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
import { createTestAccount } from './signup'

test('provider buttons preserve safe destinations and recover from provider failures', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' })
  await page.addInitScript(() => localStorage.setItem('nuxt-color-mode', 'dark'))
  await page.route('**/api/auth/config', route => route.fulfill({ json: {
    passwordResetEnabled: false,
    socialProviders: ['google', 'github'],
    sso: { providerId: 'company-sso', label: 'Continue with company SSO' }
  } }))
  const requests: Record<string, string>[] = []
  await page.route('**/api/auth/sign-in/social', (route) => {
    requests.push(route.request().postDataJSON())
    return route.fulfill({ status: 503, json: { code: 'PROVIDER_UNAVAILABLE', message: 'Unavailable' } })
  })
  // Navigate on the client so the browser fixture supplies provider configuration.
  await page.goto('/docs')
  await page.getByRole('link', { name: 'Sign in', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Log in to ACME', exact: true })).toBeVisible()
  await expect(page.locator('html')).toHaveClass('light')
  await expect(page.getByRole('button', { name: 'Continue with Google', exact: true })).toBeVisible()
  await page.screenshot({ path: 'test-results/login-desktop.png', fullPage: true })
  await page.setViewportSize({ width: 390, height: 844 })
  await page.screenshot({ path: 'test-results/login-mobile.png', fullPage: true })
  await page.setViewportSize({ width: 1280, height: 720 })
  for (const [label, provider] of [
    ['Continue with Google', 'google'],
    ['Continue with GitHub', 'github'],
    ['Continue with company SSO', 'company-sso']
  ]) {
    await page.getByRole('button', { name: label, exact: true }).click()
    await expect(page.getByText('This sign-in method is unavailable right now. Try again or sign in with your email and password.')).toBeVisible()
    expect(requests.at(-1)).toMatchObject({ provider, callbackURL: '/app', newUserCallbackURL: '/app/setup', errorCallbackURL: '/sign-in?redirect=%2Fapp' })
    await expect(page.getByRole('button', { name: label, exact: true })).toBeEnabled()
  }
  await page.screenshot({ path: 'test-results/login-providers-desktop.png', fullPage: true })
  await page.setViewportSize({ width: 390, height: 844 })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.screenshot({ path: 'test-results/login-providers-mobile.png', fullPage: true })
})

test('login handles cancelled OAuth callbacks and offers accessible password visibility', async ({ page }) => {
  await page.goto('/sign-in?error=access_denied&redirect=%2F%5Cexample.com')
  await expect(page.getByText('Sign-in was cancelled. You can try again or use your email and password.')).toBeVisible()
  const password = page.getByLabel('Password', { exact: true })
  await password.fill('Example-password-123')
  await expect(password).toHaveAttribute('type', 'password')
  await page.getByRole('button', { name: 'Show password', exact: true }).click()
  await expect(password).toHaveAttribute('type', 'text')
  await page.getByRole('button', { name: 'Hide password', exact: true }).click()
  await expect(password).toHaveAttribute('type', 'password')
})

test('the redesigned email form signs into an existing account', async ({ page, baseURL }) => {
  const email = `login-${randomUUID()}@example.invalid`
  const password = `Login-${randomUUID()}!`
  const signup = await createTestAccount(page.request, baseURL!, { name: 'Login tester', email, password })
  expect(signup.ok()).toBe(true)
  await page.context().clearCookies()
  await page.goto('/sign-in?redirect=%2Fapp%2Fsetup')
  await page.getByLabel('Email', { exact: true }).fill(email)
  await page.getByLabel('Password', { exact: true }).fill(password)
  await page.getByRole('button', { name: 'Sign in', exact: true }).click()
  await expect(page).toHaveURL(/\/app\/setup$/)
  await expect(page.getByLabel('Organization name', { exact: true })).toBeVisible()
})
