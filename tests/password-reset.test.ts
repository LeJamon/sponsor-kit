import { describe, expect, it, vi } from 'vitest'
import { createPasswordResetSender, isPasswordResetEnabled, resolvePasswordResetTransport } from '../server/utils/password-reset'

const message = {
  user: { email: 'person@example.com', name: 'A Person' },
  url: 'https://app.example.com/reset-password/token-value',
  token: 'token-value'
}

describe('password reset delivery configuration', () => {
  it('keeps password reset disabled when delivery is not configured', () => {
    expect(resolvePasswordResetTransport({})).toBeUndefined()
    expect(isPasswordResetEnabled({})).toBe(false)
    expect(createPasswordResetSender({})).toBeUndefined()
  })

  it('requires the sender and secret for a generic HTTP transport', () => {
    expect(resolvePasswordResetTransport({
      ACME_PASSWORD_RESET_EMAIL_PROVIDER: 'http',
      ACME_PASSWORD_RESET_EMAIL_URL: 'https://mailer.example.com/send',
      ACME_PASSWORD_RESET_EMAIL_FROM: 'ACME <no-reply@example.com>'
    })).toBeUndefined()

    expect(resolvePasswordResetTransport({
      ACME_PASSWORD_RESET_EMAIL_PROVIDER: 'http',
      ACME_PASSWORD_RESET_EMAIL_URL: 'https://mailer.example.com/send',
      ACME_PASSWORD_RESET_EMAIL_SECRET: 'http-secret',
      ACME_PASSWORD_RESET_EMAIL_FROM: 'ACME <no-reply@example.com>'
    })).toMatchObject({ provider: 'http', endpoint: 'https://mailer.example.com/send' })
  })

  it('requires HTTPS for external endpoints and rejects URL credentials or queries', () => {
    const base = {
      ACME_PASSWORD_RESET_EMAIL_PROVIDER: 'http',
      ACME_PASSWORD_RESET_EMAIL_SECRET: 'http-secret',
      ACME_PASSWORD_RESET_EMAIL_FROM: 'ACME <no-reply@example.com>'
    }

    expect(resolvePasswordResetTransport({ ...base, ACME_PASSWORD_RESET_EMAIL_URL: 'http://mailer.example.com/send' })).toBeUndefined()
    expect(resolvePasswordResetTransport({ ...base, ACME_PASSWORD_RESET_EMAIL_URL: 'https://user:pass@mailer.example.com/send' })).toBeUndefined()
    expect(resolvePasswordResetTransport({ ...base, ACME_PASSWORD_RESET_EMAIL_URL: 'https://mailer.example.com/send?token=secret' })).toBeUndefined()
    expect(resolvePasswordResetTransport({
      ...base,
      ACME_PASSWORD_RESET_EMAIL_URL: 'http://127.0.0.1:8787/send',
      ACME_PASSWORD_RESET_ALLOW_INSECURE_HTTP: 'true',
      NODE_ENV: 'test'
    })).toMatchObject({ provider: 'http' })
  })

  it('sends a generic HTTP message without putting the secret in its payload', async () => {
    const fetchImplementation = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      expect(init?.headers).toMatchObject({ Authorization: 'Bearer http-secret' })
      expect(init?.redirect).toBe('error')
      expect(init?.signal).toBeInstanceOf(AbortSignal)
      expect(String(init?.body)).toContain(message.url)
      expect(String(init?.body)).not.toContain('http-secret')
      return { ok: true, status: 202 } as Response
    })
    const sender = createPasswordResetSender({
      ACME_PASSWORD_RESET_EMAIL_PROVIDER: 'http',
      ACME_PASSWORD_RESET_EMAIL_URL: 'https://mailer.example.com/send',
      ACME_PASSWORD_RESET_EMAIL_SECRET: 'http-secret',
      ACME_PASSWORD_RESET_EMAIL_FROM: 'ACME <no-reply@example.com>'
    }, fetchImplementation)

    await sender?.(message)
    expect(fetchImplementation).toHaveBeenCalledOnce()
  })

  it('does not expose secrets or reset tokens when delivery fails', async () => {
    const fetchImplementation = vi.fn(async () => ({ ok: false, status: 503 }) as Response)
    const sender = createPasswordResetSender({
      ACME_PASSWORD_RESET_EMAIL_PROVIDER: 'http',
      ACME_PASSWORD_RESET_EMAIL_URL: 'https://mailer.example.com/send',
      ACME_PASSWORD_RESET_EMAIL_SECRET: 'http-secret',
      ACME_PASSWORD_RESET_EMAIL_FROM: 'ACME <no-reply@example.com>'
    }, fetchImplementation)

    await expect(sender?.(message)).rejects.toThrow('Password reset email delivery failed')
    await expect(sender?.(message)).rejects.not.toThrow('http-secret')
    await expect(sender?.(message)).rejects.not.toThrow('token-value')
  })

  it('uses the Resend endpoint when explicitly configured', async () => {
    const fetchImplementation = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toBe('https://api.resend.com/emails')
      expect(init?.headers).toMatchObject({ Authorization: 'Bearer resend-secret' })
      return { ok: true, status: 200 } as Response
    })
    const sender = createPasswordResetSender({
      ACME_PASSWORD_RESET_EMAIL_PROVIDER: 'resend',
      ACME_PASSWORD_RESET_RESEND_API_KEY: 'resend-secret',
      ACME_PASSWORD_RESET_EMAIL_FROM: 'ACME <no-reply@example.com>'
    }, fetchImplementation)

    await sender?.(message)
    expect(fetchImplementation).toHaveBeenCalledOnce()
  })
})
