import { describe, expect, it } from 'vitest'
import { dropsToXrp, policyDocumentFromForm, xrpToDrops } from '../app/utils/policy'
import { policyDocumentSchema, validatePolicyDocument } from '../server/domain/policy'

const validDestination = 'rHb9CJAWyB4rj91VRWn96DkukG4bwdtyTh'

describe('sponsorship policy authoring', () => {
  it('converts XRP caps to drops exactly', () => {
    expect(xrpToDrops('0.000001')).toBe('1')
    expect(xrpToDrops('12.340005')).toBe('12340005')
    expect(dropsToXrp('12340005')).toBe('12.340005')
    expect(() => xrpToDrops('0.0000001')).toThrow()
  })

  it('serializes both fee and reserve caps with supported policy fields', () => {
    expect(policyDocumentFromForm({
      maximumFeeXrp: '0.01',
      maximumReserveXrp: '1000',
      maximumIntentsPerWalletPerDay: '10',
      intentTtlSeconds: '300',
      transactionTypes: ['Payment'],
      allowedDestinations: validDestination,
      allowedFields: 'Destination\nAmount'
    })).toEqual({
      allowedTransactionTypes: ['Payment'],
      allowedDestinations: [validDestination],
      allowedFields: ['Destination', 'Amount'],
      maximumFeeDrops: '10000',
      maximumReserveDrops: '1000000000',
      maximumIntentsPerWalletPerDay: 10,
      intentTtlSeconds: 300,
      requireWalletProof: true
    })
  })

  it('rejects non-classic destinations and policies without wallet proof', () => {
    const base = policyDocumentSchema.parse({
      allowedTransactionTypes: ['Payment'],
      allowedDestinations: [],
      allowedFields: [],
      maximumFeeDrops: '10000',
      maximumReserveDrops: '0',
      maximumIntentsPerWalletPerDay: 10,
      intentTtlSeconds: 300
    })
    expect(() => validatePolicyDocument({ ...base, allowedDestinations: ['not-an-address'] })).toThrow(/classic XRPL address/)
    expect(policyDocumentSchema.safeParse({ ...base, requireWalletProof: false }).success).toBe(false)
  })
})
