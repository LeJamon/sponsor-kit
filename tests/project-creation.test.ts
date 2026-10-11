import { randomUUID } from 'node:crypto'
import postgres from 'postgres'
import { drizzle } from 'drizzle-orm/postgres-js'
import { and, eq, inArray } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { fundingBalances, organizationMemberships, organizations, networkSnapshots, projectFundingBudgets, projectSponsorAccounts, projects, sponsorAccounts, sponsorTreasuries, sponsorshipPolicies, user } from '../server/database/schema'

const routeMocks = vi.hoisted(() => ({
  authGetSession: vi.fn(),
  loadSponsorProtocolDefinitions: vi.fn(),
  parseDefinitionsHashAllowlist: vi.fn(),
  requireSameOrigin: vi.fn(),
  useDatabase: vi.fn(),
  xrplRpc: vi.fn()
}))

vi.mock('~~/lib/auth', () => ({ auth: { api: { getSession: routeMocks.authGetSession } } }))
vi.mock('~~/server/database/schema', async () => vi.importActual('../server/database/schema'))
vi.mock('~~/server/services/project-provisioning', async () => vi.importActual('../server/services/project-provisioning'))
vi.mock('../server/services/project-provisioning', async () => vi.importActual('../server/services/project-provisioning'))
vi.mock('~~/server/services/xrpl/definitions', () => ({ loadSponsorProtocolDefinitions: routeMocks.loadSponsorProtocolDefinitions, parseDefinitionsHashAllowlist: routeMocks.parseDefinitionsHashAllowlist }))
vi.mock('../server/services/xrpl/definitions', () => ({ loadSponsorProtocolDefinitions: routeMocks.loadSponsorProtocolDefinitions, parseDefinitionsHashAllowlist: routeMocks.parseDefinitionsHashAllowlist }))
vi.mock('~~/server/utils/database', () => ({ useDatabase: routeMocks.useDatabase }))
vi.mock('~~/server/utils/same-origin', () => ({ requireSameOrigin: routeMocks.requireSameOrigin }))
vi.mock('~~/server/utils/xrpl-rpc', () => ({ xrplRpc: routeMocks.xrplRpc }))
vi.mock('../server/utils/database', () => ({ useDatabase: routeMocks.useDatabase }))
vi.mock('../server/utils/xrpl-rpc', () => ({ xrplRpc: routeMocks.xrplRpc }))

const databaseUrl = process.env.MVP_FUNDING_TEST_DATABASE_URL
const client = databaseUrl ? postgres(databaseUrl, { max: 8, prepare: false }) : undefined
const database = client ? drizzle(client) : undefined

type TestEvent = { body?: unknown, headers?: Record<string, string>, status?: number }
type RouteHandler = (event: TestEvent) => Promise<unknown>

const protocol = {
  amendmentId: 'test-amendment',
  definitions: {},
  definitionsHash: 'definitions',
  flags: { sponsorFee: 1, sponsorReserve: 2, transferEnd: 4, transferCreate: 8, transferReassign: 16, sponsorCreatedAccount: 32 },
  networkId: 2,
  serverVersion: 'rippled-test',
  transactionTypes: ['Payment']
}

