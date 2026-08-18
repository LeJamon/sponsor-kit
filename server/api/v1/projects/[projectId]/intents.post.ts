import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { createSponsorshipIntent } from '~~/server/services/intent-creation'
import { requireProjectApiKey } from '~~/server/utils/api-key'

const bodySchema = z.object({
  account: z.string().min(25).max(40),
  transaction: z.record(z.string(), z.unknown()),
  sponsorship: z.object({ fee: z.boolean().default(true), reserve: z.boolean().default(false) }),
  policyId: z.uuid().optional(),
  signing: z.object({ mode: z.enum(['single', 'multi']).default('single'), signerCount: z.number().int().min(1).max(32).default(1) }).default({ mode: 'single', signerCount: 1 })
}).superRefine((value, context) => {
  if (!value.sponsorship.fee && !value.sponsorship.reserve) context.addIssue({ code: 'custom', message: 'At least one sponsorship type is required', path: ['sponsorship'] })
  if (value.signing.mode === 'single' && value.signing.signerCount !== 1) context.addIssue({ code: 'custom', message: 'Single signing has exactly one signer', path: ['signing', 'signerCount'] })
})

export default defineEventHandler(async (event) => {
  const projectPublicId = getRouterParam(event, 'projectId')
  if (!projectPublicId) throw createError({ statusCode: 400, statusMessage: 'Project ID is required' })
  const principal = await requireProjectApiKey(event, projectPublicId, 'intents:create')
  const idempotencyKey = getHeader(event, 'idempotency-key')
  if (!idempotencyKey || idempotencyKey.length > 128) throw createError({ statusCode: 400, statusMessage: 'A valid Idempotency-Key header is required' })
  const parsed = bodySchema.safeParse(await readBody(event))
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
