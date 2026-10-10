import { describe, expect, it } from 'vitest'
import { intentRequestSchema } from '../server/utils/intent-request'

const request = { account: 'rHb9CJAWyB4rj91VRWn96DkukG4bwdtyTh', transaction: { TransactionType: 'Payment' }, sponsorship: { fee: true, reserve: false } }

describe('intent request validation', () => {
  it('rejects a classic address with an invalid checksum', () => {
    expect(intentRequestSchema.safeParse({ ...request, account: `${request.account.slice(0, -1)}a` }).success).toBe(false)
  })

  it('requires a sponsorship mode and consistent signer count', () => {
    expect(intentRequestSchema.safeParse({ ...request, sponsorship: { fee: false, reserve: false } }).success).toBe(false)
    expect(intentRequestSchema.safeParse({ ...request, signing: { mode: 'single', signerCount: 2 } }).success).toBe(false)
    expect(intentRequestSchema.parse(request).signing).toEqual({ mode: 'single', signerCount: 1 })
  })
})