describe.skipIf(!database)('console project creation', () => {
  const ids = {
    organization: randomUUID(),
    owner: randomUUID(),
    admin: randomUUID(),
    developer: randomUUID(),
    foreignOwner: randomUUID(),
    foreignOrganization: randomUUID(),
    suspendedOrganization: randomUUID(),
    sponsorAddress: `rProjectCreation${randomUUID().replaceAll('-', '').slice(0, 24)}`
  }
  let createProject: RouteHandler

  function installRouteGlobals() {
    vi.stubGlobal('defineEventHandler', (handler: unknown) => handler)
    vi.stubGlobal('createError', (input: { statusCode: number, statusMessage: string, data?: unknown }) => Object.assign(new Error(input.statusMessage), input))
    vi.stubGlobal('getHeader', (event: TestEvent, name: string) => event.headers?.[name.toLowerCase()])
    vi.stubGlobal('readBody', (event: TestEvent) => event.body)
    vi.stubGlobal('setResponseStatus', (event: TestEvent, status: number) => {
      event.status = status
    })
  }

  function event(body: unknown): TestEvent {
    return { body, headers: { origin: 'http://localhost:3000' } }
  }

  function installRpcMock() {
    routeMocks.xrplRpc.mockImplementation(async (_url: string, method: string) => {
      if (method === 'account_info') return { account_data: { Balance: '1000000000' }, ledger_index: 1 }
      if (method === 'server_state') return { state: { validated_ledger: { base_fee: '10', reserve_base: '10000000', reserve_inc: '2000000', seq: 1 } } }
      throw new Error(`Unexpected RPC method ${method}`)
    })
  }

  async function expectStatus(request: Promise<unknown>, statusCode: number) {
    try {
      await request
      throw new Error(`Expected status ${statusCode}`)
    } catch (error) {
      expect(error).toMatchObject({ statusCode })
    }
  }

  async function cleanupProjects() {
    if (!database) return
    const rows = await database.select({ id: projects.id }).from(projects).where(eq(projects.organizationId, ids.organization))
    const projectIds = rows.map(row => row.id)
    if (projectIds.length) {
      await database.delete(projectSponsorAccounts).where(inArray(projectSponsorAccounts.projectId, projectIds))
      const accounts = await database.select({ id: sponsorAccounts.id }).from(sponsorAccounts).where(inArray(sponsorAccounts.projectId, projectIds))
      if (accounts.length) await database.delete(sponsorAccounts).where(inArray(sponsorAccounts.id, accounts.map(account => account.id)))
      await database.delete(projects).where(inArray(projects.id, projectIds))
    }
    await database.delete(sponsorTreasuries).where(and(eq(sponsorTreasuries.network, 'devnet'), eq(sponsorTreasuries.address, ids.sponsorAddress)))
  }

  beforeAll(async () => {
    if (!database) return
    installRouteGlobals()
    routeMocks.useDatabase.mockReturnValue(database)
    routeMocks.requireSameOrigin.mockImplementation(() => undefined)
    routeMocks.authGetSession.mockResolvedValue({ user: { id: ids.owner, email: `owner-${ids.owner}@example.invalid`, role: 'user' } })
    routeMocks.loadSponsorProtocolDefinitions.mockResolvedValue(protocol)
    routeMocks.parseDefinitionsHashAllowlist.mockReturnValue(undefined)
    installRpcMock()
    vi.stubEnv('ACME_XRPL_RPC_URL', 'http://test.invalid')
    vi.stubEnv('ACME_LOCAL_SPONSOR_ADDRESS', ids.sponsorAddress)
    await database.insert(user).values([
      { id: ids.owner, name: 'Project owner', email: `owner-${ids.owner}@example.invalid` },
      { id: ids.admin, name: 'Project admin', email: `admin-${ids.admin}@example.invalid` },
      { id: ids.developer, name: 'Project developer', email: `developer-${ids.developer}@example.invalid` },
      { id: ids.foreignOwner, name: 'Foreign owner', email: `foreign-${ids.foreignOwner}@example.invalid` }
    ])
    await database.insert(organizations).values([
      { id: ids.organization, name: 'Project creation test', slug: `project-creation-${ids.organization}` },
      { id: ids.foreignOrganization, name: 'Foreign organization', slug: `project-creation-foreign-${ids.foreignOrganization}` },
      { id: ids.suspendedOrganization, name: 'Suspended organization', slug: `project-creation-suspended-${ids.suspendedOrganization}`, status: 'paused' }
    ])
    await database.insert(organizationMemberships).values([
      { organizationId: ids.organization, userId: ids.owner, role: 'owner' },
      { organizationId: ids.organization, userId: ids.admin, role: 'admin' },
      { organizationId: ids.organization, userId: ids.developer, role: 'developer' },
      { organizationId: ids.foreignOrganization, userId: ids.foreignOwner, role: 'owner' },
      { organizationId: ids.suspendedOrganization, userId: ids.owner, role: 'owner' }
    ])
    createProject = (await import('../server/api/console/projects/index.post')).default as RouteHandler
  })

  beforeEach(async () => {
    if (!database) return
    await cleanupProjects()
    routeMocks.authGetSession.mockResolvedValue({ user: { id: ids.owner, email: `owner-${ids.owner}@example.invalid`, role: 'user' } })
    routeMocks.loadSponsorProtocolDefinitions.mockClear()
    routeMocks.xrplRpc.mockClear()
    installRpcMock()
  })

  afterAll(async () => {
    if (!database || !client) return
    await cleanupProjects()
    await database.delete(organizationMemberships).where(inArray(organizationMemberships.organizationId, [ids.organization, ids.foreignOrganization, ids.suspendedOrganization]))
    await database.delete(organizations).where(inArray(organizations.id, [ids.organization, ids.foreignOrganization, ids.suspendedOrganization]))
    await database.delete(user).where(inArray(user.id, [ids.owner, ids.admin, ids.developer, ids.foreignOwner]))
    await client.end()
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
  })

  it('creates a project with the shared sponsor and onboarding defaults', async () => {
    if (!database) return
    const requestId = randomUUID()
    const response = await createProject(event({ organizationId: ids.organization, name: 'Payments API', requestId })) as { project: typeof projects.$inferSelect, organization: typeof organizations.$inferSelect }
    expect(response.project.name).toBe('Payments API')
    expect(response.project.organizationId).toBe(ids.organization)
    expect(response.organization.id).toBe(ids.organization)
    expect(response.project.publicId).toMatch(/^proj_[0-9a-f]{64}$/)

    const [budget] = await database.select().from(projectFundingBudgets).where(eq(projectFundingBudgets.projectId, response.project.id))
    const [sponsor] = await database.select().from(sponsorAccounts).where(eq(sponsorAccounts.projectId, response.project.id))
    const [binding] = await database.select().from(projectSponsorAccounts).where(eq(projectSponsorAccounts.projectId, response.project.id))
    const [balance] = await database.select().from(fundingBalances).where(eq(fundingBalances.sponsorAccountId, sponsor.id))
    const [policy] = await database.select().from(sponsorshipPolicies).where(eq(sponsorshipPolicies.projectId, response.project.id))
    const [snapshot] = await database.select().from(networkSnapshots).where(eq(networkSnapshots.projectId, response.project.id))
    expect(budget).toMatchObject({ feeBudgetDrops: 1_000_000n, reserveBudgetDrops: 100_000_000n })
    expect(sponsor.address).toBe(ids.sponsorAddress)
    expect(binding?.sponsorAccountId).toBe(sponsor.id)
    expect(balance?.treasuryId).toBe(sponsor.treasuryId)
    expect(policy?.status).toBe('active')
    expect(snapshot).toMatchObject({ network: 'devnet', networkId: 2, ledgerIndex: 1, endpointHealthy: true })
  })

  it('requires an authenticated session', async () => {
    if (!database) return
    const databaseCalls = routeMocks.useDatabase.mock.calls.length
    routeMocks.authGetSession.mockResolvedValue(null)
    await expectStatus(createProject(event({ organizationId: ids.organization, name: 'Unauthenticated project', requestId: randomUUID() })), 401)
    expect(routeMocks.useDatabase.mock.calls).toHaveLength(databaseCalls)
  })

  it('allows an active organization admin to create a project', async () => {
    if (!database) return
    routeMocks.authGetSession.mockResolvedValue({ user: { id: ids.admin, email: `admin-${ids.admin}@example.invalid`, role: 'user' } })
    const request = event({ organizationId: ids.organization, name: 'Admin project', requestId: randomUUID() })
    const response = await createProject(request) as { project: typeof projects.$inferSelect }
    expect(request.status).toBe(201)
    expect(response.project.name).toBe('Admin project')
  })

  it('rejects members without organization administrator access', async () => {
    if (!database) return
    routeMocks.authGetSession.mockResolvedValue({ user: { id: ids.developer, email: `developer-${ids.developer}@example.invalid`, role: 'user' } })
    await expectStatus(createProject(event({ organizationId: ids.organization, name: 'Denied project', requestId: randomUUID() })), 403)
    expect(routeMocks.loadSponsorProtocolDefinitions).not.toHaveBeenCalled()
  })

  it('rejects a request for an organization where the user is not a member', async () => {
    if (!database) return
    await expectStatus(createProject(event({ organizationId: ids.foreignOrganization, name: 'Foreign project', requestId: randomUUID() })), 403)
    expect(routeMocks.loadSponsorProtocolDefinitions).not.toHaveBeenCalled()
  })

  it('rejects a suspended organization even for its owner', async () => {
    if (!database) return
    await expectStatus(createProject(event({ organizationId: ids.suspendedOrganization, name: 'Suspended project', requestId: randomUUID() })), 403)
    expect(routeMocks.loadSponsorProtocolDefinitions).not.toHaveBeenCalled()
  })

  it('validates the project name before provisioning', async () => {
    if (!database) return
    for (const name of ['x', 'x'.repeat(81)]) {
      await expectStatus(createProject(event({ organizationId: ids.organization, name, requestId: randomUUID() })), 400)
    }
    expect(routeMocks.loadSponsorProtocolDefinitions).not.toHaveBeenCalled()
  })

  it('retries the same request idempotently under concurrency and rejects a changed name', async () => {
    if (!database) return
    const requestId = randomUUID()
    const body = { organizationId: ids.organization, name: 'Concurrent project', requestId }
    const firstEvent = event(body)
    const secondEvent = event(body)
    const results = await Promise.all([createProject(firstEvent), createProject(secondEvent)]) as Array<{ project: typeof projects.$inferSelect, organization: typeof organizations.$inferSelect }>
    expect(results[0].project.id).toBe(results[1].project.id)
    expect([201, 200]).toContain(firstEvent.status)
    expect([201, 200]).toContain(secondEvent.status)
    const rows = await database.select().from(projects).where(and(eq(projects.organizationId, ids.organization), eq(projects.name, body.name)))
    expect(rows).toHaveLength(1)
    routeMocks.xrplRpc.mockRejectedValue(new Error('XRPL unavailable'))
    const retryEvent = event(body)
    const retry = await createProject(retryEvent) as { project: typeof projects.$inferSelect }
    expect(retryEvent.status).toBe(200)
    expect(retry.project.id).toBe(results[0].project.id)
    await expectStatus(createProject(event({ ...body, name: 'Changed name' })), 409)
    const accounts = await database.select().from(sponsorAccounts).where(eq(sponsorAccounts.projectId, results[0].project.id))
    expect(accounts).toHaveLength(1)
  })
})
