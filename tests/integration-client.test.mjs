import { describe, expect, it, vi } from 'vitest'
import { createAcmeClient } from '../examples/lib/acme.mjs'

const options = { baseUrl: 'https://acme.example', projectId: 'proj_test', apiKey: 'server-only-secret' }

describe('developer integration client', () => {
  it('keeps the API key on authenticated backend calls and uses a stable operation ID', async () => {
    const fetchImpl = vi.fn(async () => Response.json({ id: 'intent' }))
    const client = createAcmeClient({ ...options, fetchImpl })
    await client.createPayment({ account: 'sender', destination: 'receiver', operationId: 'checkout-1' })
    const [url, request] = fetchImpl.mock.calls[0]
    expect(url).toBe('https://acme.example/api/v1/projects/proj_test/intents')
    expect(request.headers.Authorization).toBe('Bearer server-only-secret')
    expect(request.headers['Idempotency-Key']).toBe('checkout-1')
    expect(JSON.parse(request.body).transaction.Amount).toBe('1')
    expect(request.redirect).toBe('error')
    await client.authorize({ intentId: 'intent', grant: 'bound-grant', signedTransaction: 'ABCD' })
    expect(fetchImpl.mock.calls[1][1].headers.Authorization).toBeUndefined()
  })

  it('rejects insecure remote endpoints and missing idempotency keys', () => {
    expect(() => createAcmeClient({ ...options, baseUrl: 'http://remote.example' })).toThrow('HTTPS')
    expect(() => createAcmeClient({ ...options, baseUrl: 'https://user:password@remote.example' })).toThrow('app URL')
    const client = createAcmeClient(options)
    expect(() => client.createPayment({ account: 'sender', destination: 'receiver' })).toThrow('operationId')
    expect(() => client.createPayment({ account: 'sender', destination: 'receiver', operationId: '1', amountDrops: '0.1' })).toThrow('integer')
  })

  it('does not leak arbitrary remote response bodies in errors', async () => {
    const client = createAcmeClient({ ...options, fetchImpl: async () => new Response('sensitive signing artifact', { status: 403 }) })
    await expect(client.getIntent('intent')).rejects.toThrow('ACME request failed (403)')
    await expect(client.getIntent('intent')).rejects.not.toThrow('sensitive')
  })

  it('keeps polling submitted transactions until a ledger-final result', async () => {
    vi.useFakeTimers()
    try {
      const fetchImpl = vi.fn().mockResolvedValueOnce(Response.json({ state: 'submitted' })).mockResolvedValueOnce(Response.json({ state: 'validated' }))
      const update = vi.fn()
      const result = createAcmeClient({ ...options, fetchImpl }).waitForIntent('intent', { onUpdate: update })
      await vi.advanceTimersByTimeAsync(500)
      await expect(result).resolves.toEqual({ state: 'validated' })
      expect(update.mock.calls.map(([intent]) => intent.state)).toEqual(['submitted', 'validated'])
    } finally {
      vi.useRealTimers()
    }
  })

  it('bounds polling and preserves the ID for manual resume', async () => {
    const fetchImpl = vi.fn()
    await expect(createAcmeClient({ ...options, fetchImpl }).waitForIntent('saved-intent', { timeoutMs: 0 })).rejects.toThrow('Resume polling intent saved-intent')
    expect(fetchImpl).not.toHaveBeenCalled()
  })
})
