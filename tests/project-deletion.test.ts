import { createHash, randomUUID } from 'node:crypto'
import postgres from 'postgres'
import { drizzle } from 'drizzle-orm/postgres-js'
import { and, eq, inArray } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  apiKeys,
  auditLogs,
  fundingBalances,
  fundingLedgerEntries,
  organizationMemberships,
  organizations,
  projectFundingBudgets,
  projectSponsorAccounts,
  projects,
  reserveObligations,
  sponsorAccounts,
  sponsorTreasuries,
  sponsorshipIntents,
  sponsorshipPolicies,
  user
} from '../server/database/schema'

const routeMocks = vi.hoisted(() => ({
  authGetSession: vi.fn(),
  loadProjectProvisioningContext: vi.fn(),
  projectPublicIdForRequest: vi.fn(),
  provisionProject: vi.fn(),
  requireSameOrigin: vi.fn(),
  useDatabase: vi.fn()
}))

vi.mock('~~/lib/auth', () => ({ auth: { api: { getSession: routeMocks.authGetSession } } }))
vi.mock('~~/lib/roles', async () => vi.importActual('../lib/roles'))
vi.mock('~~/server/database/schema', async () => vi.importActual('../server/database/schema'))
vi.mock('~~/server/services/project-provisioning', () => ({
  loadProjectProvisioningContext: routeMocks.loadProjectProvisioningContext,
  projectPublicIdForRequest: routeMocks.projectPublicIdForRequest,
  provisionProject: routeMocks.provisionProject
}))
vi.mock('../server/services/project-provisioning', () => ({
  loadProjectProvisioningContext: routeMocks.loadProjectProvisioningContext,
  projectPublicIdForRequest: routeMocks.projectPublicIdForRequest,
  provisionProject: routeMocks.provisionProject
}))
vi.mock('~~/server/utils/database', () => ({ useDatabase: routeMocks.useDatabase }))
vi.mock('../server/utils/database', () => ({ useDatabase: routeMocks.useDatabase }))
vi.mock('~~/server/utils/project-member', async () => vi.importActual('../server/utils/project-member'))
vi.mock('../server/utils/project-member', async () => vi.importActual('../server/utils/project-member'))
vi.mock('~~/server/utils/same-origin', () => ({ requireSameOrigin: routeMocks.requireSameOrigin }))
vi.mock('../server/utils/same-origin', () => ({ requireSameOrigin: routeMocks.requireSameOrigin }))

const databaseUrl = process.env.MVP_FUNDING_TEST_DATABASE_URL
const client = databaseUrl ? postgres(databaseUrl, { max: 8, prepare: false }) : undefined
const database = client ? drizzle(client) : undefined

type TestEvent = {
  body?: unknown
  headers?: Record<string, string>
  params?: Record<string, string>
  status?: number
}
type RouteHandler = (event: TestEvent) => Promise<unknown>

type Workspace = {
  organizationId: string
  projectId: string
  publicId: string
  projectName: string
  ownerId: string
  adminId: string
  developerId: string
  sponsorAccountId?: string
  treasuryId?: string
  apiKeySecret?: string
}

