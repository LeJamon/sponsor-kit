import { discoverSponsorCapabilities } from '~~/server/services/capabilities'
import { loadSponsorProtocolDefinitions, parseDefinitionsHashAllowlist } from '~~/server/services/xrpl/definitions'
import { requireProjectApiKey } from '~~/server/utils/api-key'
import { xrplRpc } from '~~/server/utils/xrpl-rpc'

export default defineEventHandler(async (event) => {
  const projectId = getRouterParam(event, 'projectId')
  if (!projectId) throw createError({ statusCode: 400, statusMessage: 'Project ID is required' })
  const principal = await requireProjectApiKey(event, projectId, 'intents:read', { requireActiveProject: false })
  const allowedDefinitionsHashes = parseDefinitionsHashAllowlist(process.env.ACME_XRPL_DEFINITIONS_HASHES)
  const [protocol, capabilities, ledger] = await Promise.all([
    loadSponsorProtocolDefinitions({ rpcUrl: principal.project.rpcUrl, allowedHashes: allowedDefinitionsHashes }),
    discoverSponsorCapabilities({ rpcUrl: principal.project.rpcUrl, adapterSupportsSponsor: true, allowedDefinitionsHashes }),
    xrplRpc<{ ledger_index: number }>(principal.project.rpcUrl, 'ledger_current', {})
  ])
  return {
    projectId,
    network: principal.project.network,
    networkId: protocol.networkId,
    observedLedger: ledger.ledger_index,
    amendmentId: protocol.amendmentId,
    definitionsHash: protocol.definitionsHash,
    serverVersion: protocol.serverVersion,
    capabilities,
    source: 'xrpl'
  }
})
