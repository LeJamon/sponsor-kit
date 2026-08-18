import { xrplRpc } from '~~/server/utils/xrpl-rpc'

export default defineEventHandler(async (event) => {
  const config = useRuntimeConfig(event)
  const response = await xrplRpc<{
    state: {
      validated_ledger: {
        seq: number
        base_fee: string | number
        reserve_base: string | number
        reserve_inc: string | number
      }
    }
  }>(config.xrplRpcUrl, 'server_state', {})
  const ledger = response.state.validated_ledger

  setResponseHeader(event, 'Cache-Control', 'public, max-age=10, stale-while-revalidate=30')

  return {
    network: config.public.defaultNetwork,
    ledgerIndex: ledger.seq,
    baseFeeDrops: String(ledger.base_fee),
    accountReserveDrops: String(ledger.reserve_base),
    objectReserveDrops: String(ledger.reserve_inc),
    updatedAt: new Date().toISOString()
  }
})
