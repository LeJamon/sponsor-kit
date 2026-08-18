import { randomUUID } from 'node:crypto'
import { and, eq, isNull } from 'drizzle-orm'
import { apiKeys, auditLogs } from '~~/server/database/schema'
import { useDatabase } from '~~/server/utils/database'
import { requireProjectManagementRole, requireProjectMember } from '~~/server/utils/project-member'
import { requireSameOrigin } from '~~/server/utils/same-origin'

export default defineEventHandler(async (event) => {
  requireSameOrigin(event)
  const context = await requireProjectMember(event, getRouterParam(event, 'projectId'))
  requireProjectManagementRole(context.membership.role)
  const keyId = getRouterParam(event, 'keyId')
  if (!keyId) throw createError({ statusCode: 400, statusMessage: 'API key ID is required' })
  const now = new Date()
  const revoked = await useDatabase().transaction(async (tx) => {
    const rows = await tx.update(apiKeys).set({ revokedAt: now }).where(and(eq(apiKeys.id, keyId), eq(apiKeys.projectId, context.project.id), isNull(apiKeys.revokedAt))).returning({ id: apiKeys.id })
    if (!rows[0]) throw createError({ statusCode: 404, statusMessage: 'Active API key not found' })
    await tx.insert(auditLogs).values({ organizationId: context.organization.id, projectId: context.project.id, actor: context.session.user.email, action: 'api_key.revoked', resourceType: 'api_key', resourceId: keyId, result: 'success', requestId: getHeader(event, 'x-request-id') || randomUUID(), metadata: {} })
    return rows[0]!
  })
  return { id: revoked.id, revokedAt: now }
})
