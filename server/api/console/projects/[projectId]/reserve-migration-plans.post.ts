import { randomUUID } from 'node:crypto'
import { and, eq } from 'drizzle-orm'
import { z } from 'zod'
import { auditLogs, reserveMigrationPlans, reserveMigrationTargets, sponsorAccounts } from '~~/server/database/schema'
import { inspectReserveTargets } from '~~/server/services/reserve-inspection'
import { useDatabase } from '~~/server/utils/database'
import { requireProjectManagementRole, requireProjectMember } from '~~/server/utils/project-member'
import { requireSameOrigin } from '~~/server/utils/same-origin'

const bodySchema = z.object({ account: z.string().min(25).max(40) })

export default defineEventHandler(async (event) => {
  requireSameOrigin(event)
  const context = await requireProjectMember(event, getRouterParam(event, 'projectId'))
  requireProjectManagementRole(context.membership.role)
  const parsed = bodySchema.safeParse(await readBody(event))
  if (!parsed.success) throw createError({ statusCode: 400, statusMessage: 'Invalid XRPL account', data: parsed.error.flatten() })
  const database = useDatabase()
  const [sponsor] = await database.select().from(sponsorAccounts).where(and(eq(sponsorAccounts.projectId, context.project.id), eq(sponsorAccounts.network, context.project.network), eq(sponsorAccounts.status, 'active'))).limit(1)
  if (!sponsor) throw createError({ statusCode: 409, statusMessage: 'No active sponsor account is configured' })
  const inspection = await inspectReserveTargets({ rpcUrl: context.project.rpcUrl, account: parsed.data.account })
  const planId = randomUUID()
  const expiresAt = new Date(Date.now() + 15 * 60_000)
  await database.transaction(async (tx) => {
    await tx.insert(reserveMigrationPlans).values({
      id: planId,
      projectId: context.project.id,
      sponsorAccountId: sponsor.id,
      accountAddress: inspection.account,
      network: context.project.network,
      networkId: inspection.networkId,
      definitionsHash: inspection.definitionsHash,
      inspectionLedgerIndex: inspection.ledgerIndex,
      inspectionLedgerHash: inspection.ledgerHash,
      expiresAt,
      createdBy: context.session.user.id
    })
    await tx.insert(reserveMigrationTargets).values(inspection.targets.map(target => ({
      id: randomUUID(),
      planId,
      ...target,
      estimatedReserveDrops: BigInt(target.estimatedReserveDrops),
      state: target.classification === 'eligible' ? 'available' : 'skipped'
    })))
    await tx.insert(auditLogs).values({
      organizationId: context.organization.id,
      projectId: context.project.id,
      actor: context.session.user.email,
      action: 'reserve_migration.inspected',
      resourceType: 'reserve_migration_plan',
      resourceId: planId,
      result: 'success',
      requestId: getHeader(event, 'x-request-id') || randomUUID(),
      metadata: { account: inspection.account, ledgerIndex: inspection.ledgerIndex, targetCount: inspection.targets.length }
    })
  })
  setResponseStatus(event, 201)
  return { id: planId, expiresAt }
})
