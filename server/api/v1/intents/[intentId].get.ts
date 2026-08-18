import { asc, eq } from 'drizzle-orm'
import { intentEvents, sponsorshipIntents, submissions } from '~~/server/database/schema'
import { requireIntentApiKey } from '~~/server/utils/api-key'
import { useDatabase } from '~~/server/utils/database'

export default defineEventHandler(async (event) => {
  const intentId = getRouterParam(event, 'intentId')
  if (!intentId) throw createError({ statusCode: 400, statusMessage: 'Intent ID is required' })
  await requireIntentApiKey(event, intentId, 'intents:read')
  const database = useDatabase()
  const [intent] = await database.select().from(sponsorshipIntents).where(eq(sponsorshipIntents.id, intentId)).limit(1)
  if (!intent) throw createError({ statusCode: 404, statusMessage: 'Intent not found' })
  const [events, attempts] = await Promise.all([
    database.select().from(intentEvents).where(eq(intentEvents.intentId, intentId)).orderBy(asc(intentEvents.version)),
    database.select({ attempt: submissions.attempt, transactionHash: submissions.transactionHash, engineResult: submissions.engineResult, ledgerIndex: submissions.ledgerIndex, validatedAt: submissions.validatedAt, createdAt: submissions.createdAt }).from(submissions).where(eq(submissions.intentId, intentId)).orderBy(asc(submissions.attempt))
  ])
  return {
    ...intent,
    estimatedFeeDrops: intent.estimatedFeeDrops.toString(),
    estimatedReserveDrops: intent.estimatedReserveDrops.toString(),
    events,
    submissions: attempts
  }
})
