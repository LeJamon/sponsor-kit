import { xrplRpc } from '~~/server/utils/xrpl-rpc'

export default defineEventHandler(async (event) => {
  const config = useRuntimeConfig(event)
  const rpcUrl = process.env.ACME_XRPL_RPC_URL || process.env.NUXT_XRPL_RPC_URL || config.xrplRpcUrl || 'https://s.devnet.rippletest.net:51234/'
  const response = await xrplRpc<{
    state: {
      validated_ledger: {
        seq: number
        base_fee: string | number
        reserve_base: string | number
        reserve_inc: string | number
      }
    }
  }>(rpcUrl, 'server_state', {})
  const ledger = response.state.validated_ledger

  setResponseHeader(event, 'Cache-Control', 'public, max-age=10, stale-while-revalidate=30')

  return {
    network: process.env.NUXT_PUBLIC_DEFAULT_NETWORK || config.public.defaultNetwork || 'devnet',
    ledgerIndex: ledger.seq,
    baseFeeDrops: String(ledger.base_fee),
    accountReserveDrops: String(ledger.reserve_base),
    objectReserveDrops: String(ledger.reserve_inc),
    updatedAt: new Date().toISOString()
  }
})
