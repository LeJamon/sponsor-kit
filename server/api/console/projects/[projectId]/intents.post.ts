import { randomUUID } from 'node:crypto'
import { createSponsorshipIntent } from '~~/server/services/intent-creation'
import { intentRequestSchema } from '~~/server/utils/intent-request'
import { requireProjectMember } from '~~/server/utils/project-member'
import { requireSameOrigin } from '~~/server/utils/same-origin'

export default defineEventHandler(async (event) => {
  requireSameOrigin(event)
  const context = await requireProjectMember(event, getRouterParam(event, 'projectId'))
  if (context.project.status !== 'active') throw createError({ statusCode: 409, statusMessage: 'Project is paused' })
  if (context.membership.role === 'viewer') throw createError({ statusCode: 403, statusMessage: 'Developer access is required to create transactions' })
  const idempotencyKey = getHeader(event, 'idempotency-key')
  if (!idempotencyKey || idempotencyKey.length > 128) throw createError({ statusCode: 400, statusMessage: 'A valid Idempotency-Key header is required' })
  const parsed = intentRequestSchema.safeParse(await readBody(event))
  if (!parsed.success) throw createError({ statusCode: 400, statusMessage: 'Invalid intent request', data: parsed.error.flatten() })
  const result = await createSponsorshipIntent({
    project: context.project,
    idempotencyKey,
    correlationId: randomUUID(),
    actor: `user:${context.session.user.id}`,
    request: parsed.data
  })
  setResponseStatus(event, 201)
  return result
})
