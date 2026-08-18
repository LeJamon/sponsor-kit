import { XrplDefinitions, type XrplDefinitionsBase } from 'ripple-binary-codec'
import { xrplRpc } from '../../utils/xrpl-rpc'

export const SPONSOR_AMENDMENT_ID = 'BE1F90581635DBCEBFC4678C4B54FEDDC1A17B50FD02CFE765A4132A342126AC'
export const DEVNET_DEFINITIONS_HASH = 'F3DCCAD774156538A6AB3E6003A41273D5AE394A90989204838AE52A006F245B'
export const DEVNET_NETWORK_ID = 2

type Feature = { enabled?: boolean, name?: string, supported?: boolean }
type ServerDefinitions = ConstructorParameters<typeof XrplDefinitions>[0] & {
  hash?: string
  FIELDS: Array<[string, { isSigningField?: boolean, type?: string }]>
  LEDGER_ENTRY_TYPES: Record<string, number>
  TRANSACTION_FLAGS: Record<string, Record<string, number>>
  TRANSACTION_TYPES: Record<string, number>
}

export type SponsorProtocolDefinitions = {
  amendmentId: string
  definitions: XrplDefinitionsBase
  definitionsHash: string
  networkId: number
  serverVersion: string
  transactionTypes: string[]
  flags: {
    sponsorFee: 1
    sponsorReserve: 2
    transferEnd: number
    transferCreate: number
    transferReassign: number
    sponsorCreatedAccount: number
  }
}

const cache = new Map<string, { expiresAt: number, value: Promise<SponsorProtocolDefinitions> }>()

function requireNumber(value: unknown, label: string): number {
  if (!Number.isInteger(value)) throw new Error(`XRPL_DEFINITIONS_INCOMPATIBLE: ${label} is missing`)
  return Number(value)
}

function validateSponsorFields(definitions: ServerDefinitions) {
  const fields = new Map(definitions.FIELDS)
  const sponsor = fields.get('Sponsor')
  const sponsorFlags = fields.get('SponsorFlags')
  const sponsorSignature = fields.get('SponsorSignature')
  if (sponsor?.type !== 'AccountID' || sponsorFlags?.type !== 'UInt32') {
    throw new Error('XRPL_DEFINITIONS_INCOMPATIBLE: Sponsor fields are missing')
  }
  if (sponsorSignature?.type !== 'STObject' || sponsorSignature.isSigningField !== false) {
    throw new Error('XRPL_DEFINITIONS_INCOMPATIBLE: SponsorSignature must be a non-signing STObject')
  }
  requireNumber(definitions.TRANSACTION_TYPES.SponsorshipSet, 'SponsorshipSet')
  requireNumber(definitions.TRANSACTION_TYPES.SponsorshipTransfer, 'SponsorshipTransfer')
  requireNumber(definitions.LEDGER_ENTRY_TYPES.Sponsorship, 'Sponsorship ledger entry')
}

function normalizeAllowedHashes(hashes: string[] | undefined): Set<string> {
  const configured = hashes?.length ? hashes : [DEVNET_DEFINITIONS_HASH]
  const normalized = new Set(configured.map(value => value.trim().toUpperCase()).filter(Boolean))
  if (!normalized.size || [...normalized].some(value => !/^[A-F0-9]{64}$/.test(value))) {
    throw new Error('XRPL_DEFINITIONS_HASH_ALLOWLIST_INVALID')
  }
  return normalized
}

async function fetchSponsorDefinitions(rpcUrl: string, allowedHashes?: string[]): Promise<SponsorProtocolDefinitions> {
  const [featureResult, rawDefinitions, serverInfo] = await Promise.all([
    xrplRpc<{ features: Record<string, Feature> }>(rpcUrl, 'feature', {}),
    xrplRpc<ServerDefinitions>(rpcUrl, 'server_definitions', {}),
    xrplRpc<{ info: { build_version?: string, network_id?: number } }>(rpcUrl, 'server_info', {})
  ])
  if (serverInfo.info.network_id !== DEVNET_NETWORK_ID) throw new Error('XRPL_NETWORK_ID_MISMATCH')
  const sponsorFeature = Object.entries(featureResult.features).find(([, feature]) => feature.name === 'Sponsor')
  if (!sponsorFeature) throw new Error('XRPL_SPONSOR_UNSUPPORTED')
  const [amendmentId, feature] = sponsorFeature
  if (amendmentId !== SPONSOR_AMENDMENT_ID || !feature.supported || !feature.enabled) {
    throw new Error('XRPL_SPONSOR_NOT_ENABLED')
  }

  const definitionsHash = String(rawDefinitions.hash || '').toUpperCase()
  if (!normalizeAllowedHashes(allowedHashes).has(definitionsHash)) {
    throw new Error(`XRPL_DEFINITIONS_HASH_NOT_ALLOWED: ${definitionsHash || 'missing'}`)
  }
  validateSponsorFields(rawDefinitions)

  const transferFlags = rawDefinitions.TRANSACTION_FLAGS.SponsorshipTransfer || {}
  const paymentFlags = rawDefinitions.TRANSACTION_FLAGS.Payment || {}
  return {
    amendmentId,
    definitions: new XrplDefinitions(rawDefinitions),
    definitionsHash,
    networkId: serverInfo.info.network_id,
    serverVersion: String(serverInfo.info.build_version || 'unknown'),
    transactionTypes: Object.keys(rawDefinitions.TRANSACTION_TYPES).filter(name => !['EnableAmendment', 'SetFee', 'UNLModify'].includes(name)),
    flags: {
      sponsorFee: 1,
      sponsorReserve: 2,
      transferEnd: requireNumber(transferFlags.tfSponsorshipEnd, 'tfSponsorshipEnd'),
      transferCreate: requireNumber(transferFlags.tfSponsorshipCreate, 'tfSponsorshipCreate'),
      transferReassign: requireNumber(transferFlags.tfSponsorshipReassign, 'tfSponsorshipReassign'),
      sponsorCreatedAccount: requireNumber(paymentFlags.tfSponsorCreatedAccount, 'tfSponsorCreatedAccount')
    }
  }
}

export function parseDefinitionsHashAllowlist(value: string | undefined): string[] | undefined {
  return value?.split(',').map(hash => hash.trim()).filter(Boolean)
}

export async function loadSponsorProtocolDefinitions(input: {
  rpcUrl: string
  allowedHashes?: string[]
  cacheTtlMs?: number
  forceRefresh?: boolean
}): Promise<SponsorProtocolDefinitions> {
  const cacheKey = `${input.rpcUrl}|${(input.allowedHashes || []).join(',')}`
  const cached = cache.get(cacheKey)
  if (!input.forceRefresh && cached && cached.expiresAt > Date.now()) return cached.value
  const value = fetchSponsorDefinitions(input.rpcUrl, input.allowedHashes)
  cache.set(cacheKey, { expiresAt: Date.now() + (input.cacheTtlMs ?? 60_000), value })
  try {
    return await value
  } catch (error) {
    cache.delete(cacheKey)
    throw error
  }
}

export function clearSponsorDefinitionsCache() {
  cache.clear()
}
