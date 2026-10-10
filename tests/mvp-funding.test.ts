import { createHash, createHmac, randomUUID } from 'node:crypto'
import postgres from 'postgres'
import { drizzle } from 'drizzle-orm/postgres-js'
import { and, eq, inArray, sql } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { auditLogs, fundingBalances, fundingLedgerEntries, intentEvents, organizationMemberships, organizations, outboxEvents, platformControls, projectFundingBudgets, projectFundingQuotas, projectSponsorAccounts, projects, sponsorAccounts, sponsorTreasuries, sponsorshipGrants, sponsorshipIntents, sponsorshipPolicies, submissions, user } from '../server/database/schema'
import { canonicalHash } from '../server/domain/canonical-json'
import { FundingCapacityError, reserveFundingCapacity } from '../server/services/funding'
import { resumeSponsorshipIntentSigning } from '../server/services/intent-creation'

const routeMocks = vi.hoisted(() => ({
  authGetSession: vi.fn(),
  createSponsorSigner: vi.fn(),
  inspectReserveTargets: vi.fn(),
  loadSponsorProtocolDefinitions: vi.fn(),
  parseDefinitionsHashAllowlist: vi.fn(),
  requirePlatformAdmin: vi.fn(),
  requireSameOrigin: vi.fn(),
  useDatabase: vi.fn(),
  verifySponseeLedgerAuthorization: vi.fn(),
  xrplRpc: vi.fn()
}))

vi.mock('~~/lib/auth', () => ({ auth: { api: { getSession: routeMocks.authGetSession } } }))
vi.mock('~~/server/database/schema', async () => vi.importActual('../server/database/schema'))
vi.mock('~~/server/domain/canonical-json', async () => vi.importActual('../server/domain/canonical-json'))
vi.mock('~~/server/domain/policy', async () => vi.importActual('../server/domain/policy'))
vi.mock('~~/server/services/funding', async () => vi.importActual('../server/services/funding'))
vi.mock('~~/server/services/reserve-inspection', () => ({ inspectReserveTargets: routeMocks.inspectReserveTargets }))
vi.mock('~~/server/services/signer/factory', () => ({ createSponsorSigner: routeMocks.createSponsorSigner }))
vi.mock('~~/server/services/xrpl/authorization', () => ({ verifySponseeLedgerAuthorization: routeMocks.verifySponseeLedgerAuthorization }))
vi.mock('~~/server/services/xrpl/definitions', () => ({ loadSponsorProtocolDefinitions: routeMocks.loadSponsorProtocolDefinitions, parseDefinitionsHashAllowlist: routeMocks.parseDefinitionsHashAllowlist }))
vi.mock('~~/server/utils/admin', () => ({ requirePlatformAdmin: routeMocks.requirePlatformAdmin }))
vi.mock('~~/server/utils/database', () => ({ useDatabase: routeMocks.useDatabase }))
vi.mock('~~/server/utils/same-origin', () => ({ requireSameOrigin: routeMocks.requireSameOrigin }))
vi.mock('~~/server/utils/xrpl-rpc', () => ({ xrplRpc: routeMocks.xrplRpc }))

const databaseUrl = process.env.MVP_FUNDING_TEST_DATABASE_URL
const runDatabaseTests = Boolean(databaseUrl)
const client = databaseUrl ? postgres(databaseUrl, { max: 8, prepare: false }) : undefined
const database = client ? drizzle(client) : undefined

type TestEvent = {
  body?: unknown
  headers?: Record<string, string>
  params?: Record<string, string>
  status?: number
}

type RouteHandler = (event: TestEvent) => Promise<unknown>

function installRouteGlobals() {
  vi.stubGlobal('defineEventHandler', (handler: unknown) => handler)
  vi.stubGlobal('createError', (input: { statusCode: number, statusMessage: string, data?: unknown }) => Object.assign(new Error(input.statusMessage), input))
  vi.stubGlobal('getHeader', (event: TestEvent, name: string) => event.headers?.[name.toLowerCase()])
  vi.stubGlobal('getRouterParam', (event: TestEvent, name: string) => event.params?.[name])
  vi.stubGlobal('readBody', (event: TestEvent) => event.body)
  vi.stubGlobal('setResponseStatus', (event: TestEvent, status: number) => {
    event.status = status
  })
}

