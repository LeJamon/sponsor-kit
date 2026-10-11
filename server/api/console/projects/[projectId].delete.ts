import { randomUUID } from 'node:crypto'
import { and, count, eq, isNull, notInArray } from 'drizzle-orm'
import { z } from 'zod'
import { apiKeys, auditLogs, projectFundingBudgets, projects, reserveMigrationPlans, reserveObligations, sponsorAccounts, sponsorshipIntents, sponsorshipPolicies } from '~~/server/database/schema'
import { useDatabase } from '~~/server/utils/database'
import { requireProjectManagementRole, requireProjectMember } from '~~/server/utils/project-member'
import { requireSameOrigin } from '~~/server/utils/same-origin'

const schema = z.object({ confirmationName: z.string() })
const terminalIntentStates: Array<'validated' | 'failed' | 'rejected' | 'expired' | 'cancelled' | 'superseded'> = ['validated', 'failed', 'rejected', 'expired', 'cancelled', 'superseded']

export default defineEventHandler(async (event) => {
  requireSameOrigin(event)
  const projectPublicId = getRouterParam(event, 'projectId')
  if (!projectPublicId) throw createError({ statusCode: 400, statusMessage: 'Project ID is required' })
  const context = await requireProjectMember(event, projectPublicId, { includeArchived: true })
  requireProjectManagementRole(context.membership.role)
  const parsed = schema.safeParse(await readBody(event))
  if (!parsed.success) throw createError({ statusCode: 400, statusMessage: 'Project name confirmation is required', data: parsed.error.flatten() })
  if (parsed.data.confirmationName !== context.project.name) throw createError({ statusCode: 400, statusMessage: 'Project name confirmation does not match' })

  // A repeat DELETE is safe and returns the same public identifier. The
  // project-member lookup above still enforces organization membership and
  // owner/admin access for the archived record.
  if (context.project.status === 'archived') return { deleted: true, publicId: context.project.publicId }

  const now = new Date()
  return useDatabase().transaction(async (tx) => {
    // Lock the project before inspecting intents and funding. Intent creation
    // and authorization acquire this same lock first, preventing a deletion
    // from racing a final insert or authorization reservation.
    const [project] = await tx.select().from(projects).where(eq(projects.id, context.project.id)).for('update').limit(1)
    if (!project) throw createError({ statusCode: 404, statusMessage: 'Project not found' })
    if (project.status === 'archived') return { deleted: true, publicId: project.publicId }

    const [pendingIntents, activeObligations, budget] = await Promise.all([
      tx.select({ value: count() }).from(sponsorshipIntents).where(and(
        eq(sponsorshipIntents.projectId, project.id),
        notInArray(sponsorshipIntents.state, terminalIntentStates)
      )).limit(1),
      tx.select({ value: count() }).from(reserveObligations)
        .innerJoin(sponsorshipIntents, eq(sponsorshipIntents.id, reserveObligations.intentId))
        .where(and(
          eq(sponsorshipIntents.projectId, project.id),
          eq(reserveObligations.state, 'active')
        )).limit(1),
      tx.select({ feeReservedDrops: projectFundingBudgets.feeReservedDrops, reserveReservedDrops: projectFundingBudgets.reserveReservedDrops, reserveExposureDrops: projectFundingBudgets.reserveExposureDrops })
        .from(projectFundingBudgets)
        .where(eq(projectFundingBudgets.projectId, project.id))
        .limit(1)
    ])
    const pendingIntentCount = Number(pendingIntents[0]?.value || 0)
    const activeReserveObligationCount = Number(activeObligations[0]?.value || 0)
    const feeReservedDrops = budget[0]?.feeReservedDrops || 0n
    const reserveReservedDrops = budget[0]?.reserveReservedDrops || 0n
    const reserveExposureDrops = budget[0]?.reserveExposureDrops || 0n
    if (pendingIntentCount || activeReserveObligationCount || feeReservedDrops > 0n || reserveReservedDrops > 0n || reserveExposureDrops > 0n) {
      throw createError({
        statusCode: 409,
        statusMessage: 'Project cannot be deleted while pending transactions or active reserve sponsorships exist',
        data: {
          code: 'PROJECT_DELETE_BLOCKED',
          pendingIntentCount,
          activeReserveObligationCount,
          feeReservedDrops: feeReservedDrops.toString(),
          reserveReservedDrops: reserveReservedDrops.toString(),
          reserveExposureDrops: reserveExposureDrops.toString()
        }
      })
    }

    await tx.update(apiKeys).set({ revokedAt: now }).where(and(eq(apiKeys.projectId, project.id), isNull(apiKeys.revokedAt)))
    await tx.update(sponsorshipPolicies).set({ status: 'archived' }).where(eq(sponsorshipPolicies.projectId, project.id))
    await tx.update(reserveMigrationPlans).set({ state: 'archived', updatedAt: now }).where(eq(reserveMigrationPlans.projectId, project.id))
    await tx.update(sponsorAccounts).set({ status: 'archived' }).where(eq(sponsorAccounts.projectId, project.id))
    const [archived] = await tx.update(projects).set({ status: 'archived', updatedAt: now }).where(eq(projects.id, project.id)).returning({ publicId: projects.publicId })
    if (!archived) throw new Error('Project deletion failed')
    await tx.insert(auditLogs).values({
      organizationId: project.organizationId,
      projectId: project.id,
      actor: context.session.user.email,
      action: 'project.deleted',
      resourceType: 'project',
      resourceId: project.id,
      result: 'success',
      requestId: getHeader(event, 'x-request-id') || randomUUID(),
      metadata: { publicId: project.publicId, name: project.name }
    })
    return { deleted: true, publicId: archived.publicId }
  })
})