describe.skipIf(!database)('console project deletion', () => {
  const ownerId = randomUUID()
  const adminId = randomUUID()
  const developerId = randomUUID()
  const foreignOwnerId = randomUUID()
  const workspaces: Workspace[] = []
  const extraUserIds: string[] = []
  let deleteProject: RouteHandler
  let createProject: RouteHandler
  let onboarding: RouteHandler
  let contextRoute: RouteHandler

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

  function event(projectPublicId: string, body: unknown): TestEvent {
    return { body, params: { projectId: projectPublicId }, headers: { origin: 'http://localhost:3000' } }
  }

  function setSession(userId: string) {
    routeMocks.authGetSession.mockResolvedValue({ user: { id: userId, name: 'Lifecycle test user', email: `${userId}@example.invalid`, role: 'user' } })
  }

  async function createWorkspace(options: { projectName?: string, withSponsor?: boolean, status?: 'active' | 'archived' } = {}): Promise<Workspace> {
    if (!database) throw new Error('Test database is unavailable')
    const ids: Workspace = {
      organizationId: randomUUID(),
      projectId: randomUUID(),
      publicId: `proj_delete_${randomUUID().replaceAll('-', '')}`,
      projectName: options.projectName || 'Delete me',
      ownerId,
      adminId,
      developerId
    }
    await database.insert(organizations).values({ id: ids.organizationId, name: `Deletion ${ids.organizationId}`, slug: `deletion-${ids.organizationId}` })
    await database.insert(organizationMemberships).values([
      { organizationId: ids.organizationId, userId: ownerId, role: 'owner' },
      { organizationId: ids.organizationId, userId: adminId, role: 'admin' },
      { organizationId: ids.organizationId, userId: developerId, role: 'developer' }
    ])
    await database.insert(projects).values({ id: ids.projectId, organizationId: ids.organizationId, name: ids.projectName, publicId: ids.publicId, network: 'devnet', rpcUrl: 'http://test.invalid', status: options.status || 'active' })
    if (options.withSponsor) {
      ids.treasuryId = randomUUID()
      ids.sponsorAccountId = randomUUID()
      await database.insert(sponsorTreasuries).values({ id: ids.treasuryId, network: 'devnet', address: `rDelete${ids.treasuryId.replaceAll('-', '').slice(0, 25)}`, signerKeyReference: 'test', capabilities: { fee: true, reserve: true } })
      await database.insert(sponsorAccounts).values({ id: ids.sponsorAccountId, projectId: ids.projectId, treasuryId: ids.treasuryId, network: 'devnet', address: `rDelete${ids.treasuryId.replaceAll('-', '').slice(0, 25)}`, signerKeyReference: 'test', capabilities: { fee: true, reserve: true } })
      await database.insert(projectSponsorAccounts).values({ projectId: ids.projectId, sponsorAccountId: ids.sponsorAccountId, network: 'devnet' })
      await database.insert(fundingBalances).values({ sponsorAccountId: ids.sponsorAccountId, treasuryId: ids.treasuryId })
      await database.insert(projectFundingBudgets).values({ projectId: ids.projectId })
      await database.insert(sponsorshipPolicies).values({ projectId: ids.projectId, name: 'Deletion policy', version: 1, status: 'active', document: {}, documentHash: `policy-${ids.projectId}` })
      const secret = `acme_dev_sk_${randomUUID()}${randomUUID()}`
      ids.apiKeySecret = secret
      await database.insert(apiKeys).values({ projectId: ids.projectId, name: 'Deletion key', prefix: secret.slice(0, 18), secretHash: createHash('sha256').update(secret).digest('hex'), scopes: ['intents:create'] })
    }
    workspaces.push(ids)
    return ids
  }

  async function cleanupWorkspace(ids: Workspace) {
    if (!database) return
    await database.delete(auditLogs).where(eq(auditLogs.projectId, ids.projectId))
    await database.delete(reserveObligations).where(ids.sponsorAccountId ? eq(reserveObligations.sponsorAccountId, ids.sponsorAccountId) : eq(reserveObligations.id, randomUUID()))
    await database.delete(sponsorshipIntents).where(eq(sponsorshipIntents.projectId, ids.projectId))
    await database.delete(sponsorshipPolicies).where(eq(sponsorshipPolicies.projectId, ids.projectId))
    await database.delete(projectFundingBudgets).where(eq(projectFundingBudgets.projectId, ids.projectId))
    await database.delete(apiKeys).where(eq(apiKeys.projectId, ids.projectId))
    await database.delete(projectSponsorAccounts).where(eq(projectSponsorAccounts.projectId, ids.projectId))
    if (ids.sponsorAccountId) {
      await database.delete(fundingLedgerEntries).where(eq(fundingLedgerEntries.sponsorAccountId, ids.sponsorAccountId))
      await database.delete(fundingBalances).where(eq(fundingBalances.sponsorAccountId, ids.sponsorAccountId))
      await database.delete(sponsorAccounts).where(eq(sponsorAccounts.id, ids.sponsorAccountId))
    }
    await database.delete(projects).where(eq(projects.id, ids.projectId))
    await database.delete(organizationMemberships).where(eq(organizationMemberships.organizationId, ids.organizationId))
    await database.delete(organizations).where(eq(organizations.id, ids.organizationId))
    if (ids.treasuryId) {
      const remainingAccounts = await database.select({ id: sponsorAccounts.id }).from(sponsorAccounts).where(eq(sponsorAccounts.treasuryId, ids.treasuryId))
      const remainingBalances = await database.select({ id: fundingBalances.sponsorAccountId }).from(fundingBalances).where(eq(fundingBalances.treasuryId, ids.treasuryId))
      if (!remainingAccounts.length && !remainingBalances.length) await database.delete(sponsorTreasuries).where(eq(sponsorTreasuries.id, ids.treasuryId))
    }
  }

  async function expectStatus(request: Promise<unknown>, statusCode: number) {
    try {
      await request
      throw new Error(`Expected status ${statusCode}`)
    } catch (error) {
      expect(error).toMatchObject({ statusCode })
      return error as { data?: unknown }
    }
  }

  beforeAll(async () => {
    if (!database) return
    installRouteGlobals()
    routeMocks.useDatabase.mockReturnValue(database)
    routeMocks.requireSameOrigin.mockImplementation(() => undefined)
    routeMocks.provisionProject.mockResolvedValue({})
    routeMocks.loadProjectProvisioningContext.mockResolvedValue({ rpcUrl: 'http://test.invalid' })
    routeMocks.projectPublicIdForRequest.mockImplementation((input: { userId: string, organizationId: string, requestId: string }) => `proj_${createHash('sha256').update(`${input.userId}\0${input.organizationId}\0${input.requestId}`).digest('hex')}`)
    await database.insert(user).values([
      { id: ownerId, name: 'Deletion owner', email: `${ownerId}@example.invalid` },
      { id: adminId, name: 'Deletion admin', email: `${adminId}@example.invalid` },
      { id: developerId, name: 'Deletion developer', email: `${developerId}@example.invalid` },
      { id: foreignOwnerId, name: 'Foreign owner', email: `${foreignOwnerId}@example.invalid` }
    ])
    deleteProject = (await import('../server/api/console/projects/[projectId].delete')).default as RouteHandler
    createProject = (await import('../server/api/console/projects/index.post')).default as RouteHandler
    onboarding = (await import('../server/api/onboarding.post')).default as RouteHandler
    contextRoute = (await import('../server/api/console/context.get')).default as RouteHandler
  })

  beforeEach(() => {
    setSession(ownerId)
    routeMocks.requireSameOrigin.mockClear()
    routeMocks.provisionProject.mockClear()
    routeMocks.loadProjectProvisioningContext.mockClear()
  })

  afterAll(async () => {
    if (!database || !client) return
    for (const ids of [...workspaces].reverse()) await cleanupWorkspace(ids)
    await database.delete(user).where(inArray(user.id, [ownerId, adminId, developerId, foreignOwnerId]))
    if (extraUserIds.length) await database.delete(user).where(inArray(user.id, extraUserIds))
    await client.end()
    vi.unstubAllGlobals()
  })

  it('requires an owner/admin and exact name confirmation', async () => {
    if (!database) return
    const ids = await createWorkspace()
    setSession(developerId)
    await expectStatus(deleteProject(event(ids.publicId, { confirmationName: ids.projectName })), 403)
    setSession(foreignOwnerId)
    await expectStatus(deleteProject(event(ids.publicId, { confirmationName: ids.projectName })), 404)
    setSession(ownerId)
    await expectStatus(deleteProject(event(ids.publicId, { confirmationName: 'Wrong name' })), 400)
    const [project] = await database.select().from(projects).where(eq(projects.id, ids.projectId))
    expect(project?.status).toBe('active')
  })

  it('archives the project, revokes keys, hides it, and is safe to repeat', async () => {
    if (!database) return
    const ids = await createWorkspace({ withSponsor: true })
    const ledgerKey = `delete-history-${ids.projectId}`
    await database.insert(fundingLedgerEntries).values({ sponsorAccountId: ids.sponsorAccountId!, treasuryId: ids.treasuryId!, type: 'credit', feeDrops: 25n, idempotencyKey: ledgerKey })
    const response = await deleteProject(event(ids.publicId, { confirmationName: ids.projectName })) as { deleted: boolean, publicId: string }
    expect(response).toEqual({ deleted: true, publicId: ids.publicId })
    const [project] = await database.select().from(projects).where(eq(projects.id, ids.projectId))
    const [key] = await database.select().from(apiKeys).where(eq(apiKeys.projectId, ids.projectId))
    const [policy] = await database.select().from(sponsorshipPolicies).where(eq(sponsorshipPolicies.projectId, ids.projectId))
    const [sponsor] = await database.select().from(sponsorAccounts).where(eq(sponsorAccounts.id, ids.sponsorAccountId!))
    const [treasury] = await database.select().from(sponsorTreasuries).where(eq(sponsorTreasuries.id, ids.treasuryId!))
    const history = await database.select().from(fundingLedgerEntries).where(eq(fundingLedgerEntries.idempotencyKey, ledgerKey))
    expect(project?.status).toBe('archived')
    expect(key?.revokedAt).toBeInstanceOf(Date)
    expect(policy?.status).toBe('archived')
    expect(sponsor?.status).toBe('archived')
    expect(treasury?.status).toBe('active')
    expect(history).toHaveLength(1)
    expect(await database.select().from(auditLogs).where(and(eq(auditLogs.projectId, ids.projectId), eq(auditLogs.action, 'project.deleted')))).toHaveLength(1)

    const visible = await contextRoute({ headers: {} }) as { organizations: Array<{ organization: { id: string }, role: string }>, projects: Array<unknown> }
    expect(visible.organizations.some(row => row.organization.id === ids.organizationId)).toBe(true)
    expect(visible.projects.some((row: { project: { id: string } }) => row.project.id === ids.projectId)).toBe(false)
    expect(await deleteProject(event(ids.publicId, { confirmationName: ids.projectName }))).toEqual({ deleted: true, publicId: ids.publicId })
  })

  it('rejects pending intents and active reserve exposure before archival', async () => {
    if (!database) return
    const ids = await createWorkspace({ withSponsor: true, projectName: 'Blocked project' })
    const intentId = randomUUID()
    await database.insert(sponsorshipIntents).values({
      id: intentId,
      projectId: ids.projectId,
      sponsorAccountId: ids.sponsorAccountId,
      accountAddress: 'rBlockedAccount',
      network: 'devnet',
      networkId: 2,
      definitionsHash: 'definitions',
      mode: 'reserve',
      canonicalTransaction: { TransactionType: 'Payment' },
      canonicalHash: 'blocked-hash',
      preparedLedgerIndex: 1,
      requestHash: 'blocked-request',
      policySnapshot: {},
      estimatedFeeDrops: 1n,
      estimatedReserveDrops: 10n,
      idempotencyKey: 'blocked-idempotency',
      correlationId: 'blocked-correlation',
      state: 'awaiting_user_signature',
      expiresAt: new Date(Date.now() + 60_000)
    })
    let error = await expectStatus(deleteProject(event(ids.publicId, { confirmationName: ids.projectName })), 409)
    expect(error.data).toMatchObject({ code: 'PROJECT_DELETE_BLOCKED', pendingIntentCount: 1 })
    await database.update(sponsorshipIntents).set({ state: 'validated' }).where(eq(sponsorshipIntents.id, intentId))
    await database.update(projectFundingBudgets).set({ reserveExposureDrops: 10n }).where(eq(projectFundingBudgets.projectId, ids.projectId))
    error = await expectStatus(deleteProject(event(ids.publicId, { confirmationName: ids.projectName })), 409)
    expect(error.data).toMatchObject({ code: 'PROJECT_DELETE_BLOCKED', pendingIntentCount: 0, reserveExposureDrops: '10' })
  })

  it('reuses the surviving organization and rejects archived creation request replay', async () => {
    if (!database) return
    const ids = await createWorkspace({ projectName: 'Archived request' })
    const requestId = randomUUID()
    const publicId = `proj_${createHash('sha256').update(`${ownerId}\0${ids.organizationId}\0${requestId}`).digest('hex')}`
    await database.update(projects).set({ publicId, status: 'archived' }).where(eq(projects.id, ids.projectId))
    await expectStatus(createProject({ body: { organizationId: ids.organizationId, name: ids.projectName, requestId }, headers: { origin: 'http://localhost:3000' } }), 409)

    const onboardingUserId = randomUUID()
    extraUserIds.push(onboardingUserId)
    await database.insert(user).values({ id: onboardingUserId, name: 'Onboarding user', email: `${onboardingUserId}@example.invalid` })
    await database.insert(organizationMemberships).values({ organizationId: ids.organizationId, userId: onboardingUserId, role: 'owner' })
    setSession(onboardingUserId)
    routeMocks.loadProjectProvisioningContext.mockResolvedValue({ rpcUrl: 'http://test.invalid' })
    const result = await onboarding({ body: { organizationName: 'Ignored because workspace exists', projectName: 'Replacement project', network: 'devnet' }, headers: { origin: 'http://localhost:3000' } }) as { organization: { id: string }, project: { organizationId: string, name: string, status: string } }
    expect(result.organization.id).toBe(ids.organizationId)
    expect(result.project.organizationId).toBe(ids.organizationId)
    expect(result.project.name).toBe('Replacement project')
    expect(result.project.status).toBe('active')
  })

  it('does not alter a shared treasury or another project when deleting one binding', async () => {
    if (!database) return
    const first = await createWorkspace({ withSponsor: true, projectName: 'Shared A' })
    const second = await createWorkspace({ projectName: 'Shared B' })
    // Bind a second project-scoped account to the same physical treasury.
    second.treasuryId = first.treasuryId
    second.sponsorAccountId = randomUUID()
    const secondAddress = `rDelete${second.sponsorAccountId.replaceAll('-', '').slice(0, 25)}`
    await database.insert(sponsorAccounts).values({ id: second.sponsorAccountId, projectId: second.projectId, treasuryId: first.treasuryId!, network: 'devnet', address: secondAddress, signerKeyReference: 'test', capabilities: { fee: true, reserve: true } })
    await database.insert(projectSponsorAccounts).values({ projectId: second.projectId, sponsorAccountId: second.sponsorAccountId, network: 'devnet' })
    await database.insert(projectFundingBudgets).values({ projectId: second.projectId })
    await database.insert(sponsorshipPolicies).values({ projectId: second.projectId, name: 'Shared policy', version: 1, status: 'active', document: {}, documentHash: `policy-${second.projectId}` })
    const sharedBalance = await database.select().from(fundingBalances).where(eq(fundingBalances.treasuryId, first.treasuryId!))
    expect(sharedBalance).toHaveLength(1)
    await deleteProject(event(first.publicId, { confirmationName: first.projectName }))
    const [treasury] = await database.select().from(sponsorTreasuries).where(eq(sponsorTreasuries.id, first.treasuryId!))
    const [remainingSponsor] = await database.select().from(sponsorAccounts).where(eq(sponsorAccounts.id, second.sponsorAccountId!))
    expect(treasury?.status).toBe('active')
    expect(remainingSponsor?.status).toBe('active')
    expect(await database.select().from(fundingBalances).where(eq(fundingBalances.treasuryId, first.treasuryId!))).toHaveLength(1)
  })
})
