import { eq, sql } from 'drizzle-orm'
import { deriveAddress, deriveKeypair } from 'ripple-keypairs'
import { auth } from '~~/lib/auth'
import { platformControls, workerHeartbeats } from '~~/server/database/schema'
import { loadSponsorProtocolDefinitions, parseDefinitionsHashAllowlist } from '~~/server/services/xrpl/definitions'
import { useDatabase } from '~~/server/utils/database'
import { xrplRpc } from '~~/server/utils/xrpl-rpc'

export default defineEventHandler(async (event) => {
  const session = await auth.api.getSession({ headers: event.headers })
  if (!session?.user) throw createError({ statusCode: 401, statusMessage: 'Authentication required' })
  const database = useDatabase()
  const rpcUrl = process.env.ACME_XRPL_RPC_URL || 'https://s.devnet.rippletest.net:51234/'
  const checks: Array<{ key: string, label: string, ok: boolean, detail: string }> = []
  const check = async (key: string, label: string, action: () => Promise<boolean>, success: string, failure: string) => {
    let ok = false
    try {
      ok = await action()
    } catch { /* Return actionable configuration guidance instead of internal errors. */ }
    return { key, label, ok, detail: ok ? success : failure }
  }
  checks.push(...await Promise.all([
    check('database', 'Database', async () => {
      await database.execute(sql`select 1`)
      return true
    }, 'Connected', 'Ask the operator to check the database connection and apply migrations.'),
    check('grants', 'Transaction authorization', async () => Boolean(process.env.ACME_GRANT_SECRET && process.env.ACME_GRANT_SECRET.length >= 32), 'Configured', 'Ask the operator to configure a separate grant secret of at least 32 characters.'),
    check('signer', 'Devnet sponsor signer', async () => {
      const seed = process.env.ACME_LOCAL_SPONSOR_SEED
      return Boolean(seed && deriveAddress(deriveKeypair(seed).publicKey) === process.env.ACME_LOCAL_SPONSOR_ADDRESS)
    }, 'Configured', 'Ask the operator to configure a matching Devnet sponsor seed and address.'),
    check('network', 'Devnet sponsorship', async () => {
      const protocol = await loadSponsorProtocolDefinitions({ rpcUrl, allowedHashes: parseDefinitionsHashAllowlist(process.env.ACME_XRPL_DEFINITIONS_HASHES) })
      return protocol.networkId === 2
    }, 'Sponsor amendment and protocol definitions verified', 'The Devnet endpoint or supported protocol definitions are unavailable. Retry or contact the operator.'),
    check('funding', 'Sponsor account', async () => {
      if (!process.env.ACME_LOCAL_SPONSOR_ADDRESS) return false
      const account = await xrplRpc<{ account_data: { Balance: string } }>(rpcUrl, 'account_info', { account: process.env.ACME_LOCAL_SPONSOR_ADDRESS, ledger_index: 'validated', strict: true })
      return BigInt(account.account_data.Balance) > 0n
    }, 'Funded on Devnet; capacity is checked for each transaction', 'Ask the operator to fund the configured sponsor on Devnet.'),
    check('worker', 'Transaction processing', async () => {
      const [heartbeat] = await database.select().from(workerHeartbeats).where(eq(workerHeartbeats.workerName, 'xrpl-intent-worker')).limit(1)
      return Boolean(heartbeat?.status === 'running' && Date.now() - heartbeat.lastHeartbeatAt.getTime() < 30_000)
    }, 'Worker is running', 'The worker is not ready. Retry shortly or ask the operator to restart it.'),
    check('controls', 'Sponsorship availability', async () => {
      const [control] = await database.select().from(platformControls).where(eq(platformControls.key, 'sponsorship')).limit(1)
      return Boolean(control && !control.paused)
    }, 'Sponsorship is enabled', 'Sponsorship is paused or configuration is unavailable. Contact the operator.')
  ]))
  setResponseHeader(event, 'Cache-Control', 'no-store')
  return { ready: checks.every(item => item.ok), checks }
})
