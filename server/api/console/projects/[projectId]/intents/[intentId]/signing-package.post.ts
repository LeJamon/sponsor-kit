import { z } from 'zod'
import { resumeSponsorshipIntentSigning } from '~~/server/services/intent-creation'
import { requireProjectMember } from '~~/server/utils/project-member'
import { requireSameOrigin } from '~~/server/utils/same-origin'

export default defineEventHandler(async (event) => {
  requireSameOrigin(event)
  const context = await requireProjectMember(event, getRouterParam(event, 'projectId'))
  if (context.project.status !== 'active') throw createError({ statusCode: 409, statusMessage: 'Project is paused' })
  if (context.membership.role === 'viewer') throw createError({ statusCode: 403, statusMessage: 'Developer access is required to resume signing' })
  const parsed = z.uuid().safeParse(getRouterParam(event, 'intentId'))
  if (!parsed.success) throw createError({ statusCode: 400, statusMessage: 'A valid intent ID is required' })
  setResponseHeader(event, 'Cache-Control', 'no-store')
  return resumeSponsorshipIntentSigning(context.project.id, parsed.data)
})
