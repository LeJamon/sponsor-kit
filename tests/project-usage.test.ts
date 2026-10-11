import { randomUUID } from 'node:crypto'
import postgres from 'postgres'
import { drizzle } from 'drizzle-orm/postgres-js'
import { eq, inArray } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  fundingLedgerEntries,
  organizations,
  projectFundingBudgets,
  projects,
  sponsorAccounts,
  sponsorTreasuries,
  sponsorshipIntents,
  sponsorshipPolicies
} from '../server/database/schema'
import { readProjectUsage } from '../server/services/project-usage'

const routeMocks = vi.hoisted(() => ({ useDatabase: vi.fn() }))

vi.mock('../server/utils/database', () => ({ useDatabase: routeMocks.useDatabase }))
vi.mock('~~/server/utils/database', () => ({ useDatabase: routeMocks.useDatabase }))

const databaseUrl = process.env.MVP_FUNDING_TEST_DATABASE_URL
const runDatabaseTests = Boolean(databaseUrl)
const client = databaseUrl ? postgres(databaseUrl, { max: 4, prepare: false }) : undefined
const database = client ? drizzle(client) : undefined

describe.skipIf(!runDatabaseTests)('project usage accounting', () => {
  const ids = {
    organization: randomUUID(),
    projectA: randomUUID(),
    projectB: randomUUID(),
    treasury: randomUUID(),
    accountA: randomUUID(),
    accountB: randomUUID(),
    policyA: randomUUID(),
    policyB: randomUUID()
  }
  const now = new Date('2026-01-11T12:34:56.000Z')
  const dayMilliseconds = 24 * 60 * 60 * 1_000

  beforeAll(async () => {
    if (!database) return
    routeMocks.useDatabase.mockReturnValue(database)
    await database.insert(organizations).values({ id: ids.organization, name: 'Usage test', slug: `usage-${ids.organization}` })
    await database.insert(projects).values([
      { id: ids.projectA, organizationId: ids.organization, name: 'Usage A', publicId: `usage-a-${ids.projectA}`, network: 'devnet', rpcUrl: 'http://test.invalid' },
      { id: ids.projectB, organizationId: ids.organization, name: 'Usage B', publicId: `usage-b-${ids.projectB}`, network: 'devnet', rpcUrl: 'http://test.invalid' }
    ])
    await database.insert(sponsorTreasuries).values({ id: ids.treasury, network: 'devnet', address: `rUsage${ids.treasury.replaceAll('-', '').slice(0, 25)}`, signerKeyReference: 'test', capabilities: { fee: true, reserve: true } })
    await database.insert(sponsorAccounts).values([
      { id: ids.accountA, projectId: ids.projectA, treasuryId: ids.treasury, network: 'devnet', address: 'rUsageA', signerKeyReference: 'test', capabilities: { fee: true, reserve: true } },
      { id: ids.accountB, projectId: ids.projectB, treasuryId: ids.treasury, network: 'devnet', address: 'rUsageB', signerKeyReference: 'test', capabilities: { fee: true, reserve: true } }
    ])
    await database.insert(sponsorshipPolicies).values([
      { id: ids.policyA, projectId: ids.projectA, name: 'Payments', version: 1, status: 'active', document: {}, documentHash: 'usage-policy-a' },
      { id: ids.policyB, projectId: ids.projectA, name: 'Reserves', version: 2, status: 'paused', document: {}, documentHash: 'usage-policy-b' }
    ])
    await database.insert(projectFundingBudgets).values([
      { projectId: ids.projectA, reserveReservedDrops: 11n, reserveExposureDrops: 31n },
      { projectId: ids.projectB, reserveReservedDrops: 4n, reserveExposureDrops: 9n }
    ])
  })

  beforeEach(async () => {
    if (!database) return
    await database.delete(fundingLedgerEntries).where(inArray(fundingLedgerEntries.sponsorAccountId, [ids.accountA, ids.accountB]))
    await database.delete(sponsorshipIntents).where(inArray(sponsorshipIntents.projectId, [ids.projectA, ids.projectB]))
    await database.update(projectFundingBudgets).set({ reserveReservedDrops: 11n, reserveExposureDrops: 31n }).where(eq(projectFundingBudgets.projectId, ids.projectA))
    await database.update(projectFundingBudgets).set({ reserveReservedDrops: 4n, reserveExposureDrops: 9n }).where(eq(projectFundingBudgets.projectId, ids.projectB))
  })

  afterAll(async () => {
    if (!database || !client) return
    await database.delete(fundingLedgerEntries).where(inArray(fundingLedgerEntries.sponsorAccountId, [ids.accountA, ids.accountB]))
    await database.delete(sponsorshipIntents).where(inArray(sponsorshipIntents.projectId, [ids.projectA, ids.projectB]))
    await database.delete(projectFundingBudgets).where(inArray(projectFundingBudgets.projectId, [ids.projectA, ids.projectB]))
    await database.delete(sponsorshipPolicies).where(inArray(sponsorshipPolicies.id, [ids.policyA, ids.policyB]))
    await database.delete(sponsorAccounts).where(inArray(sponsorAccounts.id, [ids.accountA, ids.accountB]))
    await database.delete(sponsorTreasuries).where(eq(sponsorTreasuries.id, ids.treasury))
    await database.delete(projects).where(inArray(projects.id, [ids.projectA, ids.projectB]))
    await database.delete(organizations).where(eq(organizations.id, ids.organization))
    await client.end()
  })

  function makeIntent(input: {
    id: string
    projectId: string
    sponsorAccountId: string
    policyId: string
    state: 'validated' | 'failed' | 'rejected' | 'submitting'
    createdAt: Date
    updatedAt?: Date
  }) {
    return {
      id: input.id,
      projectId: input.projectId,
      sponsorAccountId: input.sponsorAccountId,
      policyId: input.policyId,
      accountAddress: `rWallet${input.id.replaceAll('-', '').slice(0, 20)}`,
      network: 'devnet' as const,
      networkId: 2,
      definitionsHash: 'usage-definitions',
      mode: 'fee',
      canonicalTransaction: { TransactionType: 'Payment' },
      canonicalHash: `usage-canonical-${input.id}`,
      preparedLedgerIndex: 1,
      requestHash: `usage-request-${input.id}`,
      policySnapshot: {},
      estimatedFeeDrops: 10n,
      estimatedReserveDrops: 0n,
      idempotencyKey: `usage-intent-${input.id}`,
      correlationId: `usage-correlation-${input.id}`,
      state: input.state,
      expiresAt: new Date(input.createdAt.getTime() + 60 * 60 * 1_000),
      createdAt: input.createdAt,
      updatedAt: input.updatedAt || input.createdAt
    }
  }

  it('uses terminal update time, capture time, and current pending state without crossing project boundaries', async () => {
    if (!database) return
    const from = new Date(now.getTime() - dayMilliseconds)
    const validA = randomUUID()
    const failedA = randomUUID()
    const pendingA = randomUUID()
    const oldA = randomUUID()
    const duplicateA = randomUUID()
    const exactFromA = randomUUID()
    const exactToA = randomUUID()
    const validB = randomUUID()
    await database.insert(sponsorshipIntents).values([
      // The request was old, but its terminal outcome is inside the window.
      makeIntent({ id: validA, projectId: ids.projectA, sponsorAccountId: ids.accountA, policyId: ids.policyA, state: 'validated', createdAt: new Date('2026-01-09T12:00:00.000Z'), updatedAt: new Date('2026-01-11T11:30:00.000Z') }),
      makeIntent({ id: failedA, projectId: ids.projectA, sponsorAccountId: ids.accountA, policyId: ids.policyB, state: 'rejected', createdAt: new Date('2026-01-11T10:00:00.000Z'), updatedAt: new Date('2026-01-11T10:30:00.000Z') }),
      // Pending is a current snapshot, even when the request predates the window.
      makeIntent({ id: pendingA, projectId: ids.projectA, sponsorAccountId: ids.accountA, policyId: ids.policyA, state: 'submitting', createdAt: new Date('2026-01-09T09:30:00.000Z'), updatedAt: new Date('2026-01-09T09:30:00.000Z') }),
      // This old terminal outcome is outside the period; its delayed capture is not.
      makeIntent({ id: oldA, projectId: ids.projectA, sponsorAccountId: ids.accountA, policyId: ids.policyA, state: 'validated', createdAt: new Date('2026-01-09T12:00:00.000Z'), updatedAt: new Date('2026-01-09T12:00:00.000Z') }),
      // A duplicate's first capture is outside the period, so its later retry is ignored.
      makeIntent({ id: duplicateA, projectId: ids.projectA, sponsorAccountId: ids.accountA, policyId: ids.policyA, state: 'validated', createdAt: new Date('2026-01-09T12:00:00.000Z'), updatedAt: new Date('2026-01-09T12:00:00.000Z') }),
      // The exact lower bound is included by the half-open interval.
      makeIntent({ id: exactFromA, projectId: ids.projectA, sponsorAccountId: ids.accountA, policyId: ids.policyA, state: 'validated', createdAt: new Date('2026-01-11T12:00:00.000Z'), updatedAt: from }),
      // The exact upper bound is excluded.
      makeIntent({ id: exactToA, projectId: ids.projectA, sponsorAccountId: ids.accountA, policyId: ids.policyA, state: 'validated', createdAt: new Date('2026-01-11T12:00:00.000Z'), updatedAt: now }),
      makeIntent({ id: validB, projectId: ids.projectB, sponsorAccountId: ids.accountB, policyId: ids.policyA, state: 'validated', createdAt: new Date('2026-01-11T11:00:00.000Z'), updatedAt: new Date('2026-01-11T11:30:00.000Z') })
    ])
    await database.insert(fundingLedgerEntries).values([
      { sponsorAccountId: ids.accountA, treasuryId: ids.treasury, intentId: validA, type: 'capture', feeDrops: 7n, idempotencyKey: `capture-${validA}-first`, createdAt: new Date('2026-01-11T11:31:00.000Z') },
      { sponsorAccountId: ids.accountA, treasuryId: ids.treasury, intentId: validA, type: 'capture', feeDrops: 99n, idempotencyKey: `capture-${validA}-duplicate`, createdAt: new Date('2026-01-11T11:32:00.000Z') },
      { sponsorAccountId: ids.accountA, treasuryId: ids.treasury, intentId: failedA, type: 'capture', feeDrops: 3n, idempotencyKey: `capture-${failedA}`, createdAt: new Date('2026-01-11T10:31:00.000Z') },
      { sponsorAccountId: ids.accountA, treasuryId: ids.treasury, intentId: oldA, type: 'capture', feeDrops: 101n, idempotencyKey: `capture-${oldA}`, createdAt: new Date('2026-01-11T12:00:00.000Z') },
      { sponsorAccountId: ids.accountA, treasuryId: ids.treasury, intentId: duplicateA, type: 'capture', feeDrops: 13n, idempotencyKey: `capture-${duplicateA}-first`, createdAt: new Date(from.getTime() - 1) },
      { sponsorAccountId: ids.accountA, treasuryId: ids.treasury, intentId: duplicateA, type: 'capture', feeDrops: 17n, idempotencyKey: `capture-${duplicateA}-retry`, createdAt: new Date('2026-01-11T11:00:00.000Z') },
      { sponsorAccountId: ids.accountA, treasuryId: ids.treasury, intentId: exactFromA, type: 'capture', feeDrops: 77n, idempotencyKey: `capture-${exactFromA}`, createdAt: from },
      { sponsorAccountId: ids.accountA, treasuryId: ids.treasury, intentId: exactToA, type: 'capture', feeDrops: 88n, idempotencyKey: `capture-${exactToA}`, createdAt: now },
      { sponsorAccountId: ids.accountB, treasuryId: ids.treasury, intentId: validB, type: 'capture', feeDrops: 55n, idempotencyKey: `capture-${validB}`, createdAt: new Date('2026-01-11T11:31:00.000Z') }
    ])

    const usageA = await readProjectUsage({ projectId: ids.projectA, range: '24h', now })
    expect(usageA.period).toEqual({ range: '24h', from: from.toISOString(), to: now.toISOString() })
    expect(usageA.totals).toEqual({ validated: 2, pending: 1, failed: 1, successRate: 66.66, feeSpentDrops: '188' })
    expect(usageA.reserves).toEqual({ lockedDrops: '20', pendingDrops: '11' })
    expect(usageA.series).toHaveLength(25)
    expect(usageA.series.reduce((total, point) => total + point.validated, 0)).toBe(2)
    expect(usageA.series.reduce((total, point) => total + point.failed, 0)).toBe(1)
    expect(usageA.series.reduce((total, point) => total + BigInt(point.feeSpentDrops), 0n)).toBe(188n)

    const usageB = await readProjectUsage({ projectId: ids.projectB, range: '24h', now })
    expect(usageB.totals).toMatchObject({ validated: 1, pending: 0, failed: 0, feeSpentDrops: '55' })
    expect(usageB.reserves).toEqual({ lockedDrops: '5', pendingDrops: '4' })
    expect(usageB.policies).toHaveLength(0)
  })

  it('filters all aggregates by a project policy and returns a safe foreign-policy result', async () => {
    if (!database) return
    const validA = randomUUID()
    const failedA = randomUUID()
    await database.insert(sponsorshipIntents).values([
      makeIntent({ id: validA, projectId: ids.projectA, sponsorAccountId: ids.accountA, policyId: ids.policyA, state: 'validated', createdAt: new Date('2026-01-11T11:30:00.000Z'), updatedAt: new Date('2026-01-11T11:30:00.000Z') }),
      makeIntent({ id: failedA, projectId: ids.projectA, sponsorAccountId: ids.accountA, policyId: ids.policyB, state: 'failed', createdAt: new Date('2026-01-11T10:30:00.000Z'), updatedAt: new Date('2026-01-11T10:30:00.000Z') })
    ])
    await database.insert(fundingLedgerEntries).values([
      { sponsorAccountId: ids.accountA, treasuryId: ids.treasury, intentId: validA, type: 'capture', feeDrops: 7n, idempotencyKey: `capture-${validA}`, createdAt: new Date('2026-01-11T11:31:00.000Z') },
      { sponsorAccountId: ids.accountA, treasuryId: ids.treasury, intentId: failedA, type: 'capture', feeDrops: 3n, idempotencyKey: `capture-${failedA}`, createdAt: new Date('2026-01-11T10:31:00.000Z') }
    ])

    const usageA = await readProjectUsage({ projectId: ids.projectA, range: '24h', policyId: ids.policyA, now })
    expect(usageA.totals).toEqual({ validated: 1, pending: 0, failed: 0, successRate: 100, feeSpentDrops: '7' })
    expect(usageA.policies.map(policy => policy.id)).toEqual([ids.policyA, ids.policyB])

    const foreignPolicyUsage = await readProjectUsage({ projectId: ids.projectB, range: '24h', policyId: ids.policyA, now })
    expect(foreignPolicyUsage.totals).toEqual({ validated: 0, pending: 0, failed: 0, successRate: null, feeSpentDrops: '0' })
    expect(foreignPolicyUsage.policies).toEqual([])
  })

  it('returns a null success rate and zero-filled intersecting buckets with no outcomes', async () => {
    if (!database) return
    const usage = await readProjectUsage({ projectId: ids.projectA, range: '7d', now })
    expect(usage.totals).toEqual({ validated: 0, pending: 0, failed: 0, successRate: null, feeSpentDrops: '0' })
    expect(usage.period.from).toBe(new Date(now.getTime() - 7 * dayMilliseconds).toISOString())
    expect(usage.series).toHaveLength(8)
    expect(usage.series.every(point => point.validated === 0 && point.failed === 0 && point.feeSpentDrops === '0')).toBe(true)
  })
})
