import { canonicalHash } from '../domain/canonical-json'
import { fetchAllAccountObjects, xrplRpc } from '../utils/xrpl-rpc'
import { loadSponsorProtocolDefinitions, parseDefinitionsHashAllowlist } from './xrpl/definitions'

const supportedObjectTypes = new Set([
  'Check',
  'Escrow',
  'PayChannel',
  'MPToken',
  'Delegate',
  'DepositPreauth',
  'MPTokenIssuance',
  'SignerList',
  'Credential'
])

export type ReserveInspectionTarget = {
  targetKey: string
  objectId: string | null
  objectType: string
  trustlineSide: string | null
  ownerAddress: string
  observedSponsor: string | null
  snapshotHash: string
  reserveUnits: number
  estimatedReserveDrops: string
  classification: 'eligible' | 'already_sponsored' | 'unsupported'
  reason?: string
}

function ownerFor(object: Record<string, unknown>): string | undefined {
  return typeof object.Account === 'string' ? object.Account : typeof object.Owner === 'string' ? object.Owner : undefined
}

function targetSnapshot(target: Omit<ReserveInspectionTarget, 'snapshotHash'>) {
  return canonicalHash(target)
}

export async function inspectReserveTargets(input: { rpcUrl: string, account: string }) {
  const [protocol, ledger] = await Promise.all([
    loadSponsorProtocolDefinitions({ rpcUrl: input.rpcUrl, allowedHashes: parseDefinitionsHashAllowlist(process.env.ACME_XRPL_DEFINITIONS_HASHES) }),
    xrplRpc<{ ledger_hash: string, ledger_index: number }>(input.rpcUrl, 'ledger', { ledger_index: 'validated', transactions: false, expand: false })
  ])
  const [info, objectResponse, serverState] = await Promise.all([
    xrplRpc<{ account_data: Record<string, unknown>, ledger_hash: string, ledger_index: number }>(input.rpcUrl, 'account_info', { account: input.account, ledger_index: ledger.ledger_index, strict: true }),
    fetchAllAccountObjects(input.rpcUrl, input.account, ledger.ledger_index),
    xrplRpc<{ state: { validated_ledger: { reserve_base: string | number, reserve_inc: string | number } } }>(input.rpcUrl, 'server_state', {})
  ])
  if (info.ledger_index !== ledger.ledger_index || objectResponse.ledgerIndex !== ledger.ledger_index) throw new Error('XRPL_INSPECTION_LEDGER_MISMATCH')
  const objectReserveDrops = BigInt(serverState.state.validated_ledger.reserve_inc)
  const accountReserveDrops = BigInt(serverState.state.validated_ledger.reserve_base)
  const accountSponsor = typeof info.account_data.Sponsor === 'string' ? info.account_data.Sponsor : null
  const accountBase = {
    targetKey: 'account',
    objectId: null,
    objectType: 'AccountRoot',
    trustlineSide: null,
    ownerAddress: input.account,
    observedSponsor: accountSponsor,
    reserveUnits: 1,
    estimatedReserveDrops: accountReserveDrops.toString(),
    classification: accountSponsor ? 'already_sponsored' as const : 'eligible' as const
  }
  const targets: ReserveInspectionTarget[] = [{ ...accountBase, snapshotHash: targetSnapshot(accountBase) }]
  for (const object of objectResponse.objects) {
    const objectId = String(object.index || '')
    const objectType = String(object.LedgerEntryType || 'Unknown')
    if (!objectId) continue
    if (objectType === 'RippleState') {
      const base = {
        targetKey: `object:${objectId}:trustline`, objectId, objectType, trustlineSide: null,
        ownerAddress: input.account, observedSponsor: null, reserveUnits: 1,
        estimatedReserveDrops: objectReserveDrops.toString(), classification: 'unsupported' as const,
        reason: 'Trustline-side migration is disabled until dedicated conformance coverage is enabled.'
      }
      targets.push({ ...base, snapshotHash: targetSnapshot(base) })
      continue
    }
    const owner = ownerFor(object)
    if (owner !== input.account) continue
    const observedSponsor = typeof object.Sponsor === 'string' ? object.Sponsor : null
    const classification = observedSponsor ? 'already_sponsored' as const : supportedObjectTypes.has(objectType) ? 'eligible' as const : 'unsupported' as const
    const base = {
      targetKey: `object:${objectId}`,
      objectId,
      objectType,
      trustlineSide: null,
      ownerAddress: input.account,
      observedSponsor,
      reserveUnits: 1,
      estimatedReserveDrops: objectReserveDrops.toString(),
      classification,
      ...(classification === 'unsupported' ? { reason: `${objectType} is not supported by rippled 3.3.0 SponsorshipTransfer.` } : {})
    }
    targets.push({ ...base, snapshotHash: targetSnapshot(base) })
  }
  return {
    account: input.account,
    networkId: protocol.networkId,
    definitionsHash: protocol.definitionsHash,
    ledgerIndex: ledger.ledger_index,
    ledgerHash: ledger.ledger_hash || info.ledger_hash,
    targets
  }
}
