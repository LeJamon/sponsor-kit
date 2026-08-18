import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { z } from 'zod'
import { apiKeys, auditLogs } from '~~/server/database/schema'
import { useDatabase } from '~~/server/utils/database'
import { requireProjectManagementRole, requireProjectMember } from '~~/server/utils/project-member'
import { requireSameOrigin } from '~~/server/utils/same-origin'

const allowedScopes = ['intents:create', 'intents:read', 'usage:read'] as const
const schema = z.object({ name: z.string().trim().min(2).max(80), scopes: z.array(z.enum(allowedScopes)).min(1), expiresAt: z.coerce.date().optional() })

export default defineEventHandler(async (event) => {
  requireSameOrigin(event)
  const context = await requireProjectMember(event, getRouterParam(event, 'projectId'))
  requireProjectManagementRole(context.membership.role)
  const parsed = schema.safeParse(await readBody(event))
  if (!parsed.success) throw createError({ statusCode: 400, statusMessage: 'Invalid API key request', data: parsed.error.flatten() })
  const secret = `acme_dev_sk_${randomBytes(32).toString('base64url')}`
  const prefix = secret.slice(0, 18)
  const id = randomUUID()
  const createdAt = new Date()
  await useDatabase().transaction(async (tx) => {
    await tx.insert(apiKeys).values({ id, projectId: context.project.id, name: parsed.data.name, prefix, secretHash: createHash('sha256').update(secret).digest('hex'), scopes: parsed.data.scopes, expiresAt: parsed.data.expiresAt, createdAt })
    await tx.insert(auditLogs).values({ organizationId: context.organization.id, projectId: context.project.id, actor: context.session.user.email, action: 'api_key.created', resourceType: 'api_key', resourceId: id, result: 'success', requestId: getHeader(event, 'x-request-id') || randomUUID(), metadata: { name: parsed.data.name, prefix, scopes: parsed.data.scopes } })
  })
  setResponseStatus(event, 201)
  return { id, name: parsed.data.name, prefix, scopes: parsed.data.scopes, secret, createdAt }
})
