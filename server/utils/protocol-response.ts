import type { XrplDefinitions } from 'ripple-binary-codec'
import { loadSponsorProtocolDefinitions, parseDefinitionsHashAllowlist } from '../services/xrpl/definitions'
import { xrplRpc } from './xrpl-rpc'

export async function readSigningProtocol(project: { network: string, rpcUrl: string }) {
  if (project.network !== 'devnet') throw createError({ statusCode: 409, statusMessage: 'This signing integration supports Devnet only' })
  const protocol = await loadSponsorProtocolDefinitions({ rpcUrl: project.rpcUrl, allowedHashes: parseDefinitionsHashAllowlist(process.env.ACME_XRPL_DEFINITIONS_HASHES) })
  const definitions = await xrplRpc<ConstructorParameters<typeof XrplDefinitions>[0] & { hash?: string }>(project.rpcUrl, 'server_definitions', {})
  if (definitions.hash?.toUpperCase() !== protocol.definitionsHash) throw createError({ statusCode: 409, statusMessage: 'Network definitions changed; refresh before preparing a transaction' })
  return { network: project.network, networkId: protocol.networkId, definitionsHash: protocol.definitionsHash, definitions }
}
