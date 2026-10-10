import { requireProjectApiKey } from '~~/server/utils/api-key'
import { readSigningProtocol } from '~~/server/utils/protocol-response'

export default defineEventHandler(async (event) => {
  const projectId = getRouterParam(event, 'projectId')
  if (!projectId) throw createError({ statusCode: 400, statusMessage: 'Project ID is required' })
  const { project } = await requireProjectApiKey(event, projectId, 'intents:read')
  setResponseHeader(event, 'Cache-Control', 'no-store')
  return readSigningProtocol(project)
})
