import { loadSponsorProtocolDefinitions, parseDefinitionsHashAllowlist } from '../xrpl/definitions'
import { LocalSponsorSigner } from './local'
import { XrplSponsorAdapter } from './xrpl-adapter'

export async function createSponsorSigner(input: { rpcUrl: string, network: string, expectedDefinitionsHash?: string }) {
  const protocol = await loadSponsorProtocolDefinitions({ rpcUrl: input.rpcUrl, allowedHashes: parseDefinitionsHashAllowlist(process.env.ACME_XRPL_DEFINITIONS_HASHES) })
  if (input.expectedDefinitionsHash && protocol.definitionsHash !== input.expectedDefinitionsHash) throw new Error('XRPL_DEFINITIONS_CHANGED')
  const seed = process.env.ACME_LOCAL_SPONSOR_SEED
  const address = process.env.ACME_LOCAL_SPONSOR_ADDRESS
  if (!seed || !address) throw new Error('LOCAL_SPONSOR_SIGNER_NOT_CONFIGURED')
  const adapter = new XrplSponsorAdapter(protocol)
  const signer = new LocalSponsorSigner({
    seed,
    expectedAddress: address,
    keyReference: 'local-v1',
    allowedNetworks: ['devnet'],
    allowMainnet: false,
    adapter
  })
  if (input.network !== 'devnet') throw new Error('SIGNER_NETWORK_NOT_ALLOWED')
  return { signer, adapter, protocol }
}
