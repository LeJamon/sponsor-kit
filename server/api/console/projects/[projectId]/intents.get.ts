import { and, desc, eq, ilike, inArray, lt, or, sql } from 'drizzle-orm'
import { z } from 'zod'
import { sponsorshipIntents, sponsorshipPolicies, submissions } from '~~/server/database/schema'
import { useDatabase } from '~~/server/utils/database'
import { requireProjectMember } from '~~/server/utils/project-member'
import { decodeIntentCursor, encodeIntentCursor } from '~~/server/utils/intent-cursor'

const querySchema = z.object({ search: z.string().max(100).optional(), status: z.string().refine(value => value.split(',').every(state => sponsorshipIntents.state.enumValues.includes(state as typeof sponsorshipIntents.state.enumValues[number]))).optional(), cursor: z.string().max(256).optional(), limit: z.coerce.number().int().min(1).max(100).default(25) })

export default defineEventHandler(async (event) => {
  const projectId = getRouterParam(event, 'projectId')
  const context = await requireProjectMember(event, projectId)
  const parsed = querySchema.safeParse(getQuery(event))
  if (!parsed.success) throw createError({ statusCode: 400, statusMessage: 'Invalid intent filters' })
  const states = parsed.data.status?.split(',').filter(Boolean)
  const filters = [eq(sponsorshipIntents.projectId, context.project.id)]
  if (parsed.data.cursor) {
    const cursor = decodeIntentCursor(parsed.data.cursor)
    if (!cursor) throw createError({ statusCode: 400, statusMessage: 'Invalid transaction cursor' })
    filters.push(or(
      lt(sponsorshipIntents.createdAt, sql`${cursor.createdAt}::timestamptz`),
      and(eq(sponsorshipIntents.createdAt, sql`${cursor.createdAt}::timestamptz`), lt(sponsorshipIntents.id, cursor.id))
    )!)
  }
  if (states?.length) filters.push(inArray(sponsorshipIntents.state, states as typeof sponsorshipIntents.state.enumValues))
  if (parsed.data.search) filters.push(or(ilike(sponsorshipIntents.accountAddress, `%${parsed.data.search}%`), ilike(sql`${sponsorshipIntents.id}::text`, `%${parsed.data.search}%`))!)
  const rows = await useDatabase().select({ intent: sponsorshipIntents, cursorCreatedAt: sql<string>`to_char(${sponsorshipIntents.createdAt} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`, policyName: sponsorshipPolicies.name, policyVersion: sponsorshipPolicies.version }).from(sponsorshipIntents)
    .leftJoin(sponsorshipPolicies, eq(sponsorshipPolicies.id, sponsorshipIntents.policyId))
    .where(and(...filters)).orderBy(desc(sponsorshipIntents.createdAt), desc(sponsorshipIntents.id)).limit(parsed.data.limit + 1)
  const hasMore = rows.length > parsed.data.limit
  const page = rows.slice(0, parsed.data.limit)
  const latestSubmissionByIntent = new Map<string, { transactionHash: string, ledgerIndex: number | null, validatedAt: Date | null }>()
  if (page.length) {
    const submissionRows = await useDatabase().select({ intentId: submissions.intentId, transactionHash: submissions.transactionHash, ledgerIndex: submissions.ledgerIndex, validatedAt: submissions.validatedAt })
      .from(submissions).where(inArray(submissions.intentId, page.map(row => row.intent.id))).orderBy(desc(submissions.attempt))
    for (const submission of submissionRows) {
      if (!latestSubmissionByIntent.has(submission.intentId)) latestSubmissionByIntent.set(submission.intentId, submission)
    }
  }
  const items = page.map((row) => {
    const submission = latestSubmissionByIntent.get(row.intent.id)
    const { userSignedBlob: _blob, sponsorSigningHash: _hash, ...intent } = row.intent
    return { ...intent, estimatedFeeDrops: row.intent.estimatedFeeDrops.toString(), estimatedReserveDrops: row.intent.estimatedReserveDrops.toString(), policy: row.policyName ? { name: row.policyName, version: row.policyVersion } : null, transactionHash: submission?.transactionHash || null, ledgerIndex: submission?.ledgerIndex || null, validatedAt: submission?.validatedAt || null }
  })
  const last = page.at(-1)
  return { items, nextCursor: hasMore && last ? encodeIntentCursor({ createdAt: last.cursorCreatedAt, id: last.intent.id }) : null }
})
