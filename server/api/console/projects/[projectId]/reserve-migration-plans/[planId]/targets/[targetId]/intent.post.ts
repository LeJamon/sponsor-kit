import { randomUUID } from 'node:crypto'
import { and, eq, inArray, ne } from 'drizzle-orm'
import { reserveMigrationPlans, reserveMigrationTargets, sponsorAccounts, sponsorshipIntents } from '~~/server/database/schema'
import { createSponsorshipIntent } from '~~/server/services/intent-creation'
import { inspectReserveTargets } from '~~/server/services/reserve-inspection'
import { loadSponsorProtocolDefinitions } from '~~/server/services/xrpl/definitions'
import { useDatabase } from '~~/server/utils/database'
import { requireProjectManagementRole, requireProjectMember } from '~~/server/utils/project-member'
import { requireSameOrigin } from '~~/server/utils/same-origin'

const inFlightStates = ['awaiting_user_signature', 'user_signature_received', 'verified', 'awaiting_sponsor_signature', 'submitting', 'submitted'] as const

export default defineEventHandler(async (event) => {
  requireSameOrigin(event)
  const context = await requireProjectMember(event, getRouterParam(event, 'projectId'))
  requireProjectManagementRole(context.membership.role)
  const planId = getRouterParam(event, 'planId')
  const targetId = getRouterParam(event, 'targetId')
  if (!planId || !targetId) throw createError({ statusCode: 400, statusMessage: 'Plan and target IDs are required' })
  const database = useDatabase()
  const [row] = await database.select({ plan: reserveMigrationPlans, target: reserveMigrationTargets, sponsor: sponsorAccounts })
    .from(reserveMigrationTargets)
    .innerJoin(reserveMigrationPlans, eq(reserveMigrationPlans.id, reserveMigrationTargets.planId))
    .innerJoin(sponsorAccounts, eq(sponsorAccounts.id, reserveMigrationPlans.sponsorAccountId))
    .where(and(eq(reserveMigrationPlans.id, planId), eq(reserveMigrationPlans.projectId, context.project.id), eq(reserveMigrationTargets.id, targetId))).limit(1)
  if (!row) throw createError({ statusCode: 404, statusMessage: 'Migration target not found' })
  if (row.plan.expiresAt <= new Date()) throw createError({ statusCode: 409, statusMessage: 'Migration plan expired; inspect the account again' })
  if (row.target.classification !== 'eligible') throw createError({ statusCode: 409, statusMessage: 'This reserve target is not eligible' })
  if (row.target.intentId) {
    const [existing] = await database.select().from(sponsorshipIntents).where(eq(sponsorshipIntents.id, row.target.intentId)).limit(1)
    if (existing && inFlightStates.includes(existing.state as typeof inFlightStates[number])) throw createError({ statusCode: 409, statusMessage: 'This target already has an active intent' })
  }
  const otherTargets = await database.select({ intentId: reserveMigrationTargets.intentId }).from(reserveMigrationTargets).where(and(eq(reserveMigrationTargets.planId, planId), ne(reserveMigrationTargets.id, targetId)))
  const otherIntentIds = otherTargets.flatMap(target => target.intentId ? [target.intentId] : [])
  if (otherIntentIds.length) {
    const [active] = await database.select().from(sponsorshipIntents).where(and(inArray(sponsorshipIntents.id, otherIntentIds), inArray(sponsorshipIntents.state, inFlightStates))).limit(1)
    if (active) throw createError({ statusCode: 409, statusMessage: 'Finish the current transfer before preparing the next sequence' })
  }
  const inspection = await inspectReserveTargets({ rpcUrl: context.project.rpcUrl, account: row.plan.accountAddress })
  const freshTarget = inspection.targets.find(target => target.targetKey === row.target.targetKey)
  if (!freshTarget || freshTarget.snapshotHash !== row.target.snapshotHash || freshTarget.classification !== 'eligible') {
    await database.update(reserveMigrationTargets).set({ state: 'superseded', errorCode: 'LEDGER_STATE_CHANGED', updatedAt: new Date() }).where(eq(reserveMigrationTargets.id, targetId))
    throw createError({ statusCode: 409, statusMessage: 'The ledger object changed; inspect the wallet again' })
  }
  if (inspection.definitionsHash !== row.plan.definitionsHash) throw createError({ statusCode: 409, statusMessage: 'XRPL definitions changed; inspect the wallet again' })
  const protocol = await loadSponsorProtocolDefinitions({ rpcUrl: context.project.rpcUrl, allowedHashes: [row.plan.definitionsHash] })
  const result = await createSponsorshipIntent({
    project: context.project,
    idempotencyKey: `reserve-migration:${targetId}:${row.target.snapshotHash}`,
    correlationId: randomUUID(),
    actor: `user:${context.session.user.id}`,
    request: {
      account: row.plan.accountAddress,
      transaction: {
        TransactionType: 'SponsorshipTransfer',
        Flags: protocol.flags.transferCreate,
        ...(row.target.objectId ? { ObjectID: row.target.objectId } : {})
      },
      sponsorship: { fee: true, reserve: true },
      signing: { mode: 'single', signerCount: 1 }
    }
  })
  await database.transaction(async (tx) => {
    await tx.update(reserveMigrationTargets).set({ state: 'awaiting_signature', intentId: result.id, errorCode: null, updatedAt: new Date() }).where(eq(reserveMigrationTargets.id, targetId))
    await tx.update(reserveMigrationPlans).set({ state: 'migrating', version: row.plan.version + 1, updatedAt: new Date() }).where(eq(reserveMigrationPlans.id, planId))
  })
  setResponseStatus(event, 201)
  return result
})
