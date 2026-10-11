import { randomUUID } from 'node:crypto'
import postgres from 'postgres'
import { drizzle } from 'drizzle-orm/postgres-js'
import { eq, inArray, sql } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { organizations, projects, sponsorshipIntents } from '../server/database/schema'
import { decodeIntentCursor } from '../server/utils/intent-cursor'

const mocks = vi.hoisted(() => ({ database: vi.fn(), member: vi.fn() }))
vi.mock('~~/server/database/schema', async () => vi.importActual('../server/database/schema'))
vi.mock('~~/server/utils/database', () => ({ useDatabase: mocks.database }))
vi.mock('~~/server/utils/project-member', () => ({ requireProjectMember: mocks.member }))
vi.mock('~~/server/utils/intent-cursor', async () => vi.importActual('../server/utils/intent-cursor'))

const url = process.env.MVP_FUNDING_TEST_DATABASE_URL
const client = url ? postgres(url, { max: 2, prepare: false }) : undefined
const database = client ? drizzle(client) : undefined

type Event = { query: Record<string, unknown> }
type Page = { items: { id: string }[], nextCursor: string | null }

describe.skipIf(!database)('transaction history pagination', () => {
  const organizationId = randomUUID()
  const projectId = randomUUID()
  const foreignId = randomUUID()
  const expectedIds = Array.from({ length: 7 }, () => randomUUID()).sort().reverse()
  let handler: (event: Event) => Promise<Page>

  beforeAll(async () => {
    if (!database) return
    vi.stubGlobal('defineEventHandler', (fn: unknown) => fn)
    vi.stubGlobal('getRouterParam', () => 'project')
    vi.stubGlobal('getQuery', (event: Event) => event.query)
    vi.stubGlobal('createError', (error: { statusCode: number, statusMessage: string }) => Object.assign(new Error(error.statusMessage), error))
    mocks.database.mockReturnValue(database)
    mocks.member.mockResolvedValue({ project: { id: projectId } })
    handler = (await import('../server/api/console/projects/[projectId]/intents.get')).default as typeof handler
    await database.insert(organizations).values({ id: organizationId, name: 'History test', slug: `history-${organizationId}` })
    await database.insert(projects).values([projectId, foreignId].map(id => ({ id, organizationId, name: 'History project', publicId: `history-${id}`, network: 'devnet' as const, rpcUrl: 'http://test.invalid' })))
    await database.insert(sponsorshipIntents).values([...expectedIds, randomUUID()].map((id, index) => ({
      id, projectId: index === expectedIds.length ? foreignId : projectId,
      accountAddress: 'rTest', network: 'devnet' as const, networkId: 2, definitionsHash: 'test', mode: 'fee',
      canonicalTransaction: { TransactionType: 'Payment' }, canonicalHash: id, preparedLedgerIndex: 1,
      requestHash: id, policySnapshot: {}, idempotencyKey: id, correlationId: id,
      state: 'validated' as const, expiresAt: new Date('2026-01-01T01:00:00Z'),
      createdAt: sql`'2026-01-01T00:00:00.123456Z'::timestamptz`
    })))
  })

  afterAll(async () => {
    if (!database || !client) return
    await database.delete(sponsorshipIntents).where(inArray(sponsorshipIntents.projectId, [projectId, foreignId]))
    await database.delete(projects).where(inArray(projects.id, [projectId, foreignId]))
    await database.delete(organizations).where(eq(organizations.id, organizationId))
    await client.end()
  })

  it('pages tied microsecond timestamps without skipping, duplicating, or crossing projects', async () => {
    const seen: string[] = []
    let cursor: string | undefined
    for (let page = 0; page < 4; page++) {
      const response = await handler({ query: { limit: 2, cursor } })
      seen.push(...response.items.map(item => item.id))
      if (!response.nextCursor) break
      expect(decodeIntentCursor(response.nextCursor)?.createdAt).toBe('2026-01-01T00:00:00.123456Z')
      cursor = response.nextCursor
    }
    expect(seen).toEqual(expectedIds)
  })

  it('rejects malformed cursors instead of silently restarting history', async () => {
    await expect(handler({ query: { cursor: 'not-a-cursor' } })).rejects.toMatchObject({ statusCode: 400 })
  })
})
