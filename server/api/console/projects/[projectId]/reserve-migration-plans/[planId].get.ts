import { and, asc, eq, inArray } from 'drizzle-orm'
import { reserveMigrationPlans, reserveMigrationTargets, sponsorshipIntents, submissions } from '~~/server/database/schema'
import { useDatabase } from '~~/server/utils/database'
import { requireProjectMember } from '~~/server/utils/project-member'

export default defineEventHandler(async (event) => {
  const context = await requireProjectMember(event, getRouterParam(event, 'projectId'))
  const planId = getRouterParam(event, 'planId')
  if (!planId) throw createError({ statusCode: 400, statusMessage: 'Plan ID is required' })
  const database = useDatabase()
  const [plan] = await database.select().from(reserveMigrationPlans).where(and(eq(reserveMigrationPlans.id, planId), eq(reserveMigrationPlans.projectId, context.project.id))).limit(1)
  if (!plan) throw createError({ statusCode: 404, statusMessage: 'Reserve migration plan not found' })
  const targets = await database.select().from(reserveMigrationTargets).where(eq(reserveMigrationTargets.planId, plan.id)).orderBy(asc(reserveMigrationTargets.createdAt))
  const intentIds = targets.flatMap(target => target.intentId ? [target.intentId] : [])
  const intents = intentIds.length ? await database.select().from(sponsorshipIntents).where(inArray(sponsorshipIntents.id, intentIds)) : []
  const submissionRows = intentIds.length ? await database.select().from(submissions).where(inArray(submissions.intentId, intentIds)) : []
  const intentById = new Map(intents.map(intent => [intent.id, intent]))
  const submissionByIntent = new Map(submissionRows.map(submission => [submission.intentId, submission]))
  return {
    ...plan,
    targets: targets.map((target) => {
      const intent = target.intentId ? intentById.get(target.intentId) : undefined
      const submission = target.intentId ? submissionByIntent.get(target.intentId) : undefined
      return {
        ...target,
        estimatedReserveDrops: target.estimatedReserveDrops.toString(),
        intent: intent ? { id: intent.id, state: intent.state, expiresAt: intent.expiresAt, transactionHash: submission?.transactionHash || null, ledgerIndex: submission?.ledgerIndex || null } : null
      }
    })
  }
})
