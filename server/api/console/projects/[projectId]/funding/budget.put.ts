import { and, eq } from 'drizzle-orm'
import { z } from 'zod'
import { auditLogs, projectFundingBudgets, projectFundingQuotas } from '~~/server/database/schema'
import { ensureProjectFundingBudget } from '~~/server/services/funding'
import { requireProjectManagementRole, requireProjectMember } from '~~/server/utils/project-member'
import { useDatabase } from '~~/server/utils/database'
import { requireSameOrigin } from '~~/server/utils/same-origin'

const drops = z.union([
  z.string().regex(/^[0-9]+$/),
  z.number().int().nonnegative().safe()
]).transform(value => BigInt(value))

const schema = z.object({
  expectedVersion: z.number().int().nonnegative().optional(),
  feeBudgetDrops: drops.optional(),
  reserveBudgetDrops: drops.optional(),
  walletFeeQuotaDrops: drops.optional(),
  walletReserveQuotaDrops: drops.optional(),
  quotaPeriodSeconds: z.number().int().min(60).max(31_536_000).optional()
}).refine(value => Object.entries(value).some(([key, item]) => key !== 'expectedVersion' && item !== undefined), { message: 'At least one funding limit is required' })

function serialize(budget: typeof projectFundingBudgets.$inferSelect) {
  return {
    ...budget,
    feeBudgetDrops: budget.feeBudgetDrops.toString(),
    reserveBudgetDrops: budget.reserveBudgetDrops.toString(),
    walletFeeQuotaDrops: budget.walletFeeQuotaDrops.toString(),
    walletReserveQuotaDrops: budget.walletReserveQuotaDrops.toString(),
    feeReservedDrops: budget.feeReservedDrops.toString(),
    feeSpentDrops: budget.feeSpentDrops.toString(),
    reserveReservedDrops: budget.reserveReservedDrops.toString(),
    reserveExposureDrops: budget.reserveExposureDrops.toString()
  }
}

export default defineEventHandler(async (event) => {
  requireSameOrigin(event)
  const context = await requireProjectMember(event, getRouterParam(event, 'projectId'))
  if (context.project.status !== 'active') throw createError({ statusCode: 409, statusMessage: 'Project is paused' })
  requireProjectManagementRole(context.membership.role)
  const parsed = schema.safeParse(await readBody(event))
  if (!parsed.success) throw createError({ statusCode: 400, statusMessage: 'Invalid funding budget', data: parsed.error.flatten() })
  const requestId = getHeader(event, 'x-request-id') || crypto.randomUUID()
  try {
    const budget = await useDatabase().transaction(async (tx) => {
      const current = await ensureProjectFundingBudget(tx, context.project.id, true)
      if (parsed.data.expectedVersion !== undefined && parsed.data.expectedVersion !== current.version) {
        throw createError({ statusCode: 409, statusMessage: 'Funding budget changed; refresh and retry', data: { currentVersion: current.version } })
      }
      const next = {
        feeBudgetDrops: parsed.data.feeBudgetDrops ?? current.feeBudgetDrops,
        reserveBudgetDrops: parsed.data.reserveBudgetDrops ?? current.reserveBudgetDrops,
        walletFeeQuotaDrops: parsed.data.walletFeeQuotaDrops ?? current.walletFeeQuotaDrops,
        walletReserveQuotaDrops: parsed.data.walletReserveQuotaDrops ?? current.walletReserveQuotaDrops,
        quotaPeriodSeconds: parsed.data.quotaPeriodSeconds ?? current.quotaPeriodSeconds
      }
      if (next.feeBudgetDrops < current.feeSpentDrops + current.feeReservedDrops) throw createError({ statusCode: 409, statusMessage: 'Fee budget cannot be below current usage' })
      if (next.reserveBudgetDrops < current.reserveExposureDrops) throw createError({ statusCode: 409, statusMessage: 'Reserve budget cannot be below current exposure' })
      const quotaRows = await tx.select().from(projectFundingQuotas).where(eq(projectFundingQuotas.projectId, context.project.id))
      if (quotaRows.some(quota => next.walletFeeQuotaDrops < quota.feeSpentDrops + quota.feeReservedDrops)) throw createError({ statusCode: 409, statusMessage: 'Wallet fee quota cannot be below current usage' })
      if (quotaRows.some(quota => next.walletReserveQuotaDrops < quota.reserveExposureDrops)) throw createError({ statusCode: 409, statusMessage: 'Wallet reserve quota cannot be below current exposure' })
      const [updated] = await tx.update(projectFundingBudgets).set({ ...next, version: current.version + 1, updatedAt: new Date() }).where(and(eq(projectFundingBudgets.projectId, context.project.id), eq(projectFundingBudgets.version, current.version))).returning()
      if (!updated) throw createError({ statusCode: 409, statusMessage: 'Funding budget changed; refresh and retry' })
      await tx.insert(auditLogs).values({ organizationId: context.organization.id, projectId: context.project.id, actor: context.session.user.email, action: 'funding.budget.updated', resourceType: 'project_funding_budget', resourceId: context.project.id, result: 'success', requestId, metadata: { previousVersion: current.version, version: updated.version } })
      return updated
    })
    return serialize(budget)
  } catch (error) {
    if (error && typeof error === 'object' && 'statusCode' in error) throw error
    throw error
  }
})
