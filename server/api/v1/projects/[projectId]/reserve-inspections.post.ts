import { z } from 'zod'
import { inspectReserveTargets } from '~~/server/services/reserve-inspection'
import { requireProjectApiKey } from '~~/server/utils/api-key'

const bodySchema = z.object({ account: z.string().min(25).max(40) })

export default defineEventHandler(async (event) => {
  const projectId = getRouterParam(event, 'projectId')
  if (!projectId) throw createError({ statusCode: 400, statusMessage: 'Project ID is required' })
  const principal = await requireProjectApiKey(event, projectId, 'intents:create')
  const parsed = bodySchema.safeParse(await readBody(event))
  if (!parsed.success) throw createError({ statusCode: 400, statusMessage: 'Invalid inspection request', data: parsed.error.flatten() })
  return inspectReserveTargets({ rpcUrl: principal.project.rpcUrl, account: parsed.data.account })
})
