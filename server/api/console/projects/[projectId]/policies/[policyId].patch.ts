import { randomUUID } from 'node:crypto'
import { and, eq, ne } from 'drizzle-orm'
import { z } from 'zod'
import { auditLogs, sponsorshipPolicies } from '~~/server/database/schema'
import { useDatabase } from '~~/server/utils/database'
import { requireProjectManagementRole, requireProjectMember } from '~~/server/utils/project-member'
import { requireSameOrigin } from '~~/server/utils/same-origin'

const schema = z.object({ status: z.enum(['active', 'paused', 'archived']) })

export default defineEventHandler(async (event) => {
  requireSameOrigin(event)
  const context = await requireProjectMember(event, getRouterParam(event, 'projectId'))
  requireProjectManagementRole(context.membership.role)
  const policyId = getRouterParam(event, 'policyId')
  const parsed = schema.safeParse(await readBody(event))
  if (!policyId || !parsed.success) throw createError({ statusCode: 400, statusMessage: 'Invalid policy status request' })
  const updated = await useDatabase().transaction(async (tx) => {
    const [policy] = await tx.select().from(sponsorshipPolicies).where(and(eq(sponsorshipPolicies.id, policyId), eq(sponsorshipPolicies.projectId, context.project.id))).for('update').limit(1)
    if (!policy) throw createError({ statusCode: 404, statusMessage: 'Policy not found' })
    if (parsed.data.status === 'active') await tx.update(sponsorshipPolicies).set({ status: 'paused' }).where(and(eq(sponsorshipPolicies.projectId, context.project.id), eq(sponsorshipPolicies.name, policy.name), eq(sponsorshipPolicies.status, 'active'), ne(sponsorshipPolicies.id, policy.id)))
    const [row] = await tx.update(sponsorshipPolicies).set({ status: parsed.data.status, publishedBy: parsed.data.status === 'active' ? context.session.user.id : policy.publishedBy, publishedAt: parsed.data.status === 'active' ? new Date() : policy.publishedAt }).where(eq(sponsorshipPolicies.id, policy.id)).returning()
    await tx.insert(auditLogs).values({ organizationId: context.organization.id, projectId: context.project.id, actor: context.session.user.email, action: `project.policy.${parsed.data.status}`, resourceType: 'sponsorship_policy', resourceId: policy.id, result: 'success', requestId: getHeader(event, 'x-request-id') || randomUUID(), metadata: { name: policy.name, version: policy.version } })
    return row
  })
  return updated
})
