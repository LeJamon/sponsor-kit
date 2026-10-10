import { randomUUID } from 'node:crypto'
import { createSponsorshipIntent } from '~~/server/services/intent-creation'
import { requireProjectApiKey } from '~~/server/utils/api-key'
import { intentRequestSchema } from '~~/server/utils/intent-request'

export default defineEventHandler(async (event) => {
  const projectPublicId = getRouterParam(event, 'projectId')
  if (!projectPublicId) throw createError({ statusCode: 400, statusMessage: 'Project ID is required' })
  const principal = await requireProjectApiKey(event, projectPublicId, 'intents:create')
  const idempotencyKey = getHeader(event, 'idempotency-key')
  if (!idempotencyKey || idempotencyKey.length > 128) throw createError({ statusCode: 400, statusMessage: 'A valid Idempotency-Key header is required' })
  const parsed = intentRequestSchema.safeParse(await readBody(event))
  if (!parsed.success) throw createError({ statusCode: 400, statusMessage: 'Invalid intent request', data: parsed.error.flatten() })
  const result = await createSponsorshipIntent({
    project: principal.project,
    idempotencyKey,
    correlationId: getHeader(event, 'x-correlation-id') || randomUUID(),
    actor: `api_key:${principal.apiKeyId}`,
    request: parsed.data
  })
  setResponseStatus(event, 201)
  return result
})
