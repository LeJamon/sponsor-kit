import type { APIRequestContext } from '@playwright/test'

export async function createTestAccount(request: APIRequestContext, origin: string, data: { name: string, email: string, password: string }) {
  const deadline = Date.now() + 20_000
  while (true) {
    const response = await request.post('/api/auth/sign-up/email', {
      headers: { origin }, data
    })
    // Browser cases share a loopback IP. Respect the real signup rate limit;
    // retry only rejections that cannot have created an account.
    if (response.status() !== 429 || Date.now() >= deadline) return response
    await new Promise(resolve => setTimeout(resolve, 1000))
  }
}
