import { readProjectFunding } from '~~/server/services/funding'
import { requireProjectMember } from '~~/server/utils/project-member'

export default defineEventHandler(async (event) => {
  const context = await requireProjectMember(event, getRouterParam(event, 'projectId'))
  const funding = await readProjectFunding({ projectId: context.project.id, rpcUrl: context.project.rpcUrl, network: context.project.network })
  if (!funding) throw createError({ statusCode: 404, statusMessage: 'Sponsor funding is not configured' })
  return funding
})