const testProtocol = {
  amendmentId: 'test-amendment',
  definitions: {},
  definitionsHash: 'definitions',
  flags: { sponsorFee: 1, sponsorReserve: 2 },
  networkId: 2,
  serverVersion: 'rippled-test',
  transactionTypes: ['Payment']
}

const testPolicyDocument = {
  allowedTransactionTypes: ['Payment'],
  allowedDestinations: [],
  allowedFields: [],
  maximumFeeDrops: '1000',
  maximumReserveDrops: '1000',
  maximumIntentsPerWalletPerDay: 1000,
  intentTtlSeconds: 300,
  requireWalletProof: true
}

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
    installRouteGlobals()
    routeMocks.useDatabase.mockReturnValue(database)
    routeMocks.requireSameOrigin.mockImplementation(() => undefined)
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
    const intentIds = [randomUUID(), randomUUID()]
    const policyIds = [randomUUID(), randomUUID()]
    const blobs = [`AA${intentIds[0].replaceAll('-', '')}`, `BB${intentIds[1].replaceAll('-', '')}`]
    const grants = blobs.map(blob => `grant_${blob}_${randomUUID()}`)
    const transactions = new Map<string, Record<string, unknown>>()
    const now = new Date(Date.now() + 60_000)
    const intentRows = [ids.projectA, ids.projectB].map((projectId, index) => {
      const accountAddress = `rWalletPhysical${index}`
      const transaction = { TransactionType: 'Payment', Account: accountAddress, Destination: 'rDestinationPhysical', Amount: '1', Fee: '60', Sequence: 1, LastLedgerSequence: 100 }
      transactions.set(blobs[index], transaction)
      return {
        id: intentIds[index],
        projectId,
        sponsorAccountId: index === 0 ? ids.accountA : ids.accountB,
        policyId: policyIds[index],
        accountAddress,
        network: 'devnet' as const,
        networkId: 2,
        definitionsHash: 'definitions',
        mode: 'fee',
        canonicalTransaction: transaction,
        canonicalHash: canonicalHash(transaction),
        preparedLedgerIndex: 1,
        requestHash: `request-${intentIds[index]}`,
        policySnapshot: testPolicyDocument,
        estimatedFeeDrops: 60n,
        estimatedReserveDrops: 0n,
        idempotencyKey: `authorize-${intentIds[index]}`,
        correlationId: `correlation-${intentIds[index]}`,
        state: 'awaiting_user_signature' as const,
        expiresAt: now
      }
    })
    routeMocks.xrplRpc.mockImplementation(async (_rpcUrl: string, method: string) => {
      if (method === 'server_info') return { info: { validated_ledger: { seq: 1 } } }
      if (method === 'server_state') return { state: { validated_ledger: { reserve_base: '0', reserve_inc: '0' } } }
      if (method === 'account_info') return { account_data: { Balance: '100', Sequence: 1, OwnerCount: 0 }, ledger_index: 1 }
      throw new Error(`Unexpected RPC method ${method}`)
    })
    routeMocks.createSponsorSigner.mockImplementation(async () => ({
      adapter: { decode: (blob: string) => transactions.get(blob) },
      protocol: { definitions: {} },
      signer: { signTransaction: async ({ intentId }: { intentId: string }) => ({ signedBlob: `sponsor-${intentId}`, txHash: `tx-${intentId}`, signingHash: `signing-${intentId}`, keyReference: 'test' }) }
    }))
    routeMocks.inspectReserveTargets.mockResolvedValue({ targets: [] })
    routeMocks.verifySponseeLedgerAuthorization.mockResolvedValue(undefined)
    const [previousControl] = await database.select().from(platformControls).where(eq(platformControls.key, 'sponsorship')).limit(1)
    try {
      await database.insert(platformControls).values({ key: 'sponsorship', paused: false, updatedBy: ids.onboardingUser }).onConflictDoUpdate({ target: platformControls.key, set: { paused: false, updatedBy: ids.onboardingUser } })
      await database.insert(sponsorshipPolicies).values(policyIds.map((id, index) => ({ id, projectId: index === 0 ? ids.projectA : ids.projectB, name: `Physical ${id}`, version: 1, status: 'active' as const, document: testPolicyDocument, documentHash: `policy-${id}` })))
      await database.insert(sponsorshipIntents).values(intentRows)
      await database.insert(sponsorshipGrants).values(intentRows.map((intent, index) => ({ projectId: intent.projectId, intentId: intent.id, tokenHash: createHash('sha256').update(grants[index]).digest('hex'), audience: 'xrpl-connect', accountAddress: intent.accountAddress, canonicalHash: intent.canonicalHash, expiresAt: now })))
      const authorize = (await import('../server/api/v1/intents/[intentId]/authorize.post')).default as RouteHandler
      const attempts = await Promise.allSettled(intentRows.map((intent, index) => authorize({ params: { intentId: intent.id }, body: { grant: grants[index], signedTransaction: blobs[index] } })))
      expect(attempts.filter(result => result.status === 'fulfilled')).toHaveLength(1)
      const rejected = attempts.find(result => result.status === 'rejected') as PromiseRejectedResult | undefined
      expect(rejected?.reason).toMatchObject({ statusCode: 409, statusMessage: 'Sponsor capacity is insufficient' })
      const [balance] = await database.select().from(fundingBalances).where(eq(fundingBalances.treasuryId, ids.treasury)).limit(1)
      expect(balance?.pendingFeeDrops).toBe(60n)
    } finally {
      await database.delete(intentEvents).where(inArray(intentEvents.intentId, intentIds))
      await database.delete(submissions).where(inArray(submissions.intentId, intentIds))
      await database.delete(fundingLedgerEntries).where(inArray(fundingLedgerEntries.intentId, intentIds))
      await database.delete(sponsorshipGrants).where(inArray(sponsorshipGrants.intentId, intentIds))
      await database.delete(outboxEvents).where(inArray(outboxEvents.aggregateId, intentIds))
      await database.delete(sponsorshipIntents).where(inArray(sponsorshipIntents.id, intentIds))
      await database.delete(sponsorshipPolicies).where(inArray(sponsorshipPolicies.id, policyIds))
      if (previousControl) {
        await database.update(platformControls).set({ paused: previousControl.paused, version: previousControl.version, reason: previousControl.reason, updatedBy: previousControl.updatedBy, updatedAt: previousControl.updatedAt }).where(eq(platformControls.key, 'sponsorship'))
      } else {
        await database.delete(platformControls).where(eq(platformControls.key, 'sponsorship'))
      }
      await database.update(fundingBalances).set({ pendingFeeDrops: 0n, pendingReserveDrops: 0n }).where(eq(fundingBalances.treasuryId, ids.treasury))
    }
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
    const originalRpcUrl = process.env.ACME_XRPL_RPC_URL
    const originalSponsorAddress = process.env.ACME_LOCAL_SPONSOR_ADDRESS
    const sponsorAddress = `rOnboard${ids.onboardingUser.replaceAll('-', '').slice(0, 25)}`
    process.env.ACME_XRPL_RPC_URL = 'http://test.invalid'
    process.env.ACME_LOCAL_SPONSOR_ADDRESS = sponsorAddress
    routeMocks.authGetSession.mockResolvedValue({ user: { id: ids.onboardingUser, email: `onboarding-${ids.onboardingUser}@example.invalid`, role: 'user' } })
    routeMocks.loadSponsorProtocolDefinitions.mockResolvedValue(testProtocol)
    routeMocks.parseDefinitionsHashAllowlist.mockReturnValue(undefined)
    routeMocks.xrplRpc.mockImplementation(async (_rpcUrl: string, method: string) => {
      if (method === 'account_info') return { account_data: { Balance: '1000000000' }, ledger_index: 1 }
      if (method === 'server_state') return { state: { validated_ledger: { base_fee: '10', reserve_base: '10000000', reserve_inc: '2000000', seq: 1 } } }
      throw new Error(`Unexpected RPC method ${method}`)
    })
    let organizationId: string | undefined
    try {
      const onboarding = (await import('../server/api/onboarding.post')).default as RouteHandler
      const results = await Promise.all([
        onboarding({ body: { organizationName: 'Onboarding A' }, headers: { origin: 'http://localhost:3000' } }),
        onboarding({ body: { organizationName: 'Onboarding B' }, headers: { origin: 'http://localhost:3000' } })
      ]) as Array<{ project: { id: string } }>
      expect(results[0].project.id).toBe(results[1].project.id)
      const [membership] = await database.select({ organizationId: organizationMemberships.organizationId }).from(organizationMemberships).where(eq(organizationMemberships.userId, ids.onboardingUser))
      expect(membership).toBeDefined()
      organizationId = membership?.organizationId
      const [projectBudget] = await database.select().from(projectFundingBudgets).where(eq(projectFundingBudgets.projectId, results[0].project.id)).limit(1)
      expect(projectBudget?.feeBudgetDrops).toBe(1_000_000n)
      expect(projectBudget?.reserveBudgetDrops).toBe(100_000_000n)
    } finally {
      if (!organizationId) {
        const [membership] = await database.select({ organizationId: organizationMemberships.organizationId }).from(organizationMemberships).where(eq(organizationMemberships.userId, ids.onboardingUser)).limit(1)
        organizationId = membership?.organizationId
      }
      if (organizationId) {
        const onboardingProjects = await database.select({ id: projects.id }).from(projects).where(eq(projects.organizationId, organizationId))
        const onboardingSponsorAccounts = onboardingProjects.length
          ? await database.select({ id: sponsorAccounts.id }).from(sponsorAccounts).where(inArray(sponsorAccounts.projectId, onboardingProjects.map(project => project.id)))
          : []
        if (onboardingSponsorAccounts.length) {
          const sponsorAccountIds = onboardingSponsorAccounts.map(sponsor => sponsor.id)
          await database.delete(fundingBalances).where(inArray(fundingBalances.sponsorAccountId, sponsorAccountIds))
          await database.delete(projectSponsorAccounts).where(inArray(projectSponsorAccounts.sponsorAccountId, sponsorAccountIds))
          await database.delete(sponsorAccounts).where(inArray(sponsorAccounts.id, sponsorAccountIds))
        }
        await database.delete(organizations).where(eq(organizations.id, organizationId))
        await database.delete(sponsorTreasuries).where(and(eq(sponsorTreasuries.network, 'devnet'), eq(sponsorTreasuries.address, sponsorAddress)))
      }
      if (originalRpcUrl === undefined) delete process.env.ACME_XRPL_RPC_URL
      else process.env.ACME_XRPL_RPC_URL = originalRpcUrl
      if (originalSponsorAddress === undefined) delete process.env.ACME_LOCAL_SPONSOR_ADDRESS
      else process.env.ACME_LOCAL_SPONSOR_ADDRESS = originalSponsorAddress
    }
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
    routeMocks.requirePlatformAdmin.mockResolvedValue({ user: { email: 'admin@example.invalid', role: 'admin' } })
    try {
      const recover = (await import('../server/api/admin/outbox/dead-letters/[eventId]/recover.post')).default as RouteHandler
      const recovered = await recover({ params: { eventId }, body: { expectedLockVersion: 7, reason }, headers: { 'origin': 'http://localhost:3000', 'x-request-id': `request-${eventId}` } }) as typeof outboxEvents.$inferSelect
      const [afterEvent] = await database.select().from(outboxEvents).where(eq(outboxEvents.id, eventId)).limit(1)
      const [afterBalance] = await database.select().from(fundingBalances).where(eq(fundingBalances.treasuryId, ids.treasury)).limit(1)
      const afterLedger = await database.select().from(fundingLedgerEntries).where(eq(fundingLedgerEntries.idempotencyKey, idempotencyKey))
      expect(recovered.id).toBe(eventId)
      expect(afterEvent?.payload).toEqual(payload)
      expect(afterEvent?.deadLetteredAt).toBeNull()
      expect(afterEvent?.lockVersion).toBe(8)
      expect(afterEvent?.attempts).toBe(12)
      expect(afterEvent?.lastError).toBe(`Manually requeued: ${reason}`)
      expect(afterBalance?.pendingFeeDrops).toBe(beforeBalance?.pendingFeeDrops)
      expect(afterBalance?.capturedFeeDrops).toBe(beforeBalance?.capturedFeeDrops)
      expect(afterLedger).toEqual(beforeLedger)
      const [audit] = await database.select().from(auditLogs).where(and(eq(auditLogs.resourceId, eventId), eq(auditLogs.action, 'outbox.dead_letter.recovered'))).limit(1)
      expect(audit?.actor).toBe('admin@example.invalid')
    } finally {
      await database.delete(auditLogs).where(eq(auditLogs.resourceId, eventId))
      await database.delete(outboxEvents).where(eq(outboxEvents.id, eventId))
      await database.delete(fundingLedgerEntries).where(eq(fundingLedgerEntries.idempotencyKey, idempotencyKey))
      await database.update(fundingBalances).set({ pendingFeeDrops: 0n }).where(eq(fundingBalances.treasuryId, ids.treasury))
    }
  })
})
