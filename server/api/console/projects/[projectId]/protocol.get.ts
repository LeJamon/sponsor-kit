import { requireProjectMember } from '~~/server/utils/project-member'
import { readSigningProtocol } from '~~/server/utils/protocol-response'

export default defineEventHandler(async (event) => {
  const { project } = await requireProjectMember(event, getRouterParam(event, 'projectId'))
  setResponseHeader(event, 'Cache-Control', 'no-store')
  return readSigningProtocol(project)
})
