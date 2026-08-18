import { xrplRpc } from '../../utils/xrpl-rpc'
import type { XrplTransaction } from '../signer/types'

type AffectedNode = {
  ModifiedNode?: {
    LedgerEntryType?: string
    FinalFields?: Record<string, unknown>
    PreviousFields?: Record<string, unknown>
  }
}

function count(fields: Record<string, unknown> | undefined, name: string): number {
  const value = fields?.[name]
  return typeof value === 'number' && Number.isSafeInteger(value) ? value : 0
}

export async function simulateSponsoredTransaction(input: {
  rpcUrl: string
  transaction: XrplTransaction
  sponsorAddress: string
}) {
  const simulationTransaction = {
    ...input.transaction,
    SigningPubKey: '',
    SponsorSignature: { SigningPubKey: '' }
  }
  const [simulation, serverState] = await Promise.all([
    xrplRpc<{
      engine_result: string
      engine_result_message?: string
      ledger_index: number
      meta?: { AffectedNodes?: AffectedNode[] }
    }>(input.rpcUrl, 'simulate', { tx_json: simulationTransaction }),
    xrplRpc<{ state: { validated_ledger: { reserve_base: string | number, reserve_inc: string | number } } }>(input.rpcUrl, 'server_state', {})
  ])
  if (simulation.engine_result !== 'tesSUCCESS') {
    throw new Error(`XRPL_SIMULATION_FAILED: ${simulation.engine_result} ${simulation.engine_result_message || ''}`.trim())
  }
  const sponsorNode = simulation.meta?.AffectedNodes?.find((node) => {
    const modified = node.ModifiedNode
    return modified?.LedgerEntryType === 'AccountRoot' && modified.FinalFields?.Account === input.sponsorAddress
  })?.ModifiedNode
  const ownerCountDelta = count(sponsorNode?.FinalFields, 'SponsoringOwnerCount') - count(sponsorNode?.PreviousFields, 'SponsoringOwnerCount')
  const accountCountDelta = count(sponsorNode?.FinalFields, 'SponsoringAccountCount') - count(sponsorNode?.PreviousFields, 'SponsoringAccountCount')
  const objectReserveDrops = BigInt(serverState.state.validated_ledger.reserve_inc)
  const accountReserveDrops = BigInt(serverState.state.validated_ledger.reserve_base)
  const reserveDrops = BigInt(Math.max(0, ownerCountDelta)) * objectReserveDrops + BigInt(Math.max(0, accountCountDelta)) * accountReserveDrops
  return {
    engineResult: simulation.engine_result,
    ledgerIndex: simulation.ledger_index,
    reserveDrops,
    ownerCountDelta,
    accountCountDelta,
    objectReserveDrops,
    accountReserveDrops
  }
}
