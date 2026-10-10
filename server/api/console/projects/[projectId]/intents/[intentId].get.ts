import { and, asc, eq } from 'drizzle-orm'
import { z } from 'zod'
import { intentEvents, sponsorshipIntents, submissions } from '~~/server/database/schema'
import { useDatabase } from '~~/server/utils/database'
import { requireProjectMember } from '~~/server/utils/project-member'

export default defineEventHandler(async (event) => {
  const context = await requireProjectMember(event, getRouterParam(event, 'projectId'))
  const parsed = z.uuid().safeParse(getRouterParam(event, 'intentId'))
  if (!parsed.success) throw createError({ statusCode: 400, statusMessage: 'A valid intent ID is required' })
  const database = useDatabase()
  const [intent] = await database.select().from(sponsorshipIntents).where(and(eq(sponsorshipIntents.id, parsed.data), eq(sponsorshipIntents.projectId, context.project.id))).limit(1)
  if (!intent) throw createError({ statusCode: 404, statusMessage: 'Intent not found' })
  const [events, attempts] = await Promise.all([
    database.select().from(intentEvents).where(eq(intentEvents.intentId, intent.id)).orderBy(asc(intentEvents.version)),
    database.select({
      attempt: submissions.attempt,
      transactionHash: submissions.transactionHash,
      engineResult: submissions.engineResult,
      actualFeeDrops: submissions.actualFeeDrops,
      ledgerIndex: submissions.ledgerIndex,
      validatedAt: submissions.validatedAt,
      createdAt: submissions.createdAt
    }).from(submissions).where(eq(submissions.intentId, intent.id)).orderBy(asc(submissions.attempt))
  ])
  // Signing artifacts are deliberately omitted from read-only console responses.
  const { userSignedBlob: _userSignedBlob, sponsorSigningHash: _sponsorSigningHash, ...details } = intent
  return {
    ...details,
    estimatedFeeDrops: intent.estimatedFeeDrops.toString(),
    estimatedReserveDrops: intent.estimatedReserveDrops.toString(),
    events,
    submissions: attempts.map(attempt => ({ ...attempt, actualFeeDrops: attempt.actualFeeDrops?.toString() ?? null }))
  }
})
