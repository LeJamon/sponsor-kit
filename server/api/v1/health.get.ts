import { eq, sql } from 'drizzle-orm'
import { deriveAddress, deriveKeypair } from 'ripple-keypairs'
import { workerHeartbeats } from '~~/server/database/schema'
import { loadSponsorProtocolDefinitions, parseDefinitionsHashAllowlist } from '~~/server/services/xrpl/definitions'
import { useDatabase } from '~~/server/utils/database'
import { XrplRpcError } from '~~/server/utils/xrpl-rpc'

function sanitizeXrplDetail(error: unknown) {
  if (error instanceof XrplRpcError) {
    const method = error.method.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 48) || 'unknown'
    const code = error.code?.replace(/[^a-zA-Z0-9_.-]/g, '').slice(0, 64)
    return code ? `rpc:${method}:${code}` : `rpc:${method}:unavailable`
  }
  if (error instanceof Error) return /^XRPL_[A-Z0-9_]+/.exec(error.message)?.[0] || 'unavailable'
  return 'unavailable'
}

export default defineEventHandler(async (event) => {
  setResponseHeader(event, 'Cache-Control', 'no-store')
  const rpcUrl = process.env.ACME_XRPL_RPC_URL || 'https://s.devnet.rippletest.net:51234/'
  const checks: Record<string, { ok: boolean, detail?: string }> = {}
  try {
    await useDatabase().execute(sql`select 1`)
    checks.database = { ok: true }
  } catch {
    checks.database = { ok: false, detail: 'unavailable' }
  }
  try {
    const protocol = await loadSponsorProtocolDefinitions({ rpcUrl, allowedHashes: parseDefinitionsHashAllowlist(process.env.ACME_XRPL_DEFINITIONS_HASHES) })
    checks.xrpl = { ok: true, detail: `network:${protocol.networkId} definitions:${protocol.definitionsHash}` }
  } catch (error) {
    checks.xrpl = { ok: false, detail: sanitizeXrplDetail(error) }
  }
  try {
    const seed = process.env.ACME_LOCAL_SPONSOR_SEED
    const expectedAddress = process.env.ACME_LOCAL_SPONSOR_ADDRESS
    checks.signer = { ok: Boolean(seed && expectedAddress && deriveAddress(deriveKeypair(seed).publicKey) === expectedAddress) }
  } catch {
    checks.signer = { ok: false, detail: 'invalid configuration' }
  }
  try {
    const [heartbeat] = await useDatabase().select().from(workerHeartbeats).where(eq(workerHeartbeats.workerName, 'xrpl-intent-worker')).limit(1)
    const ageMs = heartbeat ? Date.now() - heartbeat.lastHeartbeatAt.getTime() : Number.POSITIVE_INFINITY
    checks.worker = { ok: heartbeat?.status === 'running' && ageMs < 30_000, detail: heartbeat ? `${Math.round(ageMs / 1000)}s ago` : 'no heartbeat' }
  } catch {
    checks.worker = { ok: false, detail: 'unavailable' }
  }
  const ok = Object.values(checks).every(check => check.ok)
  if (!ok) setResponseStatus(event, 503, 'Dependency checks failed')
  return { status: ok ? 'ok' : 'degraded', network: 'devnet', checks, checkedAt: new Date().toISOString() }
})
