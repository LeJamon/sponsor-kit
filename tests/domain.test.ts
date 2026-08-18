import { describe, expect, it } from 'vitest'
import { xrpToDrops } from '../server/domain/amounts'
import { canonicalHash, canonicalJson } from '../server/domain/canonical-json'
import { assertTransition, canTransition } from '../server/domain/intent-state'
import { evaluatePolicy, policyDocumentSchema } from '../server/domain/policy'
import { hasPlatformAdminRole } from '../lib/roles'
import { transactionExplorerUrl } from '../app/utils/explorer'

describe('canonical JSON', () => {
  it('is stable regardless of object insertion order', () => {
    expect(canonicalJson({ b: 2, a: { d: 4, c: 3 } })).toBe('{"a":{"c":3,"d":4},"b":2}')
    expect(canonicalHash({ b: 2, a: 1 })).toBe(canonicalHash({ a: 1, b: 2 }))
  })
})

describe('XRP amounts', () => {
  it('converts XRP decimals without floating point arithmetic', () => {
    expect(xrpToDrops('1')).toBe(1_000_000n)
    expect(xrpToDrops('0.2')).toBe(200_000n)
    expect(() => xrpToDrops('0.0000001')).toThrow('Invalid XRP amount')
  })
})

describe('intent state machine', () => {
  it('allows only explicit forward transitions', () => {
    expect(canTransition('submitted', 'validated')).toBe(true)
    expect(canTransition('validated', 'submitted')).toBe(false)
    expect(() => assertTransition('rejected', 'submitting')).toThrow('Illegal intent transition')
  })
})

describe('policy evaluation', () => {
  const policy = policyDocumentSchema.parse({
    allowedTransactionTypes: ['Payment'], allowedDestinations: ['rDestination'],
    allowedFields: ['Destination', 'Amount'], maximumFeeDrops: '100', maximumReserveDrops: '0',
    maximumIntentsPerWalletPerDay: 10, intentTtlSeconds: 300
  })

  it('approves a bounded payment', () => {
    expect(evaluatePolicy({ policy, transaction: { TransactionType: 'Payment', Account: 'rAccount', Destination: 'rDestination', Amount: '10' }, account: 'rAccount', feeDrops: 12n, reserveDrops: 0n })).toEqual({ allowed: true })
  })

  it('rejects signing fields and excessive fees', () => {
    expect(evaluatePolicy({ policy, transaction: { TransactionType: 'Payment', Account: 'rAccount', TxnSignature: 'bad' }, account: 'rAccount', feeDrops: 12n, reserveDrops: 0n })).toMatchObject({ allowed: false, code: 'SIGNING_FIELD_FORBIDDEN' })
    expect(evaluatePolicy({ policy, transaction: { TransactionType: 'Payment', Account: 'rAccount' }, account: 'rAccount', feeDrops: 101n, reserveDrops: 0n })).toMatchObject({ allowed: false, code: 'FEE_LIMIT_EXCEEDED' })
  })
})

describe('platform roles', () => {
  it('recognizes admin in a comma-separated Better Auth role value', () => {
    expect(hasPlatformAdminRole('user,admin')).toBe(true)
    expect(hasPlatformAdminRole('user')).toBe(false)
    expect(hasPlatformAdminRole(undefined)).toBe(false)
  })
})

describe('XRPL explorer links', () => {
  const hash = 'a'.repeat(64)

  it('maps supported networks to their explorer and normalizes the hash', () => {
    expect(transactionExplorerUrl('devnet', hash)).toBe(`https://devnet.xrpl.org/transactions/${hash.toUpperCase()}`)
    expect(transactionExplorerUrl('testnet', hash)).toBe(`https://testnet.xrpl.org/transactions/${hash.toUpperCase()}`)
    expect(transactionExplorerUrl('mainnet', hash)).toBe(`https://livenet.xrpl.org/transactions/${hash.toUpperCase()}`)
  })

  it('rejects unsupported networks and malformed hashes', () => {
    expect(transactionExplorerUrl('sidechain', hash)).toBeUndefined()
    expect(transactionExplorerUrl('devnet', 'not-a-hash')).toBeUndefined()
    expect(transactionExplorerUrl('devnet', null)).toBeUndefined()
  })
})
