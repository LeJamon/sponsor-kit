import { createHash, createHmac, randomUUID } from 'node:crypto'
import postgres from 'postgres'
import { drizzle } from 'drizzle-orm/postgres-js'
import { and, eq, sql } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { auditLogs, fundingBalances, fundingLedgerEntries, organizationMemberships, organizations, outboxEvents, projectFundingBudgets, projectFundingQuotas, projectSponsorAccounts, projects, sponsorAccounts, sponsorTreasuries, sponsorshipGrants, sponsorshipIntents, sponsorshipPolicies, user } from '../server/database/schema'
import { FundingCapacityError, reserveFundingCapacity } from '../server/services/funding'
import { resumeSponsorshipIntentSigning } from '../server/services/intent-creation'

const databaseUrl = process.env.MVP_FUNDING_TEST_DATABASE_URL
const runDatabaseTests = Boolean(databaseUrl)
const client = databaseUrl ? postgres(databaseUrl, { max: 8, prepare: false }) : undefined
const database = client ? drizzle(client) : undefined

describe.skipIf(!runDatabaseTests)('MVP funding capacity integration', () => {
  const ids = {
    organization: randomUUID(),
    projectA: randomUUID(),
    projectB: randomUUID(),
    treasury: randomUUID(),
    accountA: randomUUID(),
    accountB: randomUUID(),
    onboardingUser: randomUUID()
  }

  beforeAll(async () => {
    if (!database) return
    await database.insert(user).values({ id: ids.onboardingUser, name: 'Onboarding test', email: `onboarding-${ids.onboardingUser}@example.invalid` })
    await database.insert(organizations).values({ id: ids.organization, name: 'Funding test', slug: `funding-${ids.organization}` })
    await database.insert(projects).values([
      { id: ids.projectA, organizationId: ids.organization, name: 'Project A', publicId: `funding-a-${ids.projectA}`, network: 'devnet', rpcUrl: 'http://test.invalid' },
      { id: ids.projectB, organizationId: ids.organization, name: 'Project B', publicId: `funding-b-${ids.projectB}`, network: 'devnet', rpcUrl: 'http://test.invalid' }
    ])
    await database.insert(sponsorTreasuries).values({ id: ids.treasury, network: 'devnet', address: `rFunding${ids.treasury.replaceAll('-', '').slice(0, 25)}`, signerKeyReference: 'test', capabilities: { fee: true, reserve: true }, observedBalanceDrops: 1_000_000_000n })
    await database.insert(sponsorAccounts).values([
      { id: ids.accountA, projectId: ids.projectA, treasuryId: ids.treasury, network: 'devnet', address: 'rFundingA', signerKeyReference: 'test', capabilities: { fee: true, reserve: true } },
      { id: ids.accountB, projectId: ids.projectB, treasuryId: ids.treasury, network: 'devnet', address: 'rFundingB', signerKeyReference: 'test', capabilities: { fee: true, reserve: true } }
    ])
    await database.insert(projectSponsorAccounts).values([
      { projectId: ids.projectA, sponsorAccountId: ids.accountA, network: 'devnet' },
      { projectId: ids.projectB, sponsorAccountId: ids.accountB, network: 'devnet' }
    ])
    await database.insert(fundingBalances).values({ sponsorAccountId: ids.accountA, treasuryId: ids.treasury })
    await database.insert(projectFundingBudgets).values([
      { projectId: ids.projectA, feeBudgetDrops: 100n, reserveBudgetDrops: 100n, walletFeeQuotaDrops: 60n, walletReserveQuotaDrops: 100n },
      { projectId: ids.projectB, feeBudgetDrops: 100n, reserveBudgetDrops: 100n, walletFeeQuotaDrops: 100n, walletReserveQuotaDrops: 100n }
    ])
  })

  beforeEach(async () => {
    if (!database) return
    await database.delete(projectFundingQuotas).where(sql`project_id in (${ids.projectA}, ${ids.projectB})`)
    await database.update(projectFundingBudgets).set({ feeReservedDrops: 0n, feeSpentDrops: 0n, reserveReservedDrops: 0n, reserveExposureDrops: 0n, version: 0 }).where(sql`project_id in (${ids.projectA}, ${ids.projectB})`)
    await database.update(fundingBalances).set({ pendingFeeDrops: 0n, capturedFeeDrops: 0n, pendingReserveDrops: 0n, lockedReserveDrops: 0n, version: 0 }).where(eq(fundingBalances.treasuryId, ids.treasury))
  })

  afterAll(async () => {
    if (!database || !client) return
    await database.delete(projectSponsorAccounts).where(sql`project_id in (${ids.projectA}, ${ids.projectB})`)
    await database.delete(projectFundingQuotas).where(sql`project_id in (${ids.projectA}, ${ids.projectB})`)
    await database.delete(projectFundingBudgets).where(sql`project_id in (${ids.projectA}, ${ids.projectB})`)
    await database.delete(fundingBalances).where(sql`treasury_id = ${ids.treasury}`)
    await database.delete(sponsorAccounts).where(sql`id in (${ids.accountA}, ${ids.accountB})`)
    await database.delete(sponsorTreasuries).where(sql`id = ${ids.treasury}`)
    await database.delete(projects).where(sql`id in (${ids.projectA}, ${ids.projectB})`)
    await database.delete(organizations).where(sql`id = ${ids.organization}`)
    await database.delete(user).where(eq(user.id, ids.onboardingUser))
    await client.end()
  })

  it('serializes same-project quota races while isolating project budgets', async () => {
    if (!database) return
    const now = new Date('2026-01-01T00:00:00.000Z')
    const attempts = await Promise.allSettled([1, 2].map(() => database.transaction(tx => reserveFundingCapacity(tx, {
      sponsorAccountId: ids.accountA,
      treasuryId: ids.treasury,
      projectId: ids.projectA,
      accountAddress: 'rWalletA',
      feeDrops: 60n,
      reserveDrops: 0n,
      now
    }))))
    expect(attempts.filter(result => result.status === 'fulfilled')).toHaveLength(1)
    expect(attempts.filter(result => result.status === 'rejected' && result.reason instanceof FundingCapacityError)).toHaveLength(1)

    await expect(database.transaction(tx => reserveFundingCapacity(tx, {
      sponsorAccountId: ids.accountB,
      treasuryId: ids.treasury,
      projectId: ids.projectB,
      accountAddress: 'rWalletB',
      feeDrops: 60n,
      reserveDrops: 0n,
      now
    }))).resolves.toBeDefined()
  })

  it('serializes physical treasury exhaustion across projects', async () => {
    if (!database) return
    const physicalCapacityDrops = 100n
    const reserveWithPhysicalCapacity = (projectId: string, sponsorAccountId: string, accountAddress: string) => database.transaction(async (tx) => {
      const [balance] = await tx.select().from(fundingBalances).where(eq(fundingBalances.treasuryId, ids.treasury)).for('update').limit(1)
      if (!balance) throw new Error('Missing shared funding balance')
      const pending = balance.pendingFeeDrops + balance.pendingReserveDrops
      if (pending + 60n > physicalCapacityDrops) throw new Error('PHYSICAL_TREASURY_EXHAUSTED')
      return reserveFundingCapacity(tx, { sponsorAccountId, treasuryId: ids.treasury, projectId, accountAddress, feeDrops: 60n, reserveDrops: 0n, now: new Date('2026-01-01T00:00:00.000Z') })
    })
    const attempts = await Promise.allSettled([
      reserveWithPhysicalCapacity(ids.projectA, ids.accountA, 'rWalletPhysicalA'),
      reserveWithPhysicalCapacity(ids.projectB, ids.accountB, 'rWalletPhysicalB')
    ])
    expect(attempts.filter(result => result.status === 'fulfilled')).toHaveLength(1)
    expect(attempts.filter(result => result.status === 'rejected' && result.reason instanceof Error && result.reason.message === 'PHYSICAL_TREASURY_EXHAUSTED')).toHaveLength(1)
    const [balance] = await database.select().from(fundingBalances).where(eq(fundingBalances.treasuryId, ids.treasury)).limit(1)
    expect(balance?.pendingFeeDrops).toBe(60n)
  })

  it('rejects a funding operation that crosses the project sponsor binding', async () => {
    if (!database) return
    await expect(database.transaction(tx => reserveFundingCapacity(tx, {
      sponsorAccountId: ids.accountA,
      treasuryId: ids.treasury,
      projectId: ids.projectB,
      accountAddress: 'rWalletCrossTenant',
      feeDrops: 1n,
      reserveDrops: 0n,
      now: new Date('2026-01-01T00:00:00.000Z')
    }))).rejects.toThrow('Sponsor treasury is not bound to project')
    const [budget] = await database.select().from(projectFundingBudgets).where(eq(projectFundingBudgets.projectId, ids.projectB)).limit(1)
    expect(budget?.feeReservedDrops).toBe(0n)
    expect(budget?.feeSpentDrops).toBe(0n)
  })

  it('serializes first-project onboarding retries with a per-user advisory lock', async () => {
    if (!database) return
    const onboarding = async (organizationName: string) => database.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`onboarding:${ids.onboardingUser}`}))`)
      const [existing] = await tx.select({ organization: organizations, project: projects }).from(organizationMemberships)
        .innerJoin(organizations, eq(organizations.id, organizationMemberships.organizationId))
        .innerJoin(projects, eq(projects.organizationId, organizations.id))
        .where(eq(organizationMemberships.userId, ids.onboardingUser)).limit(1)
      if (existing) return existing
      const organizationId = randomUUID()
      const [organization] = await tx.insert(organizations).values({ id: organizationId, name: organizationName, slug: `onboarding-${organizationId}` }).returning()
      if (!organization) throw new Error('Organization creation failed')
      await tx.insert(organizationMemberships).values({ organizationId, userId: ids.onboardingUser, role: 'owner' })
      const [project] = await tx.insert(projects).values({ organizationId, name: 'My first project', publicId: `onboarding-${organizationId}`, network: 'devnet', rpcUrl: 'http://test.invalid' }).returning()
      if (!project) throw new Error('Project creation failed')
      return { organization, project }
    })
    const results = await Promise.all([onboarding('Onboarding A'), onboarding('Onboarding B')])
    expect(results[0].project.id).toBe(results[1].project.id)
    const rows = await database.select({ organizationId: organizationMemberships.organizationId }).from(organizationMemberships).where(eq(organizationMemberships.userId, ids.onboardingUser))
    expect(rows).toHaveLength(1)
    await database.delete(organizations).where(eq(organizations.id, rows[0].organizationId))
  })

  it('reconstructs an exact unconsumed grant and rejects altered grant data', async () => {
    if (!database) return
    const originalSecret = process.env.ACME_GRANT_SECRET
    const secret = 'mvp-funding-grant-secret-01234567890123456789'
    process.env.ACME_GRANT_SECRET = secret
    const policyId = randomUUID()
    const intentId = randomUUID()
    const idempotencyKey = `resume-${intentId}`
    const requestHash = 'request-hash-for-resume'
    const canonicalHash = 'canonical-hash-for-resume'
    const expiresAt = new Date(Date.now() + 60_000)
    const token = `grant_${createHmac('sha256', secret).update(`acme.sponsorship-grant.v1:${intentId}:${idempotencyKey}:${requestHash}`).digest('base64url')}`
    const tokenHash = createHash('sha256').update(token).digest('hex')
    try {
      await database.insert(sponsorshipPolicies).values({ id: policyId, projectId: ids.projectA, name: `Resume ${intentId}`, version: 1, status: 'active', document: { allowedTransactionTypes: ['Payment'] }, documentHash: `policy-${intentId}` })
      await database.insert(sponsorshipIntents).values({ id: intentId, projectId: ids.projectA, sponsorAccountId: ids.accountA, policyId, accountAddress: 'rWalletResume', network: 'devnet', networkId: 2, definitionsHash: 'definitions', mode: 'fee', canonicalTransaction: { TransactionType: 'Payment', Account: 'rWalletResume' }, canonicalHash, preparedLedgerIndex: 1, requestHash, policySnapshot: { allowedTransactionTypes: ['Payment'] }, estimatedFeeDrops: 10n, estimatedReserveDrops: 0n, idempotencyKey, correlationId: `correlation-${intentId}`, state: 'awaiting_user_signature', expiresAt })
      await database.insert(sponsorshipGrants).values({ projectId: ids.projectA, intentId, tokenHash, audience: 'xrpl-connect', accountAddress: 'rWalletResume', canonicalHash, expiresAt })
      const first = await resumeSponsorshipIntentSigning(ids.projectA, intentId)
      const second = await resumeSponsorshipIntentSigning(ids.projectA, intentId)
      expect(second.grant).toBe(first.grant)
      expect(second.canonicalHash).toBe(canonicalHash)
      await database.update(sponsorshipGrants).set({ tokenHash: createHash('sha256').update('altered').digest('hex') }).where(eq(sponsorshipGrants.intentId, intentId))
      ;(globalThis as Record<string, unknown>).createError = (input: { statusCode: number, statusMessage: string }) => Object.assign(new Error(input.statusMessage), input)
      await expect(resumeSponsorshipIntentSigning(ids.projectA, intentId)).rejects.toThrow('no longer available')
    } finally {
      await database.delete(sponsorshipIntents).where(eq(sponsorshipIntents.id, intentId))
      await database.delete(sponsorshipPolicies).where(eq(sponsorshipPolicies.id, policyId))
      if (originalSecret === undefined) delete process.env.ACME_GRANT_SECRET
      else process.env.ACME_GRANT_SECRET = originalSecret
    }
  })

  it('requeues a dead letter without changing signed payload or funding release state', async () => {
    if (!database) return
    const eventId = randomUUID()
    const idempotencyKey = `dead-letter-${eventId}`
    const signedBlob = 'SIGNED_BLOB_RETAINED'
    const payload = { intentId: randomUUID(), transactionHash: 'TX_RETAINED', signedBlob }
    await database.insert(outboxEvents).values({ id: eventId, aggregateType: 'sponsorship_intent', aggregateId: payload.intentId, eventType: 'xrpl.submit', payload, attempts: 12, lockVersion: 7, lastError: 'ambiguous', deadLetteredAt: new Date(), availableAt: new Date(Date.now() - 1_000) })
    await database.insert(fundingLedgerEntries).values({ sponsorAccountId: ids.accountA, treasuryId: ids.treasury, type: 'reservation', feeDrops: 10n, idempotencyKey })
    await database.update(fundingBalances).set({ pendingFeeDrops: 10n }).where(eq(fundingBalances.treasuryId, ids.treasury))
    const [beforeBalance] = await database.select().from(fundingBalances).where(eq(fundingBalances.treasuryId, ids.treasury)).limit(1)
    const beforeLedger = await database.select().from(fundingLedgerEntries).where(eq(fundingLedgerEntries.idempotencyKey, idempotencyKey))
    const reason = 'operator verified persisted signed payload'
    try {
      await database.transaction(async (tx) => {
        const [current] = await tx.select().from(outboxEvents).where(eq(outboxEvents.id, eventId)).for('update').limit(1)
        if (!current?.deadLetteredAt || current.processedAt) throw new Error('Outbox event is not currently dead-lettered')
        const [recovered] = await tx.update(outboxEvents).set({ deadLetteredAt: null, availableAt: new Date(), lockedAt: null, lockedBy: null, lockVersion: current.lockVersion + 1, lastError: `Manually requeued: ${reason}` }).where(and(eq(outboxEvents.id, eventId), sql`processed_at is null`, eq(outboxEvents.lockVersion, current.lockVersion))).returning()
        if (!recovered) throw new Error('Dead-letter event changed')
        await tx.insert(auditLogs).values({ actor: 'test-admin', action: 'outbox.dead_letter.recovered', resourceType: 'outbox_event', resourceId: eventId, result: 'success', requestId: `request-${eventId}`, metadata: { reason } })
      })
      const [afterEvent] = await database.select().from(outboxEvents).where(eq(outboxEvents.id, eventId)).limit(1)
      const [afterBalance] = await database.select().from(fundingBalances).where(eq(fundingBalances.treasuryId, ids.treasury)).limit(1)
      const afterLedger = await database.select().from(fundingLedgerEntries).where(eq(fundingLedgerEntries.idempotencyKey, idempotencyKey))
      expect(afterEvent?.payload).toEqual(payload)
      expect(afterEvent?.deadLetteredAt).toBeNull()
      expect(afterEvent?.lockVersion).toBe(8)
      expect(afterEvent?.attempts).toBe(12)
      expect(afterBalance?.pendingFeeDrops).toBe(beforeBalance?.pendingFeeDrops)
      expect(afterBalance?.capturedFeeDrops).toBe(beforeBalance?.capturedFeeDrops)
      expect(afterLedger).toEqual(beforeLedger)
    } finally {
      await database.delete(auditLogs).where(eq(auditLogs.resourceId, eventId))
      await database.delete(outboxEvents).where(eq(outboxEvents.id, eventId))
      await database.delete(fundingLedgerEntries).where(eq(fundingLedgerEntries.idempotencyKey, idempotencyKey))
      await database.update(fundingBalances).set({ pendingFeeDrops: 0n }).where(eq(fundingBalances.treasuryId, ids.treasury))
    }
  })
})
