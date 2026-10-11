import { z } from 'zod'
import { PROJECT_USAGE_RANGES, readProjectUsage } from '~~/server/services/project-usage'
import { requireProjectMember } from '~~/server/utils/project-member'

const querySchema = z.object({
  range: z.enum(PROJECT_USAGE_RANGES).default('7d'),
  policyId: z.uuid().optional()
})

export default defineEventHandler(async (event) => {
  const context = await requireProjectMember(event, getRouterParam(event, 'projectId'))
  const parsed = querySchema.safeParse(getQuery(event))
  if (!parsed.success) throw createError({ statusCode: 400, statusMessage: 'Invalid usage filters' })
  setResponseHeader(event, 'Cache-Control', 'no-store')
  return readProjectUsage({ projectId: context.project.id, range: parsed.data.range, policyId: parsed.data.policyId })
})
